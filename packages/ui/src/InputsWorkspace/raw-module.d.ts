// Lets the projector genericity guard load a module's own source as a
// raw string via Vite's `?raw` suffix (vitest resolves it at runtime),
// so it can statically assert no product literal leaked into the
// substrate→runtime projector — without pulling `@types/node` into the
// package's type surface. (Sibling to `conformance-csv.d.ts`, which
// covers the `*.csv?raw` fixture imports.)
declare module "*?raw" {
  const content: string;
  export default content;
}
