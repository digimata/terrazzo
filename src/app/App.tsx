import { useState } from "react";
import type { AppMode } from "./mode";
import type { WorkspaceInfo } from "./ipc/types";
import StartScreen from "./StartScreen";
import CanvasView from "../canvas/CanvasView";

export default function App() {
  const [mode, setMode] = useState<AppMode>({ type: "start" });
  const [, setWorkspace] = useState<WorkspaceInfo | null>(null);

  switch (mode.type) {
    case "start":
      return (
        <StartScreen
          onWorkspace={(info) => {
            setWorkspace(info);
            setMode({ type: "canvas", directoryPath: info.root });
          }}
        />
      );
    case "canvas":
      return <CanvasView directoryPath={mode.directoryPath} />;
    default:
      return null;
  }
}
