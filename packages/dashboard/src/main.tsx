import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-host the fonts so rendering never depends on the viewer having Inter /
// JetBrains Mono installed (otherwise some machines fall back to a glyphless
// font and every character renders as tofu boxes).
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@xyflow/react/dist/style.css";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
