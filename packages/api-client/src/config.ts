/**
 * API base URL — single source of truth.
 *
 * Reads from Vite's `import.meta.env.VITE_API_BASE` at build time;
 * defaults to the local api-lab dev server. Override via .env.local
 * or VITE_API_BASE=https://your-host pnpm build for deployment.
 *
 * Integrators may also call `setApiBase()` at runtime — useful for
 * tests, storybook, or multi-environment deploys where the URL is
 * known at boot, not build.
 */

let API_BASE: string = readEnvDefault();

function readEnvDefault(): string {
  // Vite injects import.meta.env at build. In non-Vite consumers
  // (tests, node scripts) the property may not exist, so we soft-read
  // through a cast and default if absent.
  const env = (import.meta as unknown as { env?: { VITE_API_BASE?: string } })
    .env;
  const configured = env?.VITE_API_BASE;
  if (configured === "same-origin" || configured === "") {
    // Same-origin build (the desktop bundle, or any deploy where one
    // server serves both the SPA and the API): the origin that served
    // the page IS the API. Resolved at RUNTIME because the desktop
    // runtime picks a free port — unknowable at build time. The
    // fetcher needs an absolute base (`new URL`), so origin, not "".
    return typeof window !== "undefined"
      ? window.location.origin
      : "http://127.0.0.1:8001";
  }
  return configured ?? "http://127.0.0.1:8001";
}

export function getApiBase(): string {
  return API_BASE;
}

export function setApiBase(base: string): void {
  API_BASE = base.replace(/\/+$/, ""); // trim trailing slash
}
