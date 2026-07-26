# terrazzo :: Product Requirements

Last updated: `2026.07.26`

> A local-first spatial file browser — an infinite canvas with Figma-grade precision over one user-selected directory tree, where every folder inside the workspace root is itself a canvas. For personal media, reference, and document boards. Stack decision (tldraw + Tauri over native AppKit) in [ADR-001](.decisions/adr-001-canvas-engine.md).

---

## Principles

1. **The filesystem is canonical.** Every canvas is an ordinary directory; every item is an ordinary file. The app is disposable — the data opens in Finder, backs up with Time Machine, versions with git, and moves without export. Any index or thumbnail cache must be rebuildable from the files alone.
2. **A spatial file browser, not a design tool.** terrazzo places and arranges files; it does not create or edit design objects. No vector tools, no components, no auto-layout, no multiplayer, no comments, no plugins. This exclusion list is the defense against the central product risk: drifting into "Figma plus Notion plus Finder."
3. **Figma precision, nothing else from Figma.** Exact coordinates, grid snapping, alignment guides, keyboard nudging, smooth pan/zoom. The satisfying part of Figma is the interaction fidelity, and that is the only part terrazzo inherits.
4. **Recursion is bounded by the workspace root.** One user-selected directory is the top-level canvas and security boundary. Navigation never goes above it; folders below it are canvases with no artificial depth limit. Entering a folder should feel like entering a room, not clicking through a decorated Finder.
5. **Generation produces files.** Generative features are optional and provider-neutral. Content leaves the workspace only on an explicit generation action; every completed output is written into the current directory as an ordinary file. Provider accounts and remote generation histories are never canonical.

Structure follows the standard domain → feature (`F-xxx`) → requirement (`PR-xxx`) ontology; see the PRD template (`kernel/templates/product/prd.md`) for level definitions and ID conventions.

---

## 1. Domains

| Domain | Abbrev | What it covers |
|---|---|---|
| **Canvas** | `CV` | The interaction surface — pan/zoom, selection, manipulation, precision (snapping, guides, coordinates) |
| **Media** | `ME` | Rendering file types on the canvas and opening focused image, video, PDF, and Markdown views |
| **Storage** | `ST` | The on-disk model — layout sidecars, thumbnails, file identity, external-change reconciliation |
| **Navigation** | `NV` | Workspace-bounded recursion — folder cards, entering/leaving canvases, breadcrumbs |
| **Generation** | `GE` | Optional image and video generation — variations, references, asynchronous jobs, and local output provenance |

---

## 2. Features

Cross-cutting requirements (deletion semantics, performance floor) live in §3.6.

### 2.1 — Canvas

| Feature | Description | Requirements | Priority |
|---|---|---|---|
| **F-CV1** — Infinite canvas | Smooth pan/zoom surface with selection and manipulation | PR-001, PR-002 | P0 |
| **F-CV2** — Precision | Exact coordinates, grid snapping, alignment guides, keyboard nudging | PR-003, PR-004 | P0 |

### 2.2 — Media

| Feature | Description | Requirements | Priority |
|---|---|---|---|
| **F-ME1** — Images | Image files render as canvas objects | PR-005 | P0 |
| **F-ME2** — Video | Videos with poster frames at rest, playback on demand | PR-006, PR-007 | P0 |
| **F-ME3** — Documents | PDF previews and rendered markdown notes | PR-008, PR-009 | P1 |
| **F-ME4** — Fallback previews | Quick Look thumbnails for everything else | PR-010 | P2 |
| **F-ME5** — Note editor | Click a note card to open a beautiful in-app markdown editor (Spatial's pattern), with Vim mode | PR-023, PR-024 | P1 |
| **F-ME6** — Media viewer | Open an image or video in a dedicated Spatial-style viewing surface | PR-031 | P0 |

### 2.3 — Storage

| Feature | Description | Requirements | Priority |
|---|---|---|---|
| **F-ST0** — Workspace root | One selected directory bounds navigation, watching, asset access, and filesystem commands | PR-030 | P0 |
| **F-ST1** — Layout sidecar | Presentation state persisted per directory in `.canvas/` | PR-011, PR-012 | P0 |
| **F-ST2** — Import | Drag files in from Finder; thumbnails generated off the UI thread | PR-013, PR-014 | P0 |
| **F-ST3** — External changes | Reconcile the canvas when files change outside the app | PR-015, PR-016 | P1 |

### 2.4 — Navigation

| Feature | Description | Requirements | Priority |
|---|---|---|---|
| **F-NV1** — Recursive folders | Folder cards on the canvas; each folder is its own canvas | PR-017, PR-018 | P0 |
| **F-NV2** — Wayfinding | Breadcrumbs and back-navigation through the nesting | PR-019 | P0 |

### 2.5 — Generation

| Feature | Description | Requirements | Priority |
|---|---|---|---|
| **F-GE1** — Image generation | Generate images from prompts and create variations from selected canvas images | PR-025, PR-026 | P2 |
| **F-GE2** — Video generation | Generate video from prompts or animate a selected image | PR-027 | P2 |
| **F-GE3** — Generation jobs | Provider-neutral asynchronous jobs with local outputs and durable provenance | PR-028, PR-029 | P2 |

---

## 3. Product Requirements

### 3.1 — Canvas

| Requirement | Description | Feature | Priority |
|---|---|---|---|
| **PR-001** — Pan/zoom | Infinite canvas with smooth pan and zoom via wheel, trackpad pinch, and keyboard shortcuts. No document bounds. | F-CV1 | P0 |
| **PR-002** — Manipulation | Multi-select (click, shift-click, marquee), drag, and resize with aspect lock. Full undo/redo covers presentation-state operations only; filesystem operations such as import, copy, rename, and Trash are excluded from canvas history. | F-CV1 | P0 |
| **PR-003** — Coordinates | Every item has exact world coordinates and dimensions, inspectable and editable numerically. All operations resolve in world space. | F-CV2 | P0 |
| **PR-004** — Snapping | Grid snapping (configurable pitch), alignment guides against sibling items during drag/resize, and arrow-key nudging (1px, 10px with shift). | F-CV2 | P0 |

### 3.2 — Media

| Requirement | Description | Feature | Priority |
|---|---|---|---|
| **PR-005** — Image rendering | PNG, JPEG, GIF, SVG, and WebP render as canvas objects at native aspect ratio, downsampled to viewport resolution when zoomed out. Activating an image opens the focused media view under PR-031. | F-ME1 | P0 |
| **PR-006** — Video posters | Videos display generated poster frames on the canvas. Canvas video objects do not mount live `<video>` elements or expose playback timelines; playback belongs to the focused media view under PR-031. | F-ME2 | P0 |
| **PR-007** — Video playback | The focused media view provides play, pause, volume, and seeking. Clicking a point on the timeline must jump there promptly. Smooth continuous preview while dragging the timeline thumb is not a v0 requirement. The canvas has no video scrubber. | F-ME2 | P0 |
| **PR-008** — PDF previews | PDFs render first-page previews; click opens a paging view or hands off to the system viewer. | F-ME3 | P1 |
| **PR-009** — Markdown notes | `.md` files render as styled note cards using cached static HTML, not mounted CodeMirror instances. Cards and the editor share the same Markdown parser configuration and typography, but only the active document mounts an editor runtime. | F-ME3 | P1 |
| **PR-010** — Quick Look fallback | Any format terrazzo doesn't render itself gets a `qlmanage`-generated thumbnail and opens via Quick Look / system default. | F-ME4 | P2 |
| **PR-023** — In-app editor | Clicking a note card opens a full editing surface (Spatial's pattern). CodeMirror 6 with permanent WYSIWYG decorations: markdown syntax (`**`, `#`, link targets) is **never revealed** — not on cursor entry, not on selection (explicitly rejecting Obsidian's reveal behavior). Markers stay hidden as atomic ranges; formatting is applied via commands (Cmd+B/I/K, Cmd+1–3) that edit the hidden markers programmatically. Escape hatch: an explicit source-mode toggle shows raw markdown on request. The markdown buffer is canonical — no rich-text document model, no parse/serialize round trip, unknown syntax never lost (Principle 1). Chrome stripped: no gutters, no line numbers, proportional font. Autosaves to disk; closing returns to the canvas. Architecture in [ADR-002](.decisions/adr-002-note-editor.md). | F-ME5 | P1 |
| **PR-024** — Vim mode | Vim is a dynamically toggled CodeMirror compartment extension (`@replit/codemirror-vim`). Enabling Vim also disables WYSIWYG concealment and enters syntax-visible Markdown source mode, so motions and operators act on the same characters the user sees. Normal, insert, and visual modes, counts, operators, mappings, and Ex commands retain their standard buffer semantics. A visible indicator shows the active mode. Escape belongs to Vim; leaving the editor is `:q`, `:wq`, or an explicit shortcut. `:w` saves immediately. Disabling Vim restores the concealed writing view. | F-ME5 | P2 |
| **PR-031** — Focused media view | Activating an image or video opens an in-app media mode patterned after Spatial rather than handing the file to an external editor. The media occupies the main visual field against quiet chrome. A secondary metadata area shows the filename, media type, pixel dimensions or video resolution, file size, and created/modified dates when available; an optional notes or caption area may appear below. Images fit within the available viewport without altering the file. Videos use the controls defined by PR-007. Closing or navigating back returns to the same canvas camera, selection, and scroll state. Automatic color-palette extraction and media editing are not required in v0. | F-ME6 | P0 |

### 3.3 — Storage

| Requirement | Description | Feature | Priority |
|---|---|---|---|
| **PR-030** — Workspace root | The user selects one directory as the workspace root. Its `.canvas/workspace.json` stores `schemaVersion`, durable `workspaceId`, and display `name`. The root is the top breadcrumb and the upper boundary for navigation, scanning, watching, asset serving, search, and filesystem commands. Every target is canonicalized and must remain a descendant of the root; a symlink resolving outside it is blocked and rendered as a tombstone. v0 opens one workspace at a time, without imposing a depth limit on descendant folders. | F-ST0 | P0 |
| **PR-011** — Sidecar format | Each directory's canvas state lives in `.canvas/layout.json`: per-item path, identity hints, frame, rotation, and z-index, keyed by durable UUID. Presentation state and provenance only — no file content or duplicate assets. Format spec in §3.7. | F-ST1 | P0 |
| **PR-012** — Rebuildable caches | `.canvas/thumbnails/` and any future search index are derived data, rebuildable from the files alone. Deleting `.canvas/` loses layout, never content. | F-ST1 | P0 |
| **PR-013** — Finder drag-in | Files dragged from Finder onto the canvas are copied into the directory by default and placed at the drop point. Move is available only as an explicit modifier or command. Name collisions never overwrite an existing file silently. | F-ST2 | P0 |
| **PR-014** — Async thumbnails | Poster frames and thumbnails generate in a background process (ffmpeg / qlmanage); the canvas shows a placeholder until they land. UI never blocks on import. | F-ST2 | P0 |
| **PR-015** — File watching | A filesystem watcher reconciles the canvas live: new files get a default placement, deleted files get a tombstone (not a crash), modified files refresh their preview. | F-ST3 | P1 |
| **PR-016** — Identity across renames | Items carry durable UUIDs; reconciliation matches path first, then unique `(device, inode)` confirmed by mtime and size (Zed's technique, made durable — see §3.7). Content hashes are not used for identity: hashing multi-GB videos on every scan is too costly, and an edited file should keep its identity. Known loss: renames made on another machine between syncs (inodes don't survive iCloud/rclone/git) tombstone per PR-022. | F-ST3 | P1 |

### 3.4 — Navigation

| Requirement | Description | Feature | Priority |
|---|---|---|---|
| **PR-017** — Folder cards | Subdirectories appear as folder cards on the parent canvas — placeable, resizable objects like any other item, with a preview of their contents. | F-NV1 | P0 |
| **PR-018** — Enter/exit | Double-clicking a folder card enters that directory's canvas. Descendant nesting has no application-imposed depth limit, but navigation cannot leave the workspace root. The transition should feel spatial (Principle 4). | F-NV1 | P0 |
| **PR-019** — Breadcrumbs | A persistent breadcrumb trail starts at the workspace root and shows the current descendant path; any ancestor within the workspace is one click away. No parent action exists at the root. Standard back/forward shortcuts work. | F-NV2 | P0 |

### 3.5 — Generation

| Requirement | Description | Feature | Priority |
|---|---|---|---|
| **PR-025** — Prompt-to-image | A prompt bar generates images through a selected provider and model. Count, aspect ratio, and provider-supported settings are explicit. Completed outputs are saved into the current directory before appearing as ordinary image objects on the canvas. | F-GE1 | P2 |
| **PR-026** — Image variations | Selecting one image exposes **Vary**. The default action requests four related variations using the selected image as a reference and places completed outputs in a grid beside the source. The source is never modified. Each variation can become the parent of another generation. This follows the interaction used by [Adobe Firefly Boards](https://helpx.adobe.com/ae_en/firefly/create-mood-boards/firefly-boards/generate-image-variations.html), while keeping outputs local and provider-neutral. | F-GE1 | P2 |
| **PR-027** — Video generation | A prompt can generate a video, and a selected image can serve as the first frame or visual reference for image-to-video. Completed videos are saved into the current directory and behave like imported videos under PR-006/007. | F-GE2 | P2 |
| **PR-028** — Asynchronous jobs | Generation creates a placeholder at the intended canvas position with queued, running, failed, canceled, or completed state. Jobs support progress when the provider exposes it, cancellation, retry, and restart recovery. Failed or canceled jobs never leave partial files in the workspace. | F-GE3 | P2 |
| **PR-029** — Provenance | Every completed generation records provider, model, prompt, settings, creation time, output UUID, and parent/reference UUIDs in `.canvas/generations/<output-uuid>.json`. API credentials remain in the system keychain. Deleting `.canvas/` loses provenance and job history, never the generated media files. | F-GE3 | P2 |

### 3.6 — Cross-cutting

| Requirement | Description | Priority |
|---|---|---|
| **PR-020** — File deletion | There is no layout-only removal. **Move to Trash** removes the actual file from the workspace through the system Trash and removes its layout entry after the filesystem operation succeeds. It is an explicit filesystem command, not part of canvas undo/redo. External deletion still produces a tombstone under PR-015/022; intentional Trash does not. | P0 |
| **PR-021** — Performance floor | A canvas with 200 items (mixed images/videos as posters) pans and zooms at 60fps on Apple Silicon. Viewport culling for off-screen items. | P0 |
| **PR-022** — Graceful degradation | Missing files, aliases, permission failures, and symlinks resolving outside the workspace root render as labeled tombstones — never a crash, never silent omission. | P1 |

### 3.7 — Sidecar format

Each directory is simultaneously a real folder and a canvas:

```text
Workspace/
├── .canvas/
│   ├── workspace.json     # workspace identity; root only
│   ├── layout.json        # presentation state only
│   └── thumbnails/        # generated, always rebuildable
├── GTM/
│   ├── .canvas/layout.json
│   ├── launch-video.mov
│   ├── positioning.md
│   └── Campaigns/
│       ├── .canvas/layout.json
│       └── campaign-brief.pdf
└── Branding/
    ├── .canvas/layout.json
    └── logo.svg
```

`workspace.json` exists only at the selected root:

```json
{
  "schemaVersion": 1,
  "workspaceId": "0198ee75-7512-7c42-a9c7-8edfa0123148",
  "name": "Swipe"
}
```

`layout.json` — items are keyed by durable UUID (UUIDv7), not filename, so identity survives renames and restarts. `lastSeen` carries the fingerprint used for rename reconciliation; it is a hint, never truth:

```json
{
  "schemaVersion": 1,
  "items": {
    "0198ee75-7512-7c42-a9c7-8edfa0123148": {
      "path": "launch-video.mov",
      "lastSeen": { "device": 16777234, "inode": 9127341, "mtimeNs": "1785112300123456789", "size": 48392012 },
      "frame": { "x": 960, "y": 320, "width": 640, "height": 360 },
      "rotation": 0,
      "zIndex": 4
    }
  }
}
```

Reconciliation order (per PR-016, adapted from Zed's `reuse_entry_id` in `worktree.rs` — inode/mtime matching during a scan, made durable across restarts by the UUID layer):

1. Match the relative path (also catches atomic-save editors, which rewrite the inode but keep the path; refresh `lastSeen` after any match).
2. If the old path is gone, match a unique `(device, inode)`.
3. Confirm with mtime and size — inodes get recycled by the OS.
4. On match, point the existing UUID at the new path.
5. If ambiguous, keep the old item as missing (PR-022 tombstone) and create a new item.

Reference gap this design exploits: Spatial (get-spatial.com) keeps content in a local database and blocks nested folders; Figma is cloud-bound, caps renders at 4096px, and cannot accept video via API. terrazzo's first real user is the iceberg swipe-file workflow — if it can't replace the Figma "Swipe" canvas, it hasn't earned daily-tool status.
