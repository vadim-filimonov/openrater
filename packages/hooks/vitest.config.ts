import { defineConfig } from "vitest/config";

/**
 * Vitest config for @openrater/hooks.
 *
 * The pure logic tested here (describeApiError mapping, the mutation
 * error reporter, the apiErrorBus policy) needs no DOM, so it runs in
 * the fast `node` environment. Component-level hook tests, if added
 * later, would switch a file to jsdom via a per-file `// @vitest-environment`
 * comment.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
