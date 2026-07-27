import { describe, expect, it, vi } from "vitest";
import type { LayoutDelta } from "../app/ipc/types";
import { LayoutQueue } from "./layoutQueue";

function delta(id: string, x: number): LayoutDelta {
  return {
    id,
    frame: { x, y: 0, width: 100, height: 100 },
    rotation: 0,
    zIndex: 0,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("LayoutQueue", () => {
  it("serializes writes for one directory in submission order", async () => {
    const firstAttempt = deferred();
    const calls: number[] = [];
    const queue = new LayoutQueue(async (_dir, deltas) => {
      calls.push(deltas[0].frame.x);
      if (deltas[0].frame.x === 1) await firstAttempt.promise;
    });

    const first = queue.enqueue("/workspace", [delta("a", 1)]);
    const second = queue.enqueue("/workspace", [delta("a", 2)]);
    await Promise.resolve();

    expect(calls).toEqual([1]);
    firstAttempt.resolve();
    await Promise.all([first, second]);
    expect(calls).toEqual([1, 2]);
  });

  it("holds the hydration barrier until the queued write settles", async () => {
    const attempt = deferred();
    const queue = new LayoutQueue(async () => attempt.promise);
    let settled = false;

    void queue.enqueue("/workspace", [delta("a", 1)]);
    void queue.settled("/workspace").then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    attempt.resolve();
    await queue.settled("/workspace");
    expect(settled).toBe(true);
  });

  it("retains the newest failed delta for each item", async () => {
    const error = new Error("disk unavailable");
    const onError = vi.fn();
    const queue = new LayoutQueue(async () => {
      throw error;
    });

    await queue.enqueue("/workspace", [delta("a", 1)], onError);
    await queue.enqueue("/workspace", [delta("a", 2)], onError);

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(error);
    expect(queue.takeRetained("/workspace")).toEqual([delta("a", 2)]);
    expect(queue.takeRetained("/workspace")).toEqual([]);
  });

  it("discards an older failure after a newer write succeeds", async () => {
    let attempts = 0;
    const queue = new LayoutQueue(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("first write failed");
    });

    await queue.enqueue("/workspace", [delta("a", 1)]);
    await queue.enqueue("/workspace", [delta("a", 2)]);

    expect(queue.takeRetained("/workspace")).toEqual([]);
  });

  it("continues after an error handler throws", async () => {
    let attempts = 0;
    const queue = new LayoutQueue(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("write failed");
    });

    await expect(
      queue.enqueue("/workspace", [delta("a", 1)], () => {
        throw new Error("status rendering failed");
      }),
    ).resolves.toBeUndefined();
    await queue.enqueue("/workspace", [delta("a", 2)]);

    expect(attempts).toBe(2);
    expect(queue.takeRetained("/workspace")).toEqual([]);
  });

  it("does not serialize writes for different directories", async () => {
    const blocked = deferred();
    const calls: string[] = [];
    const queue = new LayoutQueue(async (dir) => {
      calls.push(dir);
      if (dir === "/workspace/a") await blocked.promise;
    });

    const first = queue.enqueue("/workspace/a", [delta("a", 1)]);
    const second = queue.enqueue("/workspace/b", [delta("b", 1)]);
    await second;

    expect(calls).toEqual(["/workspace/a", "/workspace/b"]);
    blocked.resolve();
    await first;
  });
});
