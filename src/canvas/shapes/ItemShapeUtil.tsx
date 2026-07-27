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
  /** Absolute path of the underlying file (durable identity is the sidecar
   * UUID the shape id derives from). */
  path: string;
  /** Asset-protocol URL of the rendered preview (image thumbnail or video
   * poster frame). Empty until the thumbnail queue delivers (PR-014). */
  thumbnail: string;
  /** Rendered static preview HTML for a Markdown note card (PR-009).
   * Rust-generated with raw HTML stripped; empty until delivered. */
  note: string;
  /** PR-022 tombstone: the file no longer resolves. The card stays visible
   * and labeled, keeps its frame, and can be dismissed via Move to Trash. */
  missing: boolean;
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
/** Design width a note card's HTML renders at before scaling to its frame. */
export const NOTE_W = 440;
/** Default portrait frame for never-placed Markdown notes. */
export const NOTE_CARD_W = 200;
export const NOTE_CARD_H = 260;

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
    thumbnail: T.string,
    note: T.string,
    missing: T.boolean,
  };

  override getDefaultProps(): ItemShape["props"] {
    return {
      w: ITEM_W,
      h: ITEM_H,
      name: "",
      kind: "other",
      path: "",
      thumbnail: "",
      note: "",
      missing: false,
    };
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
    const { name, kind, thumbnail, note, missing } = shape.props;

    if (missing) {
      return (
        <HTMLContainer
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 10,
            background: "#1a1d26",
            border: "1px dashed #565f89",
            overflow: "hidden",
            pointerEvents: "all",
            opacity: 0.7,
          }}
        >
          <span
            style={{
              font: "600 10px/1 ui-monospace, monospace",
              letterSpacing: "0.08em",
              color: "#f7768e",
            }}
          >
            MISSING
          </span>
          <span
            style={{
              font: "12px/1.4 -apple-system, system-ui, sans-serif",
              color: "#8a8fa3",
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

    if (kind === "markdown" && note) {
      // Rendered at a fixed design width and scaled to the frame, so the
      // typography holds its proportions at any card size (Spatial's note
      // cards). Content is inert — pointer events stay with the shape.
      const scale = shape.props.w / NOTE_W;
      return (
        <HTMLContainer
          style={{ overflow: "hidden", pointerEvents: "all" }}
        >
          <div
            className="note-card"
            style={{
              width: NOTE_W,
              height: shape.props.h / scale,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
            dangerouslySetInnerHTML={{ __html: note }}
          />
        </HTMLContainer>
      );
    }

    if (thumbnail) {
      return (
        <HTMLContainer
          style={{
            position: "relative",
            overflow: "hidden",
            background: "#1f2430",
            pointerEvents: "all",
          }}
        >
          <img
            src={thumbnail}
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
          {kind === "video" && (
            <span
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                padding: "3px 6px",
                borderRadius: 4,
                background: "rgba(16, 16, 20, 0.7)",
                font: "600 9px/1 ui-monospace, monospace",
                letterSpacing: "0.08em",
                color: "#e6e9ef",
              }}
            >
              VID
            </span>
          )}
        </HTMLContainer>
      );
    }

    return (
      <HTMLContainer
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 10,
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
