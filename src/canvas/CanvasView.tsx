// The real canvas (M1): hydrates one directory's immediate children as item
// shapes. Positions are session-only until the layout sidecar lands in M2;
// identity across fs events is inode-keyed until sidecar UUIDs replace it.

import { useEffect, useRef, useState } from "react";
import { Editor, TLShapeId, Tldraw, createShapeId } from "tldraw";
import "tldraw/tldraw.css";
import { listDir } from "../app/ipc/commands";
import { onFsEvent } from "../app/ipc/events";
import type { FileEntry } from "../app/ipc/types";
import {
  ITEM_H,
  ITEM_W,
  ItemShape,
  ItemShapeUtil,
} from "./shapes/ItemShapeUtil";
import "./canvas.css";

const shapeUtils = [ItemShapeUtil];

const GAP = 32;
const COLS = 8;

function gridPos(i: number) {
  return {
    x: (i % COLS) * (ITEM_W + GAP),
    y: Math.floor(i / COLS) * (ITEM_H + GAP),
  };
}

function itemShape(entry: FileEntry, index: number) {
  return {
    id: createShapeId(),
    type: "item" as const,
    ...gridPos(index),
    props: {
      w: ITEM_W,
      h: ITEM_H,
      name: entry.name,
      kind: entry.kind,
      path: entry.path,
    },
  };
}

export default function CanvasView({
  directoryPath,
}: {
  directoryPath: string;
}) {
  const editorRef = useRef<Editor | null>(null);
  const shapeByInode = useRef<Map<number, TLShapeId>>(new Map());
  const placed = useRef(0);
  const [status, setStatus] = useState("");

  async function hydrate(editor: Editor) {
    const entries = await listDir(directoryPath);
    const existing = [...editor.getCurrentPageShapeIds()];
    if (existing.length > 0) editor.deleteShapes(existing);
    shapeByInode.current.clear();

    const shapes = entries.map((entry, i) => {
      const shape = itemShape(entry, i);
      shapeByInode.current.set(entry.inode, shape.id);
      return shape;
    });
    placed.current = shapes.length;
    if (shapes.length > 0) {
      editor.createShapes<ItemShape>(shapes);
      editor.zoomToFit();
    }
    setStatus(`${entries.length} items`);
  }

  // Watcher → debounced re-list → inode-keyed reconcile. Surviving items keep
  // their shape (and position); new items append to the grid; missing items
  // are removed. M2 swaps inodes for sidecar UUIDs and adds tombstones.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = onFsEvent(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const editor = editorRef.current;
        if (!editor) return;
        const entries = await listDir(directoryPath);
        const seen = new Set<number>();

        for (const entry of entries) {
          seen.add(entry.inode);
          const shapeId = shapeByInode.current.get(entry.inode);
          if (!shapeId) {
            const shape = itemShape(entry, placed.current++);
            shapeByInode.current.set(entry.inode, shape.id);
            editor.createShapes<ItemShape>([shape]);
          } else {
            const shape = editor.getShape(shapeId) as ItemShape | undefined;
            if (shape && shape.props.path !== entry.path) {
              editor.updateShapes<ItemShape>([
                {
                  id: shapeId,
                  type: "item",
                  props: { name: entry.name, path: entry.path },
                },
              ]);
            }
          }
        }

        for (const [inode, shapeId] of shapeByInode.current) {
          if (!seen.has(inode)) {
            editor.deleteShapes([shapeId]);
            shapeByInode.current.delete(inode);
          }
        }
        setStatus(`${entries.length} items`);
      }, 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unlisten.then((fn) => fn());
    };
  }, [directoryPath]);

  return (
    <div className="canvas-root">
      <Tldraw
        shapeUtils={shapeUtils}
        onMount={(editor) => {
          editorRef.current = editor;
          hydrate(editor);
        }}
      />
      <div className="canvas-status">{status}</div>
    </div>
  );
}
