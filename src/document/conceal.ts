// The writing view's concealment (M4): hide Markdown formatting marks except
// where the cursor is, Obsidian-style. Pure view decoration — the document
// text is untouched, so the source view and the file on disk always show the
// real syntax. Marks on any line the selection touches stay revealed, which
// keeps editing them direct (click into a heading, the #s come back).

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/** Formatting marks that vanish at rest. List bullets stay visible — they
 * carry structure, not noise. */
const CONCEALED = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "QuoteMark",
  "StrikethroughMark",
  "LinkMark",
  "URL",
]);

function build(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const state = view.state;
  const sel = state.selection.main;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (!CONCEALED.has(node.name)) return;
        // Reveal every mark on a line the selection touches.
        const line = state.doc.lineAt(node.from);
        if (sel.from <= line.to && sel.to >= line.from) return;
        // ATX header marks swallow their following space too, so concealed
        // headings sit flush left instead of hanging indented.
        let end = node.to;
        if (
          node.name === "HeaderMark" &&
          state.doc.sliceString(end, end + 1) === " "
        ) {
          end += 1;
        }
        ranges.push(Decoration.replace({}).range(node.from, end));
      },
    });
  }
  return Decoration.set(ranges, true);
}

export const conceal = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
