// Figma-style selection furniture: white-filled resize handles with our blue
// stroke, and a dimensions pill under the selection bounds.
//
// tldraw v5 draws the selection box and handles on a canvas overlay, not in
// DOM — its colors come from OverlayUtil._getThemeColors (stroke = theme
// selectionStroke, handle fill = theme *background*, which is dark in dark
// mode). The subclass pins both, since white handles must not require a
// white canvas. _getThemeColors is private in the typings, so it's patched
// on the prototype rather than overridden in the class body.

import {
  SelectionForegroundOverlayUtil,
  useEditor,
  useValue,
} from "tldraw";

export class FigmaSelectionForeground extends SelectionForegroundOverlayUtil {}

(
  FigmaSelectionForeground.prototype as unknown as {
    _getThemeColors: () => { strokeColor: string; bgColor: string };
  }
)._getThemeColors = () => ({
  strokeColor: "#3ba3ff",
  bgColor: "#ffffff",
});

/** Rendered via components.InFrontOfTheCanvas — screen-space overlay inside
 * the tldraw container. Dimensions are page units (the file's real size),
 * position follows the selection on screen. */
export function SelectionDimensions() {
  const editor = useEditor();
  const info = useValue(
    "selection-dimensions",
    () => {
      const screen = editor.getSelectionRotatedScreenBounds();
      const page = editor.getSelectionRotatedPageBounds();
      if (!screen || !page) return null;
      return {
        x: screen.midX,
        y: screen.maxY,
        w: Math.round(page.width),
        h: Math.round(page.height),
      };
    },
    [editor],
  );
  if (!info) return null;
  return (
    <div className="dims-badge" style={{ left: info.x, top: info.y + 8 }}>
      {info.w} × {info.h}
    </div>
  );
}
