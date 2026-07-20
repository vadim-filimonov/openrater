/**
 * Engine bootstrap — the ONE rating engine, reused (never ported).
 *
 * The whole point of this service (ADR-0045): import `@openrater/contracts`
 * so server-side scoring is byte-identical to the Rate Lab canvas.
 * No engine code lives here — only the per-process registry bootstrap.
 *
 * `globalRegistry` is module-scoped mutable state and `register()`
 * throws on a duplicate id. So every entrypoint (HTTP server, worker,
 * Lambda cold start) MUST call `ensureEngineReady()` exactly once and
 * then pass the returned registry EXPLICITLY into `executePlan*`. A
 * compiled plan stays bound to the registry it was validated against
 * (CompiledPlan.registry), so passing it explicitly removes any chance
 * of "ran against an empty/global registry" silent-parity drift — the
 * #1 failure mode for a server that reuses the engine.
 */

import {
  registerBuiltinKinds,
  globalRegistry,
  type KindRegistry,
} from "@openrater/contracts";

let ready = false;

/**
 * Register the 18 canonical block kinds into the process registry,
 * exactly once. Idempotent: a duplicate-registration error means the
 * builtins are already present (another entrypoint in the same process
 * beat us to it), which is safe to ignore. Returns the populated
 * registry for callers to thread into `executePlan` / `executePlanBatch`.
 */
export function ensureEngineReady(): KindRegistry {
  if (ready) return globalRegistry;
  try {
    registerBuiltinKinds();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/already registered/.test(message)) throw err;
  }
  ready = true;
  return globalRegistry;
}
