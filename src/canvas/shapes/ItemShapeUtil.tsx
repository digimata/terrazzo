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

/** Folder card (Spatial's look): the folder IS the card — a back panel's
 * tab peeks above a full-width front panel, item count + name inside the
 * front, bottom-left. Drawn at the fixed dir frame — folders read close to
 * a note card's height and roughly 1.5× its width. */
function FolderCard({ name, count }: { name: string; count: number }) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        width={DIR_W}
        height={DIR_H}
        viewBox={`0 0 ${DIR_W} ${DIR_H}`}
        fill="none"
        style={{ position: "absolute", inset: 0 }}
      >
        <path
          d="M0 80 V18 a14 14 0 0 1 14 -14 h76 a24 24 0 0 1 18 8 l12 17 a18 18 0 0 0 13 7 H300 a40 40 0 0 1 40 40 v4 H0 Z"
          fill="#1d2123"
          stroke="#2b2e2f"
          strokeWidth="1"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 44,
          bottom: 0,
          background: "#232729",
          border: "1px solid #2b2e2f",
          borderRadius: 22,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "26px 30px",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            font: "400 16px/1.25 -apple-system, 'SF Pro Text', system-ui, sans-serif",
            color: "#8a8f98",
          }}
        >
          {count} {count === 1 ? "item" : "items"}
        </span>
        <span
          style={{
            font: "400 20px/1.3 -apple-system, 'SF Pro Display', system-ui, sans-serif",
            color: "#e6e9ef",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      </div>
    </div>
  );
}

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
  /** Non-dot children of a directory ("N items" on folder cards). */
  childCount: number;
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
/** Fixed portrait frame for Markdown notes (Spatial's card proportions).
 * Notes and folders are not resizable — one canonical card size each. */
export const NOTE_CARD_W = 260;
export const NOTE_CARD_H = 364;
/** Fixed folder frame (Spatial's proportions: near note height, ~1.5× its
 * width — folders should read bigger than notes, not smaller). */
export const DIR_W = 340;
export const DIR_H = 270;

/** Fixed frame for the kind, or null if the kind is freely resizable. */
export function fixedSize(kind: FileKind) {
  if (kind === "markdown") return { width: NOTE_CARD_W, height: NOTE_CARD_H };
  if (kind === "dir") return { width: DIR_W, height: DIR_H };
  return null;
}

export class ItemShapeUtil extends ShapeUtil<ItemShape> {
  static override type = "item" as const;

  /** Set by CanvasView after mount; fired on double-click (folder entry,
   * later media/document open). */
  onOpen?: (shape: ItemShape) => void;

  override onDoubleClick(shape: ItemShape) {
    this.onOpen?.(shape);
  }

  /** Notes and folders open on a single click (Spatial's pattern) — they're
   * doors, not objects you select. Media keeps click-to-select,
   * double-click-to-open. Drags still move the card: tldraw only fires
   * onClick when the pointer never left the click threshold. */
  override onClick(shape: ItemShape) {
    const kind = shape.props.kind;
    if (kind === "markdown" || kind === "dir") this.onOpen?.(shape);
  }

  static override props: RecordProps<ItemShape> = {
    w: T.number,
    h: T.number,
    name: T.string,
    kind: kindValidator,
    path: T.string,
    thumbnail: T.string,
    note: T.string,
    childCount: T.number,
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
      childCount: 0,
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

  override canResize(shape: ItemShape) {
    return fixedSize(shape.props.kind) === null;
  }

  /** Square selection outline (tldraw's v5 default indicator rounds its
   * corners). Notes get none at all — a single click opens them, so a
   * selection ring would only flash before the document covers it. */
  override indicator(shape: ItemShape) {
    const kind = shape.props.kind;
    if (kind === "markdown" || kind === "dir") return null;
    return <rect width={shape.props.w} height={shape.props.h} />;
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

    if (kind === "dir") {
      return (
        <HTMLContainer className="card-grow" style={{ pointerEvents: "all" }}>
          <FolderCard name={name} count={shape.props.childCount} />
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
          className="card-grow"
          style={{
            overflow: "hidden",
            borderRadius: 24, // Spatial's soft card corner — notes only
            border: "1px solid #1d1d20",
            pointerEvents: "all",
          }}
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

  /** Canvas-overlay ring (v5 strokes this, not the React indicator): square
   * corners to match media cards, nothing for notes (a click opens them),
   * and the folder's exact silhouette — tab, step, rounded body — for dirs,
   * so the post-drag selected state hugs the card like Spatial's. The back
   * panel is flush with the front, so both sides are single straight edges
   * and the outline is just tab across the top + rounded body below. */
  override getIndicatorPath(shape: ItemShape) {
    const kind = shape.props.kind;
    if (kind === "markdown") return new Path2D();
    if (kind === "dir") {
      return new Path2D(
        "M0 248 V18 a14 14 0 0 1 14 -14 h76 a24 24 0 0 1 18 8 " +
          "l12 17 a18 18 0 0 0 13 7 H300 a40 40 0 0 1 26 9.5 " +
          "a22 22 0 0 1 14 20.5 V248 " +
          "a22 22 0 0 1 -22 22 H22 a22 22 0 0 1 -22 -22 Z",
      );
    }
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
