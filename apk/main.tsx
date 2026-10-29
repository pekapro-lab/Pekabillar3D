// Entrada solo para la APK (Capacitor): monta el juego tal cual, sin SSR/auth.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./apk.css";
import { PekabillarApp } from "../src/game/PekabillarApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PekabillarApp />
  </StrictMode>,
);
