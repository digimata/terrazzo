# ADR-002 :: Note editor — concealed writing view, syntax-visible Vim

Last updated: `2026.07.26`

> The in-app markdown editor (PR-023/024) is CodeMirror 6 over the canonical Markdown buffer. Standard writing uses permanent WYSIWYG concealment. Vim mode disables concealment and exposes source so the visible characters and Vim buffer positions remain identical.

---

## 1. Decision

- Editor engine: **CodeMirror 6** with the markdown language package. The stored markdown text is the editor document — no separate rich-text document model, no parse/serialize round trip.
- Rendering: **permanent WYSIWYG decorations.** Syntax markers (`**`, `_`, `#`, `>`, link URLs, task markers) are hidden with replace decorations and marked atomic, and they stay hidden regardless of cursor position or selection. Headings, bold, links, blockquotes, lists, checkboxes, and code blocks render as designed elements at all times.
- Editing model: formatting changes go through **commands** — Cmd+B/I toggles by editing the hidden markers programmatically, Cmd+K edits a link's target in a popover, Cmd+1–3 sets heading level. The user never manipulates marker characters directly.
- Escape hatch: an explicit **source-mode toggle** (per note, on request) shows the raw markdown for surgical edits — broken links, pasted syntax, nested edge cases. It is never triggered implicitly.
- Vim: **`@replit/codemirror-vim`** in a dynamically toggled compartment. Enabling it also disables concealment and enters syntax-visible source mode. A visible indicator shows `NORMAL`, `INSERT`, or `VISUAL` with the filename. Escape belongs to Vim; leaving the editor is `:q`, `:wq`, or an explicit shortcut. `:w` saves immediately.
- Canvas note cards (PR-009) are **cached static HTML**, not CodeMirror instances. Cards and the editor share Markdown parsing rules and typography without sharing the editor runtime.

## 2. Rationale

**CodeMirror over ProseMirror.** Vim's model assumes a linear buffer (characters → positions → ranges); ProseMirror assumes a document tree. Vim emulation over a tree stays permanently partial around lists, tables, atomic nodes, and block boundaries — `d2w`, `ci"`, visual-line, registers, macros all expect buffer positions. CodeMirror has exactly that model, and its Vim package is maintained and complete (normal/insert/visual, operators, mappings, Ex commands). Equally decisive: ProseMirror requires markdown ↔ document-model conversion on every open/save, which is where unknown syntax gets silently destroyed — a direct violation of Principle 1 (filesystem canonical). With CodeMirror the buffer on screen is the bytes on disk.

**Never-reveal in standard writing view.** Cursor movement and selection do not reveal Markdown syntax. Markers become invisible editable state, so direct character-level manipulation of them is impossible by design, and three things must be true to keep the model coherent:

1. Hidden markers are **atomic** — cursor motion and selection skip over them; backspace at a construct boundary deletes the construct's formatting as a unit, never half a marker.
2. All formatting mutations go through commands, so marker syntax is always well-formed — the user can't strand an unmatched `**`.
3. The source-mode toggle exists for the residue: edge cases the command set doesn't cover get handled in raw text, deliberately, then the user returns to WYSIWYG.

**Syntax-visible Vim.** Vim motions and operators address characters and ranges in the linear buffer. Concealed delimiters still occupy buffer positions, which makes stock motions, counts, deletion, and visual selection disagree with the visible document. terrazzo does not emulate around that mismatch. Enabling Vim exposes the real Markdown buffer; disabling Vim restores the concealed writing view.

## 3. Design Implications

- The decoration extension is the core editor investment: syntax-tree-driven, viewport-aware, with atomic replace ranges for every marker class. Budget real time for it; it is the editor.
- The command set defines the editable surface. A construct with no command (e.g. tables, initially) renders styled but is editable only via source mode — acceptable, ship commands incrementally.
- Vim mode and concealment are mutually exclusive CodeMirror compartments. Stock motions operate on visible source; no custom zero-width motion adapter is required.
- Autosave writes the buffer verbatim (debounced, atomic write via the Rust service per ADR-001). No serializer exists to introduce drift.
- Editor state (source-mode on/off, Vim on/off) is app-level preference, not per-file sidecar data.

## 4. When to Revisit

- The atomic-marker model proves too confusing in practice (ghost formatting, surprising deletions) after real daily use — the fallback is cursor-adjacent reveal as an *opt-in* setting, default off, not a return to Obsidian behavior.
- A future request for semantic Vim over concealed rich text would require a separate decoration-aware command engine; it is not implemented by extending `@replit/codemirror-vim`.
- Editing needs grow toward genuinely rich documents (embeds, columns, databases) — that is a different product (Principle 2), not a reason to switch engines.
