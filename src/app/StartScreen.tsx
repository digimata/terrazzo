// Pre-workspace screen: one action, pick the root. The chosen directory is
// the hard boundary for everything that follows.

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { setWorkspace } from "./ipc/commands";
import type { WorkspaceInfo } from "./ipc/types";
import "./start.css";

export default function StartScreen({
  onWorkspace,
}: {
  onWorkspace: (info: WorkspaceInfo) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    const dir = await open({ directory: true, multiple: false });
    if (!dir) return;
    try {
      onWorkspace(await setWorkspace(dir));
    } catch (e) {
      setError(JSON.stringify(e));
    }
  }

  return (
    <div className="start-root">
      <h1 className="start-title">terrazzo</h1>
      <button className="start-open" onClick={choose}>
        Open workspace
      </button>
      {error && <div className="start-error">{error}</div>}
    </div>
  );
}
