import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest config for @openrater/design-system.
 *
 * Tests run under jsdom (component tests need a DOM). The shared
 * setup file (src/test-setup.ts) wires @testing-library/jest-dom
 * matchers and resets DOM between tests.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    css: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
