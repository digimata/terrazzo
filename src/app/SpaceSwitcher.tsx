// Space switcher (Spatial's pattern): a quiet pill bottom-right that pops a
// menu of Spaces. A Space is the workspace root or one of its top-level
// folders — ⌘1..⌘9 jump straight to one, no menu needed. The list refreshes
// whenever the current directory changes, so a folder created mid-session
// shows up without a restart.

import { useEffect, useState } from "react";
import { listDir } from "./ipc/commands";
import { useKeymap, type Keymap } from "./hooks/keyboard";

interface Space {
  label: string;
  path: string;
}

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M12 3 L21 8 L12 13 L3 8 Z" />
      <path d="M3 13.5 L12 18.5 L21 13.5" />
    </svg>
  );
}

export default function SpaceSwitcher({
  root,
  rootName,
  currentPath,
  onNavigate,
}: {
  root: string;
  rootName: string;
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([{ label: rootName, path: root }]);

  useEffect(() => {
    let alive = true;
    listDir(root)
      .then((entries) => {
        if (!alive) return;
        setSpaces([
          { label: rootName, path: root },
          ...entries
            .filter((e) => e.isDir)
            .map((e) => ({ label: e.name, path: e.path })),
        ]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [root, rootName, currentPath]);

  const numbered = spaces.slice(0, 9);
  const bindings: Keymap = {};
  numbered.forEach((space, i) => {
    bindings[`cmd+${i + 1}`] = () => {
      setOpen(false);
      onNavigate(space.path);
    };
  });
  useKeymap(bindings);

  return (
    <>
      {open && (
        <div className="space-backdrop" onClick={() => setOpen(false)} />
      )}
      {open && (
        <div className="space-menu">
          {numbered.map((space, i) => {
            const current =
              space.path === currentPath ||
              (space.path !== root && currentPath.startsWith(space.path + "/"));
            return (
              <button
                key={space.path}
                className={`space-row${current ? " space-row-current" : ""}`}
                onClick={() => {
                  setOpen(false);
                  onNavigate(space.path);
                }}
              >
                <LayersIcon className="space-row-icon" />
                <span className="space-row-name">{space.label}</span>
                <span className="space-row-key">⌘ {i + 1}</span>
              </button>
            );
          })}
        </div>
      )}
      <button
        className="space-pill"
        title="Spaces"
        onClick={() => setOpen((v) => !v)}
      >
        <LayersIcon />
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 120ms",
          }}
        >
          <path d="M6 15 L12 9 L18 15" />
        </svg>
      </button>
    </>
  );
}
