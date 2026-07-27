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

// First/last lines carry extra classes so the bar (a ::before strip) can
// inset at the block's edges while staying continuous across the middle.
const quoteLines = {
  only: Decoration.line({
    class: "cm-blockquote cm-blockquote-first cm-blockquote-last",
  }),
  first: Decoration.line({ class: "cm-blockquote cm-blockquote-first" }),
  last: Decoration.line({ class: "cm-blockquote cm-blockquote-last" }),
  middle: Decoration.line({ class: "cm-blockquote" }),
};

function buildQuotes(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const state = view.state;
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "Blockquote") return;
        const firstLine = state.doc.lineAt(node.from).from;
        const lastLine = state.doc.lineAt(Math.min(node.to, state.doc.length)).from;
        for (let pos = node.from; pos <= node.to && pos <= state.doc.length; ) {
          const line = state.doc.lineAt(pos);
          if (!seen.has(line.from)) {
            seen.add(line.from);
            const deco =
              line.from === firstLine && line.from === lastLine
                ? quoteLines.only
                : line.from === firstLine
                  ? quoteLines.first
                  : line.from === lastLine
                    ? quoteLines.last
                    : quoteLines.middle;
            ranges.push(deco.range(line.from));
          }
          pos = line.to + 1;
        }
      },
    });
  }
  return Decoration.set(
    ranges.sort((a, b) => a.from - b.from),
    true,
  );
}

/** Blockquote lines get a left rule + inset (styled in the editor theme).
 * A line decoration, not a text style — italics alone don't read as a
 * quote. Active in both views; the writing view just also hides the >. */
export const blockquoteLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildQuotes(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildQuotes(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

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
