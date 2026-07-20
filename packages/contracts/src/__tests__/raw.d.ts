// Lets the genericity-invariant guard load a module's own source as a
// raw string via Vite's `?raw` suffix (vitest resolves it at runtime),
// so it can statically assert no product literal leaked into the
// composer — without pulling `@types/node` into the package.
declare module "*?raw" {
  const content: string;
  export default content;
}

// Minimal `import.meta.glob` declaration — just the raw-eager overload
// the genericity guard uses to fan out over `kinds/*.ts`. Avoids pulling
// `vite/client` into the package's type roots (it isn't a direct dep).
interface ImportMeta {
  glob(
    pattern: string,
    options: { query: "?raw"; import: "default"; eager: true },
  ): Record<string, string>;
}
