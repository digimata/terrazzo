# ADR-001 :: Canvas engine — tldraw + Tauri over native AppKit

Last updated: `2026.07.26`

> The canvas is the commodity and the file model is the product, so terrazzo builds on tldraw (canvas engine) + Tauri (shell) rather than a custom AppKit `NSView` canvas in Swift. TypeScript owns presentation; Rust owns disk truth. Electron is the designated fallback shell if a pre-build spike surfaces WKWebView renderer problems.

---

## 1. Decision

- Canvas engine: **tldraw**, with custom shape types for image, video, document, note, and folder cards.
- App shell: **Tauri** — WKWebView on macOS, capability-scoped filesystem and asset exposure, small binary.
- Workspace boundary: **one user-selected canonical root.** Navigation, watching, asset serving, and filesystem commands are confined to descendants of that root. Descendant folders have no artificial depth limit; symlinks cannot escape the boundary.
- Language split: **TypeScript owns presentation and transient canvas state; Rust owns disk truth.** Scanning, UUID/path/inode reconciliation (PR-016), file watching, atomic sidecar writes, path validation, thumbnail job queues, and process spawning (ffmpeg, qlmanage, system viewers) live in a Rust workspace service behind narrow Tauri commands — never in the webview.
- **Electron is the fallback shell**, decided by a pre-build spike (§3). If the spike fails, the shell switches; the React/tldraw layer and the backend command interface stay.

```text
tldraw + React + TypeScript
          │
    narrow Tauri commands
          │
Rust workspace service
├── authorize and validate workspace root
├── scan descendant directories
├── reconcile UUID/path/inode
├── watch filesystem (notify)
├── write layout atomically
├── validate paths
├── manage thumbnail jobs
└── launch ffmpeg / system viewers
```

## 2. Rationale

**Against native AppKit.** The rejected first alternative was Swift/SwiftUI with a custom canvas (Core Animation or Metal, AVFoundation, PDFKit, FSEvents). Its honest price: roughly 6–10 weeks to a useful MVP and 4–8 months to a dependable daily tool, because a hand-rolled canvas must reimplement world-coordinate transforms, hit testing, marquee selection, snapping, alignment guides, undo, and the final 20% of interaction polish. That list is precisely what tldraw ships today, battle-tested. terrazzo's novelty is the filesystem-canonical recursive storage model; the build effort goes there. Native's genuine advantages (AVFoundation playback, free Quick Look, FSEvents, native feel) are each reachable from Tauri at acceptable fidelity.

**Tauri over Electron.** Electron's real advantage is reduced uncertainty — a known Chromium renderer, Node filesystem APIs, easy process spawning — worth some prototype time. Tauri fits the product better: terrazzo is a filesystem application with a web canvas, not a web application. The scanner/reconciler maps naturally onto Rust and the notify crate; Tauri's filesystem and asset exposure are capability-scoped rather than implicitly available to the renderer; WKWebView avoids bundling a second browser runtime. Electron would need the same architectural separation anyway (sandboxed renderer, context isolation, narrow preload bridge), so choosing it buys renderer certainty, not a simpler architecture.

**tldraw license.** Production use requires an active license key. A discretionary hobby license permits non-commercial use with the tldraw watermark; commercial distribution requires a commercial license. Development requires no key. Resolve the production license before packaging terrazzo, even for personal use. See [tldraw licensing](https://tldraw.dev/community/license).

## 3. The pre-build spike

Before building the product, one screen must prove the risky parts of the WKWebView path:

- 200 image/video poster shapes panning and zooming at 60fps (PR-021)
- Four simultaneously playing videos as an asset-path stress test, with immediate click-to-seek. Smooth drag-scrubbing is not a gate, and the product canvas will show posters rather than live video controls
- Finder drag-in landing at exact canvas coordinates
- A dynamically selected workspace directory served through Tauri's asset protocol
- Recursive file watching
- External rename with layout identity preserved (PR-016 reconciliation)
- ffmpeg poster generation via sidecar

Pass → keep Tauri. Fail on anything renderer-specific → switch the shell to Electron immediately, before product code accumulates.

## 4. Design Implications

- All spatial logic operates in tldraw's world-coordinate space; terrazzo code never does its own screen-space math.
- File types are implemented as tldraw custom shapes; the shape layer is the seam between canvas and storage.
- Media performance is managed in app code (poster-only canvas objects, one focused live player, viewport culling — PR-006/007/021/031), since the web stack doesn't get AVFoundation's efficiency for free.
- The webview never touches the disk directly; every filesystem effect goes through a named Rust command, which keeps the Electron fallback a shell swap rather than a rewrite.
- `.canvas/workspace.json` identifies the root. Every Rust command resolves its target against that root after canonicalization; UI paths are never treated as authority.

## 5. When to Revisit

- The spike (§3) fails on renderer-specific problems → Electron, immediately.
- terrazzo becomes a shipped product for other Mac users and native polish is a differentiator — decide after the web version has proven itself in daily use, not before.
- The performance floor (PR-021) proves unreachable in any webview after real optimization effort → reopen the native question.
- tldraw's license or maintenance trajectory becomes hostile to the project.
