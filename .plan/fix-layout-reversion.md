---
title: "Fix layout reversion across canvas remounts"
date: 2026-07-26
status: draft
affects: "ISS-0016 and TRZ-0007"
---

## Context

[The RCA](rca-layout-reversion.md) identifies an ordering failure between the old canvas's unawaited teardown write and the replacement canvas's hydration read. Existing uncommitted work introduces a per-directory queue but has not completed its integration or verification.

This pass fixes the reproducible navigation race in [ISS-0016](../.issues/iss-0016.md). The broader retry and saved-state behavior in [ISS-0011](../.issues/iss-0011.md) remains the next persistence task.

## Changes

1. Finish `src/canvas/layoutQueue.ts`.
   - Serialize writes per directory in submission order.
   - Expose a barrier that resolves after all writes submitted before the call have settled.
   - Retain only the newest failed delta for each item.
   - Ensure successful newer writes discard stale retained deltas.
   - Remove settled queue tails when safe so visiting many directories does not grow session state indefinitely.

2. Finish the `src/canvas/CanvasView.tsx` integration.
   - Send debounced and teardown writes through the queue.
   - Await the queue barrier before `openDirectory`.
   - Overlay retained deltas before creating tldraw shapes and requeue them.
   - Preserve the current user-visible error message when a write fails.
   - Do not alter the concurrent selection, hover, or card-opening work.

3. Add a focused TypeScript test harness and `src/canvas/layoutQueue.test.ts`.
   - Inject or otherwise isolate the layout writer so tests do not require Tauri.
   - Prove that hydration waits for the final teardown write.
   - Prove that writes cannot complete out of order.
   - Prove that a failed delta survives and that a newer successful delta supersedes it.

4. Update tracking after verification.
   - Mark ISS-0016 and TRZ-0007 complete only after the user reproduction passes.
   - Keep ISS-0011 open for bounded retry and explicit saved/saving/unsaved state.

## Files touched

```text
┌────────────────────────────────┬────────────────────────────────────────────┐
│ File                           │ Action                                     │
├────────────────────────────────┼────────────────────────────────────────────┤
│ src/canvas/layoutQueue.ts      │ Edit (complete ordered persistence queue)  │
│ src/canvas/CanvasView.tsx      │ Edit (finish queue integration)            │
│ src/canvas/layoutQueue.test.ts │ Create (persistence race regression tests) │
│ package.json                   │ Edit (add test command if absent)          │
│ lockfile                       │ Edit only if a test dependency is required │
│ .issues/index.md               │ Regenerate after issue state changes       │
│ .tasks/index.md                │ Regenerate after task state changes        │
└────────────────────────────────┴────────────────────────────────────────────┘
```

## Verification

1. Run the layout queue unit tests.
2. Run the full TypeScript build.
3. Run Rust tests to confirm the existing atomic sidecar behavior still passes.
4. Manually move a card and open a note inside the 400 ms debounce window.
5. Return immediately and confirm position, size, rotation, and stacking order remain unchanged.
6. Repeat outside the debounce window and across several rapid open-close cycles.
7. Repeat with an image or video focus view.
8. Simulate one rejected layout write and confirm the visible frame is retained on remount.
9. Run `git diff --check`.
10. Run `kdb check projects/terrazzo`.
