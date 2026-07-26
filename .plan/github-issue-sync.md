---
title: "GitHub issue snapshot"
date: 2026-07-26
status: approved
affects: "Local issue tracking"
---

## Context

Terrazzo's issues exist only on GitHub. The repository needs local, linkable snapshots without creating a second source of truth. GitHub remains canonical.

## Changes

1. Add `scripts/sync-github-issues.mjs` to fetch every open and closed GitHub issue through the authenticated `gh` CLI.
2. Generate stable `.issues/iss-NNNN.md` snapshots with upstream metadata and unmodified issue bodies.
3. Generate `.issues/index.md` with links and current GitHub state.
4. Add `pnpm issues:pull` as the repeatable synchronization command.

## Files touched

```text
┌────────────────────────────────┬───────────────────────────────┐
│ File                           │ Action                        │
├────────────────────────────────┼───────────────────────────────┤
│ package.json                   │ Edit (add synchronization)    │
│ scripts/sync-github-issues.mjs │ Create (pull and render)      │
│ .issues/index.md               │ Generate (issue index)        │
│ .issues/iss-NNNN.md            │ Generate (issue snapshots)    │
└────────────────────────────────┴───────────────────────────────┘
```

## Verification

1. Run `pnpm issues:pull`.
2. Run it again and confirm that it produces no diff.
3. Confirm that all GitHub issue numbers, states, URLs, timestamps, and bodies match upstream.
4. Run `kdb check projects/terrazzo`.
5. Run `git diff --check`.
