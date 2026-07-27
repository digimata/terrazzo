import { useState } from "react";
import type { AppMode } from "./mode";
import type { WorkspaceInfo } from "./ipc/types";
import { useKeyboardDispatcher, useKeymap } from "./hooks/keyboard";
import StartScreen from "./StartScreen";
import CanvasView from "../canvas/CanvasView";
import MediaView from "../media/MediaView";
import DocumentView from "../document/DocumentView";
import "./app.css";

export default function App() {
  const [mode, setMode] = useState<AppMode>({ type: "start" });
  useKeyboardDispatcher();
  useKeymap({
    "cmd+[": () => goBack(),
    "cmd+]": () => goForward(),
  });
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [back, setBack] = useState<string[]>([]);
  const [forward, setForward] = useState<string[]>([]);

  function navigate(path: string) {
    if (mode.type === "canvas") {
      if (path === mode.directoryPath) return;
      setBack((s) => [...s, mode.directoryPath]);
      setForward([]);
    }
    setMode({ type: "canvas", directoryPath: path });
  }

  function goBack() {
    if (mode.type !== "canvas" || back.length === 0) return;
    const prev = back[back.length - 1];
    setBack((s) => s.slice(0, -1));
    setForward((s) => [...s, mode.directoryPath]);
    setMode({ type: "canvas", directoryPath: prev });
  }

  function goForward() {
    if (mode.type !== "canvas" || forward.length === 0) return;
    const next = forward[forward.length - 1];
    setForward((s) => s.slice(0, -1));
    setBack((s) => [...s, mode.directoryPath]);
    setMode({ type: "canvas", directoryPath: next });
  }

  if (mode.type === "start") {
    return (
      <StartScreen
        onWorkspace={(info) => {
          setWorkspace(info);
          setMode({ type: "canvas", directoryPath: info.root });
        }}
      />
    );
  }

  if (mode.type === "document") {
    return (
      <DocumentView
        directoryPath={mode.directoryPath}
        itemId={mode.itemId}
        view={mode.view}
        onChangeView={(view) => setMode({ ...mode, view })}
        onClose={() =>
          setMode({ type: "canvas", directoryPath: mode.directoryPath })
        }
      />
    );
  }

  if (mode.type === "media") {
    return (
      <MediaView
        directoryPath={mode.directoryPath}
        itemId={mode.itemId}
        onClose={() =>
          setMode({ type: "canvas", directoryPath: mode.directoryPath })
        }
      />
    );
  }

  if (mode.type === "canvas" && workspace) {
    const relative = mode.directoryPath
      .slice(workspace.root.length)
      .split("/")
      .filter(Boolean);
    const crumbs = [
      { label: workspace.meta.name, path: workspace.root },
      ...relative.map((segment, i) => ({
        label: segment,
        path: `${workspace.root}/${relative.slice(0, i + 1).join("/")}`,
      })),
    ];

    return (
      <div className="app-root">
        <div className="app-topbar">
          <button
            className="app-nav"
            onClick={goBack}
            disabled={back.length === 0}
          >
            &lsaquo;
          </button>
          <button
            className="app-nav"
            onClick={goForward}
            disabled={forward.length === 0}
          >
            &rsaquo;
          </button>
          <div className="app-crumbs">
            {crumbs.map((crumb, i) => (
              <span key={crumb.path}>
                {i > 0 && <span className="app-crumb-sep">/</span>}
                <button
                  className="app-crumb"
                  disabled={i === crumbs.length - 1}
                  onClick={() => navigate(crumb.path)}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="app-canvas">
          <CanvasView
            key={mode.directoryPath}
            directoryPath={mode.directoryPath}
            onEnterDirectory={navigate}
            onOpenItem={(itemId, kind) =>
              setMode(
                kind === "markdown"
                  ? {
                      type: "document",
                      itemId,
                      directoryPath: mode.directoryPath,
                      view: "writing",
                    }
                  : {
                      type: "media",
                      itemId,
                      directoryPath: mode.directoryPath,
                    },
              )
            }
          />
        </div>
      </div>
    );
  }

  return null;
}
