import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { initNative, watchKeyboard } from "./lib/native";
import { isNative } from "./lib/platform";

// native.ts only loads the Capacitor plugins on demand, so it is cheap to import here.
if (isNative) void initNative();
watchKeyboard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
