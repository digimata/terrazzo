// Document mode (M4): full-window CodeMirror over one Markdown file. The
// file on disk stays canonical — this view holds a working copy and writes
// it back atomically (temp + rename in Rust), debounced while typing and
// flushed unconditionally on close. cmd+E toggles the concealed writing
// view against raw source.
//
// Two safety nets around the buffer (v0 §7):
// - External changes: fs-events for this file are compared by mtime. Our
//   own save echoes match and are ignored; a foreign write reloads the
//   buffer when clean, and when dirty suspends autosave behind a conflict
//   banner — never a silent clobber in either direction.
// - Recovery drafts: the buffer mirrors to an app-data draft (keyed by item
//   UUID) on a shorter debounce than the file save. A clean close deletes
//   it, so a draft newer than the file on open is itself the crash signal.
//
// Escape closes via the app keymap stack, not a CodeMirror binding, so a
// future Vim compartment can claim Escape without this file changing.

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  syntaxTree,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  deleteDraft,
  openDirectory,
  readDraft,
  readTextFile,
  writeDraft,
  writeTextFile,
} from "../app/ipc/commands";
import type { FsEvent } from "../app/ipc/types";
import { useKeymap } from "../app/hooks/keyboard";
import { blockquoteLines, conceal, hrLines } from "./conceal";
import "./document.css";

export type DocumentViewMode = "writing" | "source";

const SAVE_DEBOUNCE_MS = 1000;
// Deliberately shorter than the file save — the draft has to cover the
// window the debounce leaves open, or it never covers anything.
const DRAFT_DEBOUNCE_MS = 250;

type Conflict = "changed" | "deleted";

const theme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#101011", // match tldraw dark canvas
      color: "#e6e9ef",
      height: "100%",
      fontSize: "14.5px",
      // SF Pro is variable — intermediate weights render for real. A hair
      // under regular reads lighter on the dark field without going thin.
      fontWeight: "380",
    },
    ".cm-content": {
      fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif",
      lineHeight: "1.7",
      // Generous head-room — the topbar is gone, so the document floats
      // well clear of the window edge (roomy, Spatial-like).
      padding: "15vh 0 45vh",
      caretColor: "#b5d6fb",
    },
    ".cm-line": { padding: "0 4px" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "#b5d6fb",
      borderLeftWidth: "2px",
      // CodeMirror sets the caret's height inline per line; padding extends
      // the border past it so the caret overshoots the text a little on
      // both ends without fighting the inline style.
      marginTop: "-3px",
      paddingBottom: "6px",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#2e2e38",
    },
    ".cm-scroller": { overflow: "auto" },
    // Zed-style quote bar: a flat 4px strip, continuous across the block,
    // inset a few px at the block's first and last line. No rounding.
    ".cm-blockquote": {
      position: "relative",
      paddingLeft: "20px",
      color: "#a8adb8",
    },
    ".cm-blockquote::before": {
      content: "''",
      position: "absolute",
      left: "4px",
      top: "0",
      bottom: "0",
      width: "4px",
      background: "#3d3d49",
    },
    ".cm-blockquote-first::before": { top: "4px" },
    ".cm-blockquote-last::before": { bottom: "4px" },
    // Thematic break at rest: text transparent (line height and caret
    // stay honest), the rule drawn centered by the pseudo-element.
    ".cm-hr": { color: "transparent", position: "relative" },
    ".cm-hr::after": {
      content: '""',
      position: "absolute",
      left: "4px",
      right: "4px",
      top: "50%",
      borderTop: "1px solid #26292c",
    },
  },
  { dark: true },
);

// All white, like Spatial: everything inherits the body color, and the
// only differentiation is weight, size, italics, and decoration lines.
const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.heading1, fontSize: "2em", fontWeight: "500" },
  { tag: tags.heading2, fontSize: "1.25em", fontWeight: "500" },
  { tag: tags.heading3, fontSize: "1.1em", fontWeight: "500" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, textDecoration: "underline" },
  {
    tag: tags.monospace,
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: "0.9em",
  },
  { tag: tags.quote, fontStyle: "italic" },
]);

export default function DocumentView({
  directoryPath,
  itemId,
  view: viewMode,
  onChangeView,
  onClose,
}: {
  directoryPath: string;
  itemId: string;
  view: DocumentViewMode;
  onChangeView: (view: DocumentViewMode) => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const concealCompartment = useRef(new Compartment());
  // Save state is tracked (the machinery reports through it) but currently
  // renders nowhere — the topbar went with the chrome.
  const [, setSaveState] = useState<"clean" | "dirty" | "saving">("clean");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [draftOffer, setDraftOffer] = useState<string | null>(null);
  const draftOfferRef = useRef<string | null>(null);

  // Banner buttons call into the load effect's closure through this ref —
  // the machinery (path, mtime, timers) lives there, not in React state.
  const actionsRef = useRef<{
    reloadFromDisk: () => void;
    keepMine: () => void;
    restoreDraft: () => void;
    discardDraft: () => void;
  } | null>(null);

  // cmd+E toggles writing/source. Bound inside CodeMirror (not useKeymap):
  // the app dispatcher deliberately lets everything but Escape through to
  // editable targets, so an app-level binding would never fire while typing.
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const onChangeViewRef = useRef(onChangeView);
  onChangeViewRef.current = onChangeView;

  useEffect(() => {
    let view: EditorView | null = null;
    let alive = true;
    let unlisten: (() => void) | null = null;

    // The buffer's relationship to disk, all effect-local:
    let path = "";
    let fileMtime = ""; // last mtime this session read or wrote
    let dirty = false;
    let inConflict: Conflict | null = null;
    let savePending: number | null = null;
    let draftPending: number | null = null;
    let saveInFlight: Promise<void> | null = null;
    // True while we dispatch disk content into the buffer — those changes
    // must not re-trigger autosave (they'd write back what we just read).
    let applyingExternal = false;

    function markConflict(kind: Conflict) {
      inConflict = kind;
      if (savePending !== null) {
        window.clearTimeout(savePending);
        savePending = null;
      }
      setConflict(kind);
    }

    async function save(contents: string) {
      setSaveState("saving");
      const done = (async () => {
        try {
          fileMtime = await writeTextFile(path, contents);
          if (alive) setSaveState(dirty ? "dirty" : "clean");
        } catch (e) {
          console.error("autosave failed", e);
          if (alive) setSaveState("dirty");
        }
      })();
      saveInFlight = done;
      await done;
      saveInFlight = null;
    }

    function scheduleSave(v: EditorView) {
      dirty = true;
      setSaveState("dirty");
      if (inConflict) return; // suspended until the user picks a side
      if (savePending !== null) window.clearTimeout(savePending);
      savePending = window.setTimeout(() => {
        savePending = null;
        dirty = false;
        void save(v.state.doc.toString());
      }, SAVE_DEBOUNCE_MS);
    }

    function scheduleDraft(v: EditorView) {
      if (draftPending !== null) window.clearTimeout(draftPending);
      draftPending = window.setTimeout(() => {
        draftPending = null;
        writeDraft(itemId, v.state.doc.toString()).catch((e) =>
          console.error("draft mirror failed", e),
        );
      }, DRAFT_DEBOUNCE_MS);
    }

    /** Replace the buffer with disk content without triggering autosave,
     * keeping the cursor as close as the new text allows. */
    function applyDiskContent(v: EditorView, contents: string) {
      const head = Math.min(v.state.selection.main.head, contents.length);
      applyingExternal = true;
      try {
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: contents },
          selection: { anchor: head },
        });
      } finally {
        applyingExternal = false;
      }
    }

    async function onFsEvent(event: FsEvent) {
      if (!view || !event.paths.includes(path)) return;
      // Let an in-flight save land first so its echo compares equal.
      if (saveInFlight) await saveInFlight;
      if (!alive || !view) return;

      let doc;
      try {
        doc = await readTextFile(path);
      } catch {
        // File gone. Clean buffer → nothing of ours to lose; back to the
        // canvas, where the tombstone story takes over. Dirty → conflict.
        if (dirty || inConflict) markConflict("deleted");
        else onClose();
        return;
      }
      if (!alive || !view) return;
      if (doc.mtimeNs === fileMtime) return; // our own save echoing back

      if (dirty || inConflict) {
        markConflict("changed");
      } else {
        fileMtime = doc.mtimeNs;
        applyDiskContent(view, doc.contents);
      }
    }

    actionsRef.current = {
      reloadFromDisk: async () => {
        if (!view) return;
        if (inConflict === "deleted") {
          void deleteDraft(itemId);
          onClose();
          return;
        }
        try {
          const doc = await readTextFile(path);
          if (!alive || !view) return;
          fileMtime = doc.mtimeNs;
          applyDiskContent(view, doc.contents);
          dirty = false;
          inConflict = null;
          setConflict(null);
          setSaveState("clean");
        } catch {
          markConflict("deleted");
        }
      },
      keepMine: async () => {
        if (!view) return;
        inConflict = null;
        setConflict(null);
        dirty = false;
        await save(view.state.doc.toString());
      },
      restoreDraft: () => {
        if (!view) return;
        setDraftOffer(null);
        const offered = draftOfferRef.current;
        if (offered === null) return;
        // A plain dispatch: the update listener treats it as typing, so the
        // restored text flows through the normal autosave path to disk.
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: offered },
        });
        view.focus();
      },
      discardDraft: () => {
        setDraftOffer(null);
        draftOfferRef.current = null;
        void deleteDraft(itemId);
        view?.focus();
      },
    };

    (async () => {
      const { items } = await openDirectory(directoryPath);
      const item = items.find((i) => i.id === itemId);
      if (!item || item.missing) {
        onClose(); // vanished under us — back to canvas
        return;
      }
      path = item.entry.path;
      const doc = await readTextFile(path);
      const draft = await readDraft(itemId);
      if (!alive || !hostRef.current) return;
      fileMtime = doc.mtimeNs;

      // A draft newer than the file that differs from it survived a crash
      // or failed save — offer it instead of silently picking either side.
      if (
        draft &&
        draft.contents !== doc.contents &&
        BigInt(draft.mtimeNs) > BigInt(doc.mtimeNs)
      ) {
        draftOfferRef.current = draft.contents;
        setDraftOffer(draft.contents);
      }

      view = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: doc.contents,
          extensions: [
            history(),
            keymap.of([
              {
                key: "Mod-e",
                run: () => {
                  onChangeViewRef.current(
                    viewModeRef.current === "writing" ? "source" : "writing",
                  );
                  return true;
                },
              },
              ...defaultKeymap,
              ...historyKeymap,
              indentWithTab,
            ]),
            markdown({ base: markdownLanguage }),
            // Typography input rules: the closing keystroke collapses the
            // pair into the real character in the buffer itself (not a
            // display trick). Code spans and blocks are exempt — CLI flags
            // and ASCII arrows in code stay as typed.
            EditorView.inputHandler.of((v, from, to, text) => {
              const pairs: Record<string, string> = {
                "--": "—",
                "->": "→",
              };
              if (from !== to) return false;
              const typed = v.state.sliceDoc(from - 1, from) + text;
              const glyph = pairs[typed];
              if (!glyph) return false;
              if (/Code/.test(syntaxTree(v.state).resolveInner(from, -1).name))
                return false;
              v.dispatch({
                changes: { from: from - 1, to, insert: glyph },
                selection: { anchor: from },
                userEvent: "input.type",
              });
              return true;
            }),
            syntaxHighlighting(highlight),
            blockquoteLines,
            // Without drawSelection the browser draws the caret natively —
            // caretColor applies but width/height rules never do.
            drawSelection(),
            EditorView.lineWrapping,
            theme,
            concealCompartment.current.of(
              viewModeRef.current === "writing" ? [conceal, hrLines] : [],
            ),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged || applyingExternal || !view) return;
              scheduleSave(view);
              scheduleDraft(view);
            }),
          ],
        }),
      });
      editorRef.current = view;
      view.focus();

      unlisten = await listen<FsEvent>("fs-event", (e) =>
        void onFsEvent(e.payload),
      );
    })();

    return () => {
      alive = false;
      unlisten?.();
      if (savePending !== null) window.clearTimeout(savePending);
      if (draftPending !== null) window.clearTimeout(draftPending);
      if (view) {
        if (inConflict) {
          // Unresolved conflict: touch nothing. The file keeps the foreign
          // version, the draft keeps ours — both sides survive the close.
        } else if (dirty) {
          // Flush, then clear the draft only once the flush landed.
          void writeTextFile(path, view.state.doc.toString())
            .then(() => deleteDraft(itemId))
            .catch((e) => console.error("close flush failed", e));
        } else {
          void deleteDraft(itemId);
        }
        view.destroy();
      }
      editorRef.current = null;
      actionsRef.current = null;
    };
  }, [directoryPath, itemId, onClose]);

  // Swap the concealment in and out when the view mode flips; the editor
  // itself (buffer, undo history, cursor) survives the toggle.
  useEffect(() => {
    editorRef.current?.dispatch({
      effects: concealCompartment.current.reconfigure(
        viewMode === "writing" ? [conceal, hrLines] : [],
      ),
    });
  }, [viewMode]);

  useKeymap({ escape: onClose });

  // No chrome: the document IS the view (Spatial). cmd+E still toggles
  // writing/source, Escape closes; the banners below only appear on
  // conflict or draft recovery.
  return (
    <div className="doc-root">
      {conflict && (
        <div className="doc-banner">
          <span className="doc-banner-text">
            {conflict === "deleted"
              ? "This file was deleted on disk."
              : "This file changed on disk while you were editing."}
          </span>
          <button
            className="doc-banner-action"
            onClick={() => actionsRef.current?.keepMine()}
          >
            keep mine
          </button>
          <button
            className="doc-banner-action"
            onClick={() => actionsRef.current?.reloadFromDisk()}
          >
            {conflict === "deleted" ? "close" : "reload from disk"}
          </button>
        </div>
      )}
      {draftOffer !== null && !conflict && (
        <div className="doc-banner">
          <span className="doc-banner-text">
            A recovered draft is newer than this file.
          </span>
          <button
            className="doc-banner-action"
            onClick={() => actionsRef.current?.restoreDraft()}
          >
            restore draft
          </button>
          <button
            className="doc-banner-action"
            onClick={() => actionsRef.current?.discardDraft()}
          >
            keep file
          </button>
        </div>
      )}
      <div className="doc-editor" ref={hostRef} />
    </div>
  );
}
