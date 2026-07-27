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
  ShapeIndicatorOverlayUtil,
  SnapIndicatorOverlayUtil,
  useEditor,
  useValue,
} from "tldraw";

export class FigmaSelectionForeground extends SelectionForegroundOverlayUtil {}

/** The blue ring on hover is also canvas-overlay work (ShapeIndicatorOverlayUtil
 * strokes selected + hovered shapes alike). Cards grow on hover instead, so
 * this subclass drops the hovered id and keeps the ring for selection only. */
export class SelectionOnlyIndicator extends ShapeIndicatorOverlayUtil {
  override getOverlays() {
    const overlays = super.getOverlays();
    const overlay = overlays[0] as
      | { props: { idsToDisplay: string[]; hintingShapeIds: string[] } }
      | undefined;
    if (!overlay) return overlays;
    const hovered = this.editor.getHoveredShapeId();
    if (hovered && !this.editor.getSelectedShapeIds().includes(hovered)) {
      overlay.props.idsToDisplay = overlay.props.idsToDisplay.filter(
        (id) => id !== hovered,
      );
      if (
        overlay.props.idsToDisplay.length === 0 &&
        overlay.props.hintingShapeIds.length === 0
      ) {
        return [];
      }
    }
    return overlays;
  }
}

(
  FigmaSelectionForeground.prototype as unknown as {
    _getThemeColors: () => { strokeColor: string; bgColor: string };
  }
)._getThemeColors = () => ({
  strokeColor: "#3ba3ff",
  bgColor: "#ffffff",
});

/** Snap guides in the document caret's steel blue instead of the theme's
 * snap color. The default render only injects the color before delegating
 * to _renderPoints/_renderGaps, so the override re-reads nothing else. */
const SNAP_STEEL = "#b5d6fb";

export class SteelSnapIndicator extends SnapIndicatorOverlayUtil {}

(
  SteelSnapIndicator.prototype as unknown as {
    render: (ctx: CanvasRenderingContext2D, overlays: unknown[]) => void;
  }
).render = function (
  this: SteelSnapIndicator,
  ctx: CanvasRenderingContext2D,
  overlays: unknown[],
) {
  // _renderPoints/_renderGaps are private in the typings; the runtime
  // methods take the color as a plain argument.
  const self = this as unknown as {
    editor: { getZoomLevel(): number };
    _renderPoints(
      ctx: CanvasRenderingContext2D,
      line: unknown,
      zoom: number,
      color: string,
    ): void;
    _renderGaps(
      ctx: CanvasRenderingContext2D,
      line: unknown,
      zoom: number,
      color: string,
    ): void;
  };
  const zoom = self.editor.getZoomLevel();
  for (const overlay of overlays as {
    props: { line: { type: "points" | "gaps" } };
  }[]) {
    const { line } = overlay.props;
    if (line.type === "points") self._renderPoints(ctx, line, zoom, SNAP_STEEL);
    else if (line.type === "gaps") self._renderGaps(ctx, line, zoom, SNAP_STEEL);
  }
};

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
