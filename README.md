# terrazzo

A local-first spatial file browser: an infinite, Figma-precision canvas over one user-selected directory tree. Images, videos, and documents sit as objects on the canvas; every descendant folder is itself a canvas, with the workspace root as the hard upper boundary. Not a design tool.

Spatial (get-spatial.com) proved the interaction model but stores content in an opaque database and blocks nested folders. Figma has the canvas precision but is cloud-bound, feature-heavy, and chokes on media (4096px render cap, no video upload API). terrazzo keeps the filesystem canonical — every canvas is an ordinary directory with a `.canvas/layout.json` sidecar — so the data outlives the app.

## Layout

```
terrazzo/
├── README.md          # this file
├── docs/
│   ├── prd.md         # product requirements — definition, scope, storage model
│   └── .decisions/
│       ├── adr-001-canvas-engine.md   # tldraw + Tauri; Rust owns disk truth; Electron fallback
│       └── adr-002-note-editor.md     # CodeMirror writing view; syntax-visible Vim mode
└── .plan/
    └── v0.md          # initial version scope, sequence, and exit criteria
```
