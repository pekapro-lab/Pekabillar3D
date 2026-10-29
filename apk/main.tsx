// Entrada solo para la APK (Capacitor): monta el juego tal cual, sin SSR/auth.
import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./apk.css";
import { PekabillarApp } from "../src/game/PekabillarApp";

declare global {
  interface Window {
    __bootError?: (msg: string) => void;
  }
}

class BootBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e) };
  }
  componentDidCatch(e: unknown) {
    window.__bootError?.(e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
  }
  render() {
    return this.state.err ? null : this.props.children;
  }
}

try {
  createRoot(document.getElementById("root")!).render(
    <BootBoundary>
      <PekabillarApp />
    </BootBoundary>,
  );
} catch (e) {
  window.__bootError?.(e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
}
