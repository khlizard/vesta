import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import os from "node:os";
import path from "node:path";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  // When the UI was built; shown in the About dialog (docs/spec/ui.md「バージョン情報」).
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  // Keep Vite's dependency cache out of the project: a synced folder (Dropbox) locks
  // node_modules/.vite while Vite rebuilds it, and the dev server then fails with EBUSY.
  cacheDir: path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "vesta-dev", "vite-cache"),
  test: {
    exclude: [...configDefaults.exclude, ".claude/**", "reference/**"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
