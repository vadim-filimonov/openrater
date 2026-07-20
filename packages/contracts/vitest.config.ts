import { defineConfig } from "vitest/config";

/**
 * Vitest config for @openrater/contracts.
 *
 * Pure types + pure functions. No DOM, no React. Node environment is
 * enough — no jsdom dep.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
