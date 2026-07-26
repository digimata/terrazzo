// The placeholder item shape (M1): one card per filesystem child. M3 splits
// this into real media shapes (image, video, pdf, markdown); until then every
// kind renders as a labeled card so hydration, layout, and reconciliation can
// be built against a single shape type.
//
// tldraw v5 registers custom shapes by augmenting TLGlobalShapePropsMap in
// @tldraw/tlschema — that puts "item" into the TLShape union, so editor
// calls (createShapes, getShape, updateShapes) are typed with no casts.

import {
  HTMLContainer,
  Rectangle2d,
  RecordProps,
  ShapeUtil,
  T,
  TLBaseShape,
  TLResizeInfo,
  resizeBox,
} from "tldraw";
import type { FileKind } from "../../app/ipc/types";

export interface ItemShapeProps {
  w: number;
  h: number;
  name: string;
  kind: FileKind;
  /** Absolute path — spike-grade identity. M2 replaces this with the
   * sidecar's UUIDv7 item id. */
  path: string;
}

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    item: ItemShapeProps;
  }
}

export type ItemShape = TLBaseShape<"item", ItemShapeProps>;

const kindValidator = T.literalEnum(
  "image",
  "video",
  "pdf",
  "markdown",
  "dir",
  "other",
);

const KIND_LABEL: Record<FileKind, string> = {
  image: "IMG",
  video: "VID",
  pdf: "PDF",
  markdown: "MD",
  dir: "DIR",
  other: "FILE",
};

const KIND_TINT: Record<FileKind, string> = {
  image: "#7aa2f7",
  video: "#bb9af7",
  pdf: "#f7768e",
  markdown: "#9ece6a",
  dir: "#e0af68",
  other: "#565f89",
};

export const ITEM_W = 180;
export const ITEM_H = 120;

export class ItemShapeUtil extends ShapeUtil<ItemShape> {
  static override type = "item" as const;

  /** Set by CanvasView after mount; fired on double-click (folder entry,
   * later media/document open). */
  onOpen?: (shape: ItemShape) => void;

  override onDoubleClick(shape: ItemShape) {
    this.onOpen?.(shape);
  }

  static override props: RecordProps<ItemShape> = {
    w: T.number,
    h: T.number,
    name: T.string,
    kind: kindValidator,
    path: T.string,
  };

  override getDefaultProps(): ItemShape["props"] {
    return { w: ITEM_W, h: ITEM_H, name: "", kind: "other", path: "" };
  }

  override getGeometry(shape: ItemShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canResize() {
    return true;
  }

  override onResize(shape: ItemShape, info: TLResizeInfo<ItemShape>) {
    return resizeBox(shape, info);
  }

  override component(shape: ItemShape) {
    const { name, kind } = shape.props;
    return (
      <HTMLContainer
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 10,
          borderRadius: 8,
          background: "#1f2430",
          border: `1px solid ${KIND_TINT[kind]}44`,
          overflow: "hidden",
          pointerEvents: "all",
        }}
      >
        <span
          style={{
            font: "600 10px/1 ui-monospace, monospace",
            letterSpacing: "0.08em",
            color: KIND_TINT[kind],
          }}
        >
          {KIND_LABEL[kind]}
        </span>
        <span
          style={{
            font: "12px/1.4 -apple-system, system-ui, sans-serif",
            color: "#c8ccd4",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            wordBreak: "break-all",
          }}
        >
          {name}
        </span>
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: ItemShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 8);
    return path;
  }
}
