// Document mode (M4): full-window CodeMirror over one Markdown file. The
// file on disk stays canonical — this view holds a working copy and writes
// it back atomically (temp + rename in Rust), debounced while typing and
// flushed unconditionally on close. Slice 1 is the source view only;
// concealed decorations and the writing/source toggle layer on top.
//
// Escape closes via the app keymap stack, not a CodeMirror binding, so a
// future Vim compartment can claim Escape without this file changing.

import { useEffect, useRef, useState } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { openDirectory, readTextFile, writeTextFile } from "../app/ipc/commands";
import { useKeymap } from "../app/hooks/keyboard";
import "./document.css";

const SAVE_DEBOUNCE_MS = 1000;

const theme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#16161c",
      color: "#c8ccd4",
      height: "100%",
      fontSize: "15px",
    },
    ".cm-content": {
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
      lineHeight: "1.7",
      padding: "48px 0 45vh",
      caretColor: "#7aa2f7",
    },
    ".cm-line": { padding: "0 4px" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#7aa2f7" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#2b3045",
    },
    ".cm-scroller": { overflow: "auto" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: tags.heading, color: "#7aa2f7", fontWeight: "600" },
  { tag: tags.strong, color: "#e6e9ef", fontWeight: "600" },
  { tag: tags.emphasis, color: "#e6e9ef", fontStyle: "italic" },
  { tag: tags.link, color: "#9ece6a" },
  { tag: tags.url, color: "#565f89" },
  { tag: tags.monospace, color: "#bb9af7" },
  { tag: tags.quote, color: "#8a8fa3" },
  { tag: tags.list, color: "#e0af68" },
  { tag: tags.meta, color: "#565f89" },
]);

export default function DocumentView({
  directoryPath,
  itemId,
  onClose,
}: {
  directoryPath: string;
  itemId: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [saveState, setSaveState] = useState<"clean" | "dirty" | "saving">(
    "clean",
  );

  useEffect(() => {
    let view: EditorView | null = null;
    let alive = true;
    // Save plumbing lives in refs local to this effect: `pending` is the
    // debounce timer, `latest` the doc to write, `path` fixed at load.
    let path = "";
    let pending: number | null = null;
    let dirty = false;

    async function save(contents: string) {
      setSaveState("saving");
      try {
        await writeTextFile(path, contents);
        if (alive) setSaveState(dirty ? "dirty" : "clean");
      } catch (e) {
        console.error("autosave failed", e);
        if (alive) setSaveState("dirty");
      }
    }

    function scheduleSave(v: EditorView) {
      dirty = true;
      setSaveState("dirty");
      if (pending !== null) window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        pending = null;
        dirty = false;
        void save(v.state.doc.toString());
      }, SAVE_DEBOUNCE_MS);
    }

    (async () => {
      const items = await openDirectory(directoryPath);
      const item = items.find((i) => i.id === itemId);
      if (!item || item.missing) {
        onClose(); // vanished under us — back to canvas
        return;
      }
      path = item.entry.path;
      const contents = await readTextFile(path);
      if (!alive || !hostRef.current) return;
      setName(item.entry.name);

      view = new EditorView({
        parent: hostRef.current,
        state: EditorState.create({
          doc: contents,
          extensions: [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            markdown({ base: markdownLanguage }),
            syntaxHighlighting(highlight),
            EditorView.lineWrapping,
            theme,
            EditorView.updateListener.of((update) => {
              if (update.docChanged && view) scheduleSave(view);
            }),
          ],
        }),
      });
      view.focus();
    })();

    return () => {
      alive = false;
      if (pending !== null) window.clearTimeout(pending);
      // Flush on close: whatever is in the buffer is the document. Fire and
      // forget — the atomic write can outlive the component safely.
      if (view && dirty) void writeTextFile(path, view.state.doc.toString());
      view?.destroy();
    };
  }, [directoryPath, itemId, onClose]);

  useKeymap({ escape: onClose });

  return (
    <div className="doc-root">
      <div className="doc-topbar">
        <span className="doc-name">{name}</span>
        <span className="doc-save-state">
          {saveState === "clean" ? "saved" : saveState}
        </span>
      </div>
      <div className="doc-editor" ref={hostRef} />
    </div>
  );
}
