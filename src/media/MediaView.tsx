// Focused media view (M3, modeled on Spatial's detail screen): the asset
// centered on a quiet field, metadata rail on the right in monospace caps.
// Escape or the backdrop returns to the canvas, whose camera survives in
// CanvasView's session map — canvas-state restoration comes free.
//
// Playback here owns a raw <video> with native controls; the canvas only
// ever shows the poster (poster-at-rest, PR-004).

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openDirectory } from "../app/ipc/commands";
import type { CanvasItem } from "../app/ipc/types";
import { useKeymap } from "../app/hooks/keyboard";
import "./media.css";

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
  const [resolution, setResolution] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
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
  const rows: [string, string][] = [
    ...(resolution ? [["Resolution", resolution] as [string, string]] : []),
    ["Filename", item.entry.name],
    ["Size", formatBytes(item.entry.size)],
    ["Modified", `ON ${formatDate(item.entry.mtimeNs)}`],
  ];

  return (
    <div className="media-root" onClick={onClose}>
      <div className="media-stage" onClick={(e) => e.stopPropagation()}>
        {item.entry.kind === "video" ? (
          <video
            className="media-asset"
            src={src}
            controls
            autoPlay
            onLoadedMetadata={(e) =>
              setResolution(
                `${e.currentTarget.videoWidth} × ${e.currentTarget.videoHeight}`,
              )
            }
          />
        ) : (
          <img
            className="media-asset"
            src={src}
            draggable={false}
            onLoad={(e) =>
              setResolution(
                `${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`,
              )
            }
          />
        )}
      </div>
      <aside className="media-rail" onClick={(e) => e.stopPropagation()}>
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
