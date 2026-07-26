import { useState } from "react";
import type { AppMode } from "./mode";
import SpikeScreen from "../spike/SpikeScreen";

export default function App() {
  // Gate 0: the spike is the only mode. CanvasView takes over in Milestone 1.
  const [mode] = useState<AppMode>({ type: "spike" });

  switch (mode.type) {
    case "spike":
      return <SpikeScreen />;
    default:
      return null;
  }
}
