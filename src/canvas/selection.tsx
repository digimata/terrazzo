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
  strokeShapeIndicators,
  useEditor,
  useValue,
} from "tldraw";

/** True when every selected shape is a door (folder or note): fixed-size,
 * opens on click, shows the silhouette ring instead of selection furniture. */
function doorsOnlySelection(editor: {
  getSelectedShapes(): { type: string; props: object }[];
}) {
  const selected = editor.getSelectedShapes();
  return (
    selected.length > 0 &&
    selected.every(
      (s) =>
        s.type === "item" &&
        ((s.props as { kind: string }).kind === "dir" ||
          (s.props as { kind: string }).kind === "markdown"),
    )
  );
}

export class FigmaSelectionForeground extends SelectionForegroundOverlayUtil {
  /** No selection box or handles when the selection is all doors — post-drag
   * they show the white silhouette ring instead (Spatial's pattern). isActive
   * is the gate: render draws the box from selection state directly, ignoring
   * getOverlays, so filtering overlays alone leaves the box behind. */
  override isActive() {
    if (doorsOnlySelection(this.editor)) return false;
    return super.isActive();
  }
}

/** The blue ring on hover is also canvas-overlay work (ShapeIndicatorOverlayUtil
 * strokes selected + hovered shapes alike). Cards grow on hover instead, so
 * this subclass drops the hovered id and keeps the ring for selection only.
 * Render is ours too: folders stroke white along their silhouette (Spatial's
 * post-drag state), everything else in the selection blue. */
export class SelectionOnlyIndicator extends ShapeIndicatorOverlayUtil {
  override getOverlays() {
    let overlays = super.getOverlays();
    // The stock util hides indicators while translating (drag states aren't
    // in its allow-list); we keep the selection ring up during the drag.
    if (overlays.length === 0 && this.editor.isIn("select.translating")) {
      const ids = this.editor.getSelectedShapeIds();
      if (ids.length > 0) {
        overlays = [
          {
            id: "shape_indicator",
            type: "shape_indicator",
            props: { idsToDisplay: [...ids], hintingShapeIds: [] },
          },
        ] as ReturnType<ShapeIndicatorOverlayUtil["getOverlays"]>;
      }
    }
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

  override render(
    ctx: CanvasRenderingContext2D,
    overlays: ReturnType<ShapeIndicatorOverlayUtil["getOverlays"]>,
  ) {
    const overlay = overlays[0] as
      | { props: { idsToDisplay: string[]; hintingShapeIds: string[] } }
      | undefined;
    if (!overlay) return;
    const editor = this.editor;
    const zoom = editor.getZoomLevel();
    const doorSelected = new Set<string>();
    const rest: string[] = [];
    for (const id of overlay.props.idsToDisplay) {
      const shape = editor.getShape(id as Parameters<typeof editor.getShape>[0]);
      const kind =
        shape?.type === "item" ? (shape.props as { kind: string }).kind : null;
      if (kind === "dir" || kind === "markdown") doorSelected.add(id);
      else rest.push(id);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const strokeIds = strokeShapeIndicators as (
      editor: typeof this.editor,
      ctx: CanvasRenderingContext2D,
      ids: string[],
    ) => void;
    if (rest.length > 0) {
      ctx.strokeStyle = "#3ba3ff";
      ctx.lineWidth = this.options.lineWidth / zoom;
      strokeIds(editor, ctx, rest);
    }
    if (doorSelected.size > 0) {
      // Door rings obey the z-order: walk door shapes bottom-to-top, punch
      // each card's body out of the overlay (destination-out), then stroke
      // its own ring — a card on top occludes the ring of the one below,
      // instead of every ring floating above the whole stack.
      ctx.lineWidth = 2 / zoom;
      for (const shape of editor.getCurrentPageShapesSorted()) {
        if (shape.type !== "item") continue;
        const kind = (shape.props as { kind: string }).kind;
        if (kind !== "dir" && kind !== "markdown") continue;
        const indicator = (
          editor.getShapeUtil(shape) as {
            getIndicatorPath(s: typeof shape): Path2D;
          }
        ).getIndicatorPath(shape);
        const t = editor.getShapePageTransform(shape);
        const path = new Path2D();
        path.addPath(
          indicator,
          new DOMMatrix([t.a, t.b, t.c, t.d, t.e, t.f]),
        );
        ctx.globalCompositeOperation = "destination-out";
        ctx.fill(path);
        ctx.globalCompositeOperation = "source-over";
        if (doorSelected.has(shape.id)) {
          ctx.strokeStyle = SNAP_STEEL; // caret steel, same as snap guides
          ctx.stroke(path);
        }
      }
    }
    if (overlay.props.hintingShapeIds.length > 0) {
      ctx.strokeStyle = "#3ba3ff";
      ctx.lineWidth = this.options.hintedLineWidth / zoom;
      strokeIds(editor, ctx, overlay.props.hintingShapeIds);
    }
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
      if (doorsOnlySelection(editor)) return null; // silhouette ring only
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
