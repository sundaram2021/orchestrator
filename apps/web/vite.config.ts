import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 3500,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("monaco-editor/esm/vs/editor") || id.includes("monaco-editor/esm/vs/base")) {
            return "monaco";
          }
          return undefined;
        },
      },
    },
  },
});
