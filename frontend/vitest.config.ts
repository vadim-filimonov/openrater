import { defineConfig } from "vitest/config";

/**
 * Vitest config for @openrater/app.
 *
 * Brief 60 — the first rate-lab test runner (the placeholder test script
 * promised "vitest lands with the first component"). The `integrations/*`
 * sync adapters are pure functions whose cross-package imports are all
 * type-only, so they run under the lightweight `node` environment — no
 * jsdom needed. When the first component/route test lands it can switch
 * `environment` to `jsdom` + add a setup file, mirroring @openrater/ui.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
