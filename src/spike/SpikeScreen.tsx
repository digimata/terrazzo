// Gate 0 spike screen — disposable (v0 plan §5.1). Exercises the eight gate
// items against the real Rust service; deleted when the gate closes.
//
// 1. 200 mixed image/video-poster shapes   → "Spawn 200"
// 2. pan/zoom at 60fps                     → FPS meter, toolbar right
// 3. play/seek 4 videos via asset path     → tldraw video shapes
// 4. Finder drop at world coordinates      → drag files onto the canvas
// 5. dynamic workspace, scoped assets      → "Choose workspace"
// 6. recursive watch                       → event log, bottom left
// 7. rename preserves identity             → inode reconcile on fs events
// 8. ffmpeg poster generation              → "Generate posters"

import { useEffect, useRef, useState } from "react";
import {
  AssetRecordType,
  Editor,
  TLAssetId,
  TLShapeId,
  Tldraw,
  createShapeId,
} from "tldraw";
import "tldraw/tldraw.css";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  generatePoster,
  importFiles,
  rescan,
  setWorkspace,
} from "../app/ipc/commands";
import { onFsEvent } from "../app/ipc/events";
import type { FileEntry } from "../app/ipc/types";
import "./spike.css";

type TrackedItem = {
  shapeId: TLShapeId;
  assetId: TLAssetId;
  path: string;
  kind: "image" | "video";
};

const CARD_W = 260;
const GAP = 40;
const COLS = 16;

function gridPos(i: number) {
  return {
    x: (i % COLS) * (CARD_W + GAP),
    y: Math.floor(i / COLS) * (CARD_W + GAP),
  };
}

function imageDims(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ w: img.naturalWidth || 320, h: img.naturalHeight || 240 });
    img.onerror = () => resolve({ w: 320, h: 240 });
    img.src = src;
  });
}

function useFps() {
  const [stats, setStats] = useState({ fps: 0, p95: 0 });
  useEffect(() => {
    let frames: number[] = [];
    let last = performance.now();
    let lastReport = last;
    let raf = 0;
    const tick = (now: number) => {
      frames.push(now - last);
      last = now;
      if (now - lastReport > 500 && frames.length > 0) {
        const sorted = [...frames].sort((a, b) => a - b);
        const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        setStats({
          fps: Math.round(1000 / avg),
          p95: Math.round(p95 * 10) / 10,
        });
        frames = [];
        lastReport = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return stats;
}

export default function SpikeScreen() {
  const editorRef = useRef<Editor | null>(null);
  const itemsByInode = useRef<Map<number, TrackedItem>>(new Map());
  const entriesRef = useRef<FileEntry[]>([]);
  const placedCount = useRef(0);
  const [workspace, setWorkspaceState] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [shapeCount, setShapeCount] = useState(0);
  const fps = useFps();

  const logLine = (line: string) => setLog((prev) => [...prev.slice(-14), line]);

  async function placeImage(
    editor: Editor,
    name: string,
    src: string,
    pos: { x: number; y: number },
  ): Promise<{ shapeId: TLShapeId; assetId: TLAssetId }> {
    const dims = await imageDims(src);
    const assetId = AssetRecordType.createId();
    editor.createAssets([
      {
        id: assetId,
        typeName: "asset",
        type: "image",
        props: {
          name,
          src,
          w: dims.w,
          h: dims.h,
          mimeType: "image/png",
          isAnimated: false,
        },
        meta: {},
      },
    ]);
    const shapeId = createShapeId();
    editor.createShape({
      id: shapeId,
      type: "image",
      x: pos.x,
      y: pos.y,
      props: { assetId, w: CARD_W, h: (dims.h / dims.w) * CARD_W },
    });
    return { shapeId, assetId };
  }

  function placeVideo(
    editor: Editor,
    entry: FileEntry,
    pos: { x: number; y: number },
  ): { shapeId: TLShapeId; assetId: TLAssetId } {
    const assetId = AssetRecordType.createId();
    editor.createAssets([
      {
        id: assetId,
        typeName: "asset",
        type: "video",
        props: {
          name: entry.name,
          src: convertFileSrc(entry.path),
          w: 640,
          h: 360,
          mimeType: entry.name.toLowerCase().endsWith(".mov")
            ? "video/quicktime"
            : "video/mp4",
          isAnimated: true,
        },
        meta: {},
      },
    ]);
    const shapeId = createShapeId();
    editor.createShape({
      id: shapeId,
      type: "video",
      x: pos.x,
      y: pos.y,
      props: { assetId, w: 480, h: 270 },
    });
    return { shapeId, assetId };
  }

  function track(entry: FileEntry, item: { shapeId: TLShapeId; assetId: TLAssetId }) {
    itemsByInode.current.set(entry.inode, {
      ...item,
      path: entry.path,
      kind: entry.kind === "video" ? "video" : "image",
    });
  }

  async function chooseWorkspace() {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || !editorRef.current) return;
    const editor = editorRef.current;
    const entries = await setWorkspace(dir);
    entriesRef.current = entries;
    setWorkspaceState(dir);
    itemsByInode.current.clear();
    placedCount.current = 0;
    const existing = [...editor.getCurrentPageShapeIds()];
    if (existing.length > 0) editor.deleteShapes(existing);

    const images = entries.filter((e) => e.kind === "image");
    const videos = entries.filter((e) => e.kind === "video").slice(0, 4);

    for (const entry of images.slice(0, 60)) {
      const item = await placeImage(
        editor,
        entry.name,
        convertFileSrc(entry.path),
        gridPos(placedCount.current++),
      );
      track(entry, item);
    }
    for (const entry of videos) {
      track(entry, placeVideo(editor, entry, gridPos(placedCount.current++)));
    }
    editor.zoomToFit();
    setShapeCount(editor.getCurrentPageShapeIds().size);
    logLine(`workspace: ${dir} — ${images.length} images, ${videos.length} videos`);
  }

  async function spawn200() {
    const editor = editorRef.current;
    if (!editor) return;
    const images = entriesRef.current.filter((e) => e.kind === "image");
    if (images.length === 0) {
      logLine("no images in workspace to spawn from");
      return;
    }
    const deficit = 200 - editor.getCurrentPageShapeIds().size;
    for (let i = 0; i < deficit; i++) {
      const entry = images[i % images.length];
      await placeImage(
        editor,
        entry.name,
        convertFileSrc(entry.path),
        gridPos(placedCount.current++),
      );
    }
    setShapeCount(editor.getCurrentPageShapeIds().size);
    logLine(`canvas at ${editor.getCurrentPageShapeIds().size} shapes`);
  }

  async function makePosters() {
    const editor = editorRef.current;
    if (!editor) return;
    for (const entry of entriesRef.current.filter((e) => e.kind === "video")) {
      try {
        const posterPath = await generatePoster(entry.path);
        await placeImage(
          editor,
          `${entry.name} (poster)`,
          convertFileSrc(posterPath),
          gridPos(placedCount.current++),
        );
        logLine(`poster: ${entry.name}`);
      } catch (e) {
        logLine(`poster failed: ${entry.name} — ${JSON.stringify(e)}`);
      }
    }
    setShapeCount(editor.getCurrentPageShapeIds().size);
  }

  // Watcher → debounced rescan → inode-keyed reconcile (gate items 6 + 7).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = onFsEvent((event) => {
      logLine(
        `fs: ${event.kind} ${event.paths.map((p) => p.split("/").pop()).join(", ")}`,
      );
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const editor = editorRef.current;
        if (!editor) return;
        const entries = await rescan();
        const seen = new Set<number>();
        for (const entry of entries) {
          seen.add(entry.inode);
          const tracked = itemsByInode.current.get(entry.inode);
          if (tracked && tracked.path !== entry.path) {
            const asset = editor.getAsset(tracked.assetId);
            if (!asset) continue;
            editor.updateAssets([
              {
                ...asset,
                props: {
                  ...asset.props,
                  src: convertFileSrc(entry.path),
                  name: entry.name,
                },
              } as never,
            ]);
            logLine(
              `rename reconciled: ${tracked.path.split("/").pop()} → ${entry.name} (identity kept)`,
            );
            tracked.path = entry.path;
          }
        }
        for (const [inode, tracked] of itemsByInode.current) {
          if (!seen.has(inode)) {
            logLine(`missing: ${tracked.path.split("/").pop()} (tombstone in v0)`);
          }
        }
        entriesRef.current = entries;
      }, 300);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Finder drop at exact world coordinates (gate item 4).
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop") return;
      const editor = editorRef.current;
      if (!editor) return;
      const { x, y } = event.payload.position;
      const point = editor.screenToPage({
        x: x / window.devicePixelRatio,
        y: y / window.devicePixelRatio,
      });
      try {
        const imported = await importFiles(event.payload.paths);
        let offset = 0;
        for (const entry of imported) {
          const pos = { x: point.x + offset, y: point.y + offset };
          if (entry.kind === "image") {
            const item = await placeImage(
              editor,
              entry.name,
              convertFileSrc(entry.path),
              pos,
            );
            track(entry, item);
          } else if (entry.kind === "video") {
            track(entry, placeVideo(editor, entry, pos));
          } else {
            logLine(`imported, no spike shape: ${entry.name}`);
          }
          offset += 24;
        }
        setShapeCount(editor.getCurrentPageShapeIds().size);
        logLine(
          `dropped ${imported.length} file(s) at ${Math.round(point.x)},${Math.round(point.y)}`,
        );
      } catch (e) {
        logLine(`drop failed: ${JSON.stringify(e)}`);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="spike-root">
      <div className="spike-toolbar">
        <button onClick={chooseWorkspace}>Choose workspace</button>
        <button onClick={spawn200} disabled={!workspace}>
          Spawn 200
        </button>
        <button onClick={makePosters} disabled={!workspace}>
          Generate posters
        </button>
        <span className="spike-meta">
          {workspace ?? "no workspace"} · {shapeCount} shapes
        </span>
        <span className="spike-fps">
          {fps.fps} fps · p95 {fps.p95} ms
        </span>
      </div>
      <div className="spike-canvas">
        <Tldraw
          onMount={(editor) => {
            editorRef.current = editor;
          }}
        />
      </div>
      <div className="spike-log">
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
