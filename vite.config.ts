import { defineConfig } from "vite";
export default defineConfig({
  clearScreen: false,
  server: { port: 1440, strictPort: true },   // 1420 TinkerTerm, 1430 TermPaper
  build: { target: "esnext" },                 // main.ts loads saved settings with top-level await
});
