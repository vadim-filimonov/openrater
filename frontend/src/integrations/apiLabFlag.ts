/**
 * apiLabFlag — MVP-027 (owner O2): the API Lab room ships FLAG-OFF for
 * the MVP cold test. The room's code stays and `/api-lab` still
 * answers a typed URL; what leaves the first-run story are the DOORS —
 * the ⌘K entry, the Rate Lab toolbar button, and the Inputs "Fetch
 * from an API" source mode. (Home's connector attention is separately
 * gated on a route existing — MVP-005.)
 *
 * Flip it on per-machine without a rebuild:
 *   localStorage.setItem("rater:show-api-lab", "1")
 * or ship it on at build time with VITE_RATER_SHOW_API_LAB=1.
 */
export function showApiLab(): boolean {
  try {
    if (localStorage.getItem("rater:show-api-lab") === "1") return true;
  } catch {
    // storage unavailable (SSR/tests) — fall through to the env.
  }
  const env = (
    import.meta as unknown as {
      env?: { VITE_RATER_SHOW_API_LAB?: string };
    }
  ).env?.VITE_RATER_SHOW_API_LAB;
  return env === "1" || env === "true";
}
