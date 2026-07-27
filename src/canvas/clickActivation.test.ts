import { describe, expect, it } from "vitest";
import { ClickActivation } from "./clickActivation";

function begin(
  activation: ClickActivation,
  overrides: Partial<{
    itemId: string | null;
    pointerId: number;
    button: number;
    modified: boolean;
  }> = {},
) {
  activation.pointerDown({
    itemId: "b",
    pointerId: 1,
    button: 0,
    modified: false,
    ...overrides,
  });
}

describe("ClickActivation", () => {
  it("activates a completed click on the same item", () => {
    const activation = new ClickActivation();
    begin(activation);

    expect(activation.pointerUp(1, "b")).toBe("b");
    expect(activation.pointerUp(1, "b")).toBeNull();
  });

  it("does not activate after tldraw recognizes a drag", () => {
    const activation = new ClickActivation();
    begin(activation);

    activation.pointerMove(1, true);

    expect(activation.pointerUp(1, "b")).toBeNull();
  });

  it("does not activate a different pointer-up target", () => {
    const activation = new ClickActivation();
    begin(activation);

    expect(activation.pointerUp(1, "a")).toBeNull();
  });

  it("does not activate modified or non-primary gestures", () => {
    const activation = new ClickActivation();

    begin(activation, { modified: true });
    expect(activation.pointerUp(1, "b")).toBeNull();

    begin(activation, { button: 2 });
    expect(activation.pointerUp(1, "b")).toBeNull();
  });

  it("does not activate after interruption", () => {
    const activation = new ClickActivation();
    begin(activation);

    activation.cancel();

    expect(activation.pointerUp(1, "b")).toBeNull();
  });

  it("keeps another pointer from cancelling the active gesture", () => {
    const activation = new ClickActivation();
    begin(activation);

    activation.pointerMove(2, true);

    expect(activation.pointerUp(1, "b")).toBe("b");
  });
});
