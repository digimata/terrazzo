// Focused media view (M3, modeled on Spatial's detail screen): the asset
// centered on a quiet field, metadata rail on the right in monospace caps.
// Escape or the backdrop returns to the canvas, whose camera survives in
// CanvasView's session map — canvas-state restoration comes free.
//
// Playback here owns a raw <video> with native controls; the canvas only
// ever shows the poster (poster-at-rest, PR-004).

import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openDirectory } from "../app/ipc/commands";
import type { CanvasItem } from "../app/ipc/types";
import { useKeymap } from "../app/hooks/keyboard";
import "./media.css";

/** Keep in sync with .media-rail width / .media-stage padding in media.css. */
const RAIL_W = 240;
const STAGE_PAD_X = 48;
const STAGE_PAD_TOP = 40;
const STAGE_PAD_BOTTOM = 80; // bottom-heavy = optical centering, Spatial-style

/** Dominant colors, Spatial-style: downsample to a small canvas, count
 * pixels in coarse RGB buckets (4 bits/channel), average each bucket, then
 * take the most populous buckets that aren't near-duplicates of an earlier
 * pick. Returns [] if the canvas is tainted (asset-protocol readback) or the
 * frame isn't drawable yet — the palette just doesn't render. */
function extractPalette(
  el: HTMLImageElement | HTMLVideoElement,
  count = 5,
): string[] {
  try {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(el, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const buckets = new Map<
      number,
      { n: number; r: number; g: number; b: number }
    >();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      let entry = buckets.get(key);
      if (!entry) buckets.set(key, (entry = { n: 0, r: 0, g: 0, b: 0 }));
      entry.n++;
      entry.r += r;
      entry.g += g;
      entry.b += b;
    }
    const sorted = [...buckets.values()]
      .sort((a, b) => b.n - a.n)
      .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }));
    const picked: typeof sorted = [];
    for (const c of sorted) {
      const dupe = picked.some(
        (p) =>
          (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2 < 48 ** 2,
      );
      if (dupe) continue;
      picked.push(c);
      if (picked.length === count) break;
    }
    const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
    return picked.map((c) => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`);
  } catch {
    return [];
  }
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(mtimeNs: string) {
  const ms = Number(BigInt(mtimeNs) / 1_000_000n);
  return new Date(ms)
    .toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase();
}

export default function MediaView({
  directoryPath,
  itemId,
  onClose,
}: {
  directoryPath: string;
  itemId: string;
  onClose: () => void;
}) {
  const [item, setItem] = useState<CanvasItem | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  // Re-render on window resize so the tall-image judgment tracks the stage.
  const [, setViewport] = useState(0);
  useEffect(() => {
    const onResize = () => setViewport((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let alive = true;
    setDims(null); // stale dims/palette must not survive an item switch
    setPalette([]);
    openDirectory(directoryPath).then(({ items }) => {
      if (!alive) return;
      const found = items.find((i) => i.id === itemId) ?? null;
      setItem(found && !found.missing ? found : null);
      if (!found || found.missing) onClose(); // vanished under us — back to canvas
    });
    return () => {
      alive = false;
    };
  }, [directoryPath, itemId, onClose]);

  useKeymap({ escape: onClose });

  if (!item) return <div className="media-root" />;

  const src = convertFileSrc(item.entry.path);

  // A capture much taller than the stage (full-page website screenshots)
  // would contain-fit into an unreadable sliver. Render those at stage
  // width, top-aligned, and let the stage scroll vertically instead. The
  // threshold — proportionally more than twice as tall as the stage —
  // recomputes on resize via the viewport tick above.
  const stageW = Math.max(1, window.innerWidth - 2 * (RAIL_W + STAGE_PAD_X));
  const stageH = Math.max(
    1,
    window.innerHeight - STAGE_PAD_TOP - STAGE_PAD_BOTTOM,
  );
  const tall =
    item.entry.kind === "image" &&
    dims !== null &&
    dims.h / dims.w > 2 * (stageH / stageW);

  // The metadata rail's first row aligns with the asset's rendered top edge:
  // contain-fit never upscales (max-width/height), so the rendered height is
  // natural × min(1, fit), and the top follows from centering the remainder.
  const fitScale = dims ? Math.min(1, stageW / dims.w, stageH / dims.h) : 1;
  const assetTop =
    tall || !dims
      ? STAGE_PAD_TOP
      : STAGE_PAD_TOP + (stageH - dims.h * fitScale) / 2;

  const onMediaSize = (w: number, h: number) => setDims({ w, h });
  const resolution = dims ? `${dims.w} × ${dims.h}` : null;
  const rows: [string, string][] = [
    ...(resolution ? [["Resolution", resolution] as [string, string]] : []),
    ["Filename", item.entry.name],
    ["Size", formatBytes(item.entry.size)],
    ["Modified", `ON ${formatDate(item.entry.mtimeNs)}`],
  ];

  const stopClick = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <div className="media-root" onClick={onClose}>
      {/* Stage is full-bleed with rail-sized padding on BOTH sides, so the
          asset centers in the window rather than in (window − rail). */}
      <div className={`media-stage${tall ? " media-stage-tall" : ""}`}>
        {item.entry.kind === "video" ? (
          <video
            className="media-asset"
            src={src}
            controls
            autoPlay
            onClick={stopClick}
            onLoadedMetadata={(e) =>
              onMediaSize(
                e.currentTarget.videoWidth,
                e.currentTarget.videoHeight,
              )
            }
            onLoadedData={(e) => setPalette(extractPalette(e.currentTarget))}
          />
        ) : (
          <img
            className="media-asset"
            src={src}
            draggable={false}
            onClick={stopClick}
            onLoad={(e) => {
              onMediaSize(
                e.currentTarget.naturalWidth,
                e.currentTarget.naturalHeight,
              );
              setPalette(extractPalette(e.currentTarget));
            }}
          />
        )}
      </div>
      {palette.length > 0 && (
        <div
          className="media-palette"
          style={{ top: assetTop }}
          onClick={stopClick}
        >
          {palette.map((c) => (
            <div
              key={c}
              className="media-swatch"
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      )}
      <aside
        className="media-rail"
        style={{ paddingTop: assetTop }}
        onClick={(e) => e.stopPropagation()}
      >
        {rows.map(([label, value]) => (
          <div className="media-row" key={label}>
            <div className="media-label">{label}</div>
            <div className="media-value">{value}</div>
          </div>
        ))}
      </aside>
    </div>
  );
}
