---
title: "RCA: layout changes revert across canvas remounts"
date: 2026-07-26
status: open
affects: "Canvas layout persistence"
---

## Context

`CanvasView` owns the tldraw editor and debounces layout writes by 400 ms. `App` replaces the canvas with `DocumentView` or `MediaView` when an item opens. Returning creates a new canvas and reads `.canvas/layout.json` again.

This analysis covers [ISS-0016](../.issues/iss-0016.md). Failed-write retention is the related but broader [ISS-0011](../.issues/iss-0011.md).

Implementation follows the [layout reversion fix plan](fix-layout-reversion.md).

## Problem statement

Moving or resizing a card immediately before opening a note can be lost. Returning to the canvas can show the card at its earlier persisted position.

## RCA

The old canvas starts its final layout write after navigation has already committed. Nothing makes the replacement canvas wait for that write before reading the sidecar.

The failure path is:

1. A tldraw user mutation adds the item ID to `dirty.current` and starts a 400 ms timer in `CanvasView`.
2. Opening a note changes `App.mode` immediately. React unmounts `CanvasView`.
3. The effect cleanup cancels the timer, copies and clears the dirty IDs, and starts `applyLayout` without awaiting it.
4. Closing the note mounts a new `CanvasView`.
5. The new canvas can call `openDirectory` before the previous `applyLayout` finishes.
6. Hydration therefore reads the old frame from `layout.json`.

Clearing the dirty set before acknowledgement creates a second failure mode. If the final write fails, the component has already unmounted and no state remains from which to retry or report the unsaved layout.

The Rust write is atomic, but atomic replacement does not order separate frontend commands. It prevents a partial sidecar; it does not ensure that a later read observes an earlier unawaited write.

Concurrent uncommitted work has begun introducing `src/canvas/layoutQueue.ts`. Its per-directory promise tail and pre-hydration barrier address the ordering failure. The integration is incomplete: the teardown path still calls an import that has been removed, and there is no regression-test harness or complete user-visible failed-save lifecycle.

## Proposed fix

Finish the per-directory serialized writer as the minimum repair for ISS-0016:

1. Route the teardown flush through the same per-directory queue as debounced writes.
2. Make every canvas hydration await the directory queue tail before calling `openDirectory`.
3. Retain the latest delta per item when a write fails so a remount cannot hydrate an older visible frame.
4. Overlay retained deltas during hydration and requeue them without allowing an older delta to supersede a newer one.
5. Add focused tests for queue ordering, teardown followed by hydration, and retained-delta replacement.

Do not solve navigation by inserting arbitrary delays. Do not rely on React cleanup being awaitable.

ISS-0011 should follow as a separate pass. It needs retry policy and a persistent saved/saving/unsaved UI state beyond the ordering repair required for ISS-0016.

## Relevant files

**Fix targets:**

- `src/canvas/layoutQueue.ts`—own per-directory write ordering and retained failed deltas.
- `src/canvas/CanvasView.tsx`—enqueue teardown writes and await the queue before hydration.
- `src/canvas/layoutQueue.test.ts`—cover ordering and failure retention.

**Flow:**

- `src/app/App.tsx`—switches between canvas, document, and media modes.
- `src/app/ipc/commands.ts`—invokes the Rust layout command.
- `src-tauri/src/commands.rs`—validates the active directory and calls the layout service.
- `src-tauri/src/workspace/layout.rs`—reads, updates, and atomically replaces `layout.json`.

**Downstream:**

- `src/document/DocumentView.tsx`—causes the canvas-to-document transition but does not own canvas persistence.
- `src/media/MediaView.tsx`—uses the same remount lifecycle.
