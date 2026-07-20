// Lets the book conformance test import its frozen CSV fixtures as raw
// strings via Vite's `?raw` suffix (vitest resolves it at runtime),
// without pulling `@types/node` into the package's type surface.
declare module "*.csv?raw" {
  const content: string;
  export default content;
}
