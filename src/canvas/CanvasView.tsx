// One directory's canvas (M2): the tldraw store is a projection of the
// directory listing + layout.json (v0 plan §4.2). Hydration reads reconciled
// items from open_directory; user interactions project back as typed layout
// deltas after the interaction ends (§4.4). Identity is the sidecar UUIDv7 —
// the tldraw shape id is derived from it, so lookups are O(1) both ways.
//
// The component is keyed by directoryPath in App: entering a folder remounts
// with a fresh store. Cameras persist per directory for the session only.

import { useEffect, useRef, useState } from "react";
import { Editor, Tldraw, createShapeId } from "tldraw";
import "tldraw/tldraw.css";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  applyLayout,
  ensureThumbnail,
  importFiles,
  openDirectory,
} from "../app/ipc/commands";
import { onFsEvent } from "../app/ipc/events";
import type { CanvasItem, LayoutDelta } from "../app/ipc/types";
import {
  ITEM_H,
  ITEM_W,
  ItemShape,
  ItemShapeUtil,
} from "./shapes/ItemShapeUtil";
import "./canvas.css";

const shapeUtils = [ItemShapeUtil];

// Strip stock tldraw chrome we don't want; more goes as the design pass
// replaces each piece (v0: the canvas is ours, the library is invisible).
const components = {
  StylePanel: null,
};

const GAP = 32;
const COLS = 8;

/** Session-only per-directory viewport (v0 plan §5.3 item 6). */
const cameraByDir = new Map<string, { x: number; y: number; z: number }>();

function shapeIdFor(itemId: string) {
  return createShapeId(itemId);
}

function itemIdFor(shapeId: string) {
  return shapeId.slice("shape:".length);
}

/** Grid slot for items that have never been placed. Starts below the lowest
 * framed item so new arrivals never land on top of an arrangement. */
function makePlacer(items: CanvasItem[]) {
  const framed = items.filter((i) => i.frame);
  const baseY =
    framed.length === 0
      ? 0
      : Math.max(...framed.map((i) => i.frame!.y + i.frame!.height)) + GAP;
  let slot = 0;
  return () => ({
    x: (slot % COLS) * (ITEM_W + GAP),
    y: baseY + Math.floor(slot++ / COLS) * (ITEM_H + GAP),
  });
}

function shapeFor(item: CanvasItem, place: () => { x: number; y: number }) {
  const frame = item.frame ?? { ...place(), width: ITEM_W, height: ITEM_H };
  return {
    id: shapeIdFor(item.id),
    type: "item" as const,
    x: frame.x,
    y: frame.y,
    rotation: item.rotation,
    props: {
      w: frame.width,
      h: frame.height,
      name: item.entry.name,
      kind: item.entry.kind,
      path: item.entry.path,
    },
  };
}

export default function CanvasView({
  directoryPath,
  onEnterDirectory,
  onOpenItem,
}: {
  directoryPath: string;
  onEnterDirectory: (path: string) => void;
  onOpenItem: (itemId: string) => void;
}) {
  const editorRef = useRef<Editor | null>(null);
  const knownIds = useRef<Set<string>>(new Set());
  const hydrating = useRef(false);
  const dirty = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState("");

  function deltasFor(editor: Editor, ids: string[]): LayoutDelta[] {
    const order = editor.getCurrentPageShapesSorted().map((s) => s.id);
    const out: LayoutDelta[] = [];
    for (const itemId of ids) {
      const shape = editor.getShape(shapeIdFor(itemId)) as
        | ItemShape
        | undefined;
      if (!shape) continue;
      out.push({
        id: itemId,
        frame: {
          x: shape.x,
          y: shape.y,
          width: shape.props.w,
          height: shape.props.h,
        },
        rotation: shape.rotation,
        zIndex: order.indexOf(shape.id),
      });
    }
    return out;
  }

  function scheduleFlush(editor: Editor) {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(async () => {
      const ids = [...dirty.current];
      dirty.current.clear();
      if (ids.length === 0) return;
      try {
        await applyLayout(directoryPath, deltasFor(editor, ids));
      } catch (e) {
        setStatus(`layout save failed: ${JSON.stringify(e)}`);
      }
    }, 400);
  }

  /** Deliver thumbnails as they generate (PR-014: placeholder until then).
   * Concurrency-limited; each delivery patches one shape's thumbnail prop.
   * Programmatic patches run under the hydrating flag so they never count
   * as layout changes. */
  async function fillThumbnails(editor: Editor, items: CanvasItem[]) {
    const queue = items.filter(
      (i) => i.entry.kind === "image" || i.entry.kind === "video",
    );
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        let url: string;
        if (item.entry.path.toLowerCase().endsWith(".svg")) {
          url = convertFileSrc(item.entry.path); // ffmpeg can't; svg is small
        } else {
          try {
            url = convertFileSrc(await ensureThumbnail(item.entry.path));
          } catch {
            continue; // unreadable/corrupt media keeps its placeholder card
          }
        }
        const shape = editor.getShape(shapeIdFor(item.id)) as
          | ItemShape
          | undefined;
        if (!shape || shape.props.thumbnail === url) continue;
        hydrating.current = true;
        try {
          editor.updateShapes<ItemShape>([
            { id: shape.id, type: "item", props: { thumbnail: url } },
          ]);
        } finally {
          hydrating.current = false;
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  }

  async function hydrate(editor: Editor) {
    hydrating.current = true;
    try {
      const items = await openDirectory(directoryPath);
      const place = makePlacer(items);
      const unplaced = items.filter((i) => !i.frame);
      knownIds.current = new Set(items.map((i) => i.id));
      if (items.length > 0) {
        editor.createShapes<ItemShape>(items.map((i) => shapeFor(i, place)));
      }
      const camera = cameraByDir.get(directoryPath);
      if (camera) {
        editor.setCamera(camera);
      } else {
        editor.zoomToFit();
      }
      setStatus(`${items.length} items`);
      // First placement of never-placed items is itself layout worth keeping.
      if (unplaced.length > 0) {
        await applyLayout(
          directoryPath,
          deltasFor(
            editor,
            unplaced.map((i) => i.id),
          ),
        );
      }
      void fillThumbnails(editor, items);
    } finally {
      hydrating.current = false;
    }
  }

  /** Reconcile after an external change: update, add, and remove shapes to
   * match the freshly reconciled item list, preserving arrangement. */
  async function reconcile(editor: Editor) {
    const items = await openDirectory(directoryPath);
    const place = makePlacer(items);
    const nextIds = new Set(items.map((i) => i.id));

    hydrating.current = true;
    try {
      for (const item of items) {
        const shapeId = shapeIdFor(item.id);
        const shape = editor.getShape(shapeId) as ItemShape | undefined;
        if (!shape) {
          editor.createShapes<ItemShape>([shapeFor(item, place)]);
          if (!item.frame) {
            await applyLayout(directoryPath, deltasFor(editor, [item.id]));
          }
        } else if (
          shape.props.path !== item.entry.path ||
          shape.props.name !== item.entry.name
        ) {
          editor.updateShapes<ItemShape>([
            {
              id: shapeId,
              type: "item",
              props: { name: item.entry.name, path: item.entry.path },
            },
          ]);
        }
      }
      for (const known of knownIds.current) {
        if (!nextIds.has(known)) {
          editor.deleteShapes([shapeIdFor(known)]);
        }
      }
    } finally {
      knownIds.current = nextIds;
      hydrating.current = false;
    }
    setStatus(`${items.length} items`);
    void fillThumbnails(editor, items);
  }

  // User interactions → dirty item ids → debounced sidecar flush.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const unlisten = editor.store.listen(
      (entry) => {
        if (hydrating.current) return;
        const touched = [
          ...Object.values(entry.changes.added),
          ...Object.values(entry.changes.updated).map(([, after]) => after),
        ];
        let sawItem = false;
        for (const record of touched) {
          if (record.typeName === "shape" && record.type === "item") {
            dirty.current.add(itemIdFor(record.id));
            sawItem = true;
          }
        }
        if (sawItem) scheduleFlush(editor);
      },
      { source: "user", scope: "document" },
    );
    return unlisten;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryPath]);

  // External fs events touching this directory → debounced reconcile.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const parent = (p: string) => p.slice(0, p.lastIndexOf("/"));
    const unlisten = onFsEvent((event) => {
      if (!event.paths.some((p) => parent(p) === directoryPath)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const editor = editorRef.current;
        if (editor) reconcile(editor);
      }, 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryPath]);

  // Finder drop: copy into this directory (never move, PR-013), then place
  // the new items at the drop point and persist their frames immediately.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop") return;
      const editor = editorRef.current;
      if (!editor) return;
      const point = editor.screenToPage({
        x: event.payload.position.x / window.devicePixelRatio,
        y: event.payload.position.y / window.devicePixelRatio,
      });
      try {
        const imported = await importFiles(event.payload.paths, directoryPath);
        const importedPaths = new Set(imported.map((e) => e.path));
        const items = await openDirectory(directoryPath);
        const dropped = items.filter((i) => importedPaths.has(i.entry.path));

        hydrating.current = true;
        try {
          dropped.forEach((item, i) => {
            const offset = i * 24;
            editor.createShapes<ItemShape>([
              {
                ...shapeFor(item, () => ({ x: 0, y: 0 })),
                x: point.x + offset,
                y: point.y + offset,
              },
            ]);
            knownIds.current.add(item.id);
          });
        } finally {
          hydrating.current = false;
        }
        if (dropped.length > 0) {
          await applyLayout(
            directoryPath,
            deltasFor(
              editor,
              dropped.map((i) => i.id),
            ),
          );
          void fillThumbnails(editor, dropped);
        }
        setStatus(`imported ${dropped.length} file(s)`);
      } catch (e) {
        setStatus(`import failed: ${JSON.stringify(e)}`);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryPath]);

  // Save the viewport when leaving this directory.
  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (editor) cameraByDir.set(directoryPath, editor.getCamera());
    };
  }, [directoryPath]);

  return (
    <div className="canvas-root">
      <Tldraw
        shapeUtils={shapeUtils}
        components={components}
        onMount={(editor) => {
          editorRef.current = editor;
          const util = editor.getShapeUtil("item") as ItemShapeUtil;
          util.onOpen = (shape) => {
            if (shape.props.kind === "dir") {
              onEnterDirectory(shape.props.path);
            } else if (
              shape.props.kind === "image" ||
              shape.props.kind === "video"
            ) {
              onOpenItem(itemIdFor(shape.id));
            }
          };
          hydrate(editor);
        }}
      />
      <div className="canvas-status">{status}</div>
    </div>
  );
}
