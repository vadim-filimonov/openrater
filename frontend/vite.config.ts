import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Rate Lab Vite config.
 *
 * Standalone build — outputs to `dist/` next to this config. Integrators
 * serve the bundle from any static host of their choice (nginx, Caddy,
 * Cloudflare Pages, etc.). The OSS core does NOT bundle a web server
 * per VISION §0.5.
 *
 * Dev server runs at http://127.0.0.1:5175 (5173 is the Vite default;
 * we use 5175 so the api-lab backend at 8001 has plenty of headroom
 * and a future api-lab frontend can claim 5175).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 5175,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
});
