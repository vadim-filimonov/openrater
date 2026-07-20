/**
 * esbuild bundler — produces self-contained ESM bundles for the
 * container + Lambda (ADR-0045 §7).
 *
 * Bundling (vs shipping raw TS workspace deps) is what lets the runtime
 * image be just `node + dist/`: esbuild transpiles the raw-TS workspace
 * packages (@openrater/contracts, the pure projector deep-import), erases
 * `import type` (so no React reaches the bundle), and inlines the npm
 * deps. The `createRequire` banner lets any transitive CJS `require()`
 * (Fastify internals) resolve under ESM output.
 *
 *   dist/server.mjs  → container / ECS CMD          (src/main.ts)
 *   dist/lambda.mjs  → Lambda handler export        (src/lambda/handler.ts)
 */

import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
};

await build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/server.mjs" });
await build({
  ...common,
  entryPoints: ["src/lambda/handler.ts"],
  outfile: "dist/lambda.mjs",
});

console.log("esbuild: wrote dist/server.mjs + dist/lambda.mjs");
