// Build estático solo para la APK de Android. No afecta al build web (vite.config.ts).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL("./apk", import.meta.url));
export default defineConfig({
  root,
  base: "./",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [tailwindcss(), viteReact()],
  build: {
    // WebViews de Android sin actualizar: bajar JS y CSS (Tailwind v4 usa oklch, @layer, nesting).
    target: ["es2020", "chrome87"],
    cssTarget: ["chrome87"],
    outDir: fileURLToPath(new URL("./www", import.meta.url)), emptyOutDir: true },
});
