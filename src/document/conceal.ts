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
  WidgetType,
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

const hrLine = Decoration.line({ class: "cm-hr" });

function buildHr(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const state = view.state;
  const sel = state.selection.main;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "HorizontalRule") return;
        const line = state.doc.lineAt(node.from);
        // Selection on the line reveals the raw --- for editing.
        if (sel.from <= line.to && sel.to >= line.from) return;
        ranges.push(hrLine.range(line.from));
      },
    });
  }
  return Decoration.set(ranges, true);
}

/** Thematic breaks render as an actual rule in the writing view: the ---
 * text goes transparent (keeping the line's height and caret behavior) and
 * the theme draws a centered border via ::after. */
export const hrLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildHr(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildHr(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

class EmDashWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "—";
    return span;
  }
  override eq() {
    return true;
  }
}

const emDash = Decoration.replace({ widget: new EmDashWidget() });

/** Nodes whose text is verbatim — a -- there means two hyphens. */
const LITERAL = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText"]);

function buildDashes(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const state = view.state;
  const sel = state.selection.main;
  const tree = syntaxTree(state);
  for (const { from, to } of view.visibleRanges) {
    const text = state.sliceDoc(from, to);
    // Exactly two hyphens: longer runs are rules, front-matter fences, or
    // deliberate typography, and stay as typed.
    for (const m of text.matchAll(/(?<!-)--(?!-)/g)) {
      const pos = from + m.index;
      const line = state.doc.lineAt(pos);
      if (sel.from <= line.to && sel.to >= line.from) continue;
      if (LITERAL.has(tree.resolveInner(pos, 1).name)) continue;
      ranges.push(emDash.range(pos, pos + 2));
    }
  }
  return Decoration.set(ranges, true);
}

/** Writing-view nicety: -- renders as an em dash. Pure display — the file
 * keeps the two hyphens, and the cursor's line reveals them for editing. */
export const emDashes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDashes(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDashes(update.view);
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
