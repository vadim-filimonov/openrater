/**
 * Class library lookup interface — runtime handle for class-conditional
 * exposure resolution.
 *
 * Per Brief 16 (class-conditional exposure base, P-CE3). The runtime
 * receives a `ClassLibrary` via `RunOptions.classLibrary` and passes
 * it through `ExecuteContext.classLibrary`. The `input.class_exposure`
 * kind uses this handle to:
 *
 *   1. Look up the bound class from the per-risk inputs.
 *   2. Find the class's declared exposure_bases.
 *   3. Pick the right declaration for the current coverage scope.
 *   4. Resolve to the right runtime input key + value.
 *
 * This interface is intentionally MINIMAL — we only put what the
 * runtime needs for resolution + explanation. The full ClassRecord
 * aggregate (with family, eligibility, NAICS, etc.) lives in the api-
 * lab class registry; the rate-lab UI consumes a richer shape. The
 * runtime sees just this slice.
 *
 * Implementation note: the integrator wires their class registry to
 * this interface. For the in-memory ISO seed library (Brief 16 §13
 * point 2 — "ISO class library backfill"), a simple Map-backed
 * implementation suffices. For larger libraries served from a
 * database, lookup() may be sync (preloaded) or async — but the
 * runtime today expects sync, so async lookups need a caller-side
 * preload step.
 *
 * Pure types. No React, no DOM. See `docs/design-briefs/class-
 * conditional-exposure.md` for the full design.
 */

import type { ExposureBaseDeclaration } from "./exposure-types";

/**
 * One class's slice of the registry — what the runtime needs to
 * resolve class-conditional exposure at execution time.
 */
export interface ClassLibraryEntry {
  /** The class code (e.g., "91342", "71641"). */
  readonly class_code: string;
  /** Display name shown in trace explanations (e.g., "Concrete
   *  contractors", "Restaurants"). */
  readonly display_name: string;
  /** Exposure declarations for this class. May be empty for legacy
   *  classes that haven't been declared yet; the runtime treats that
   *  as a resolution error and surfaces it through the trace. */
  readonly exposure_bases: readonly ExposureBaseDeclaration[];
}

/**
 * The runtime-side class library handle.
 *
 * Integrators construct a ClassLibrary (typically backed by an in-
 * memory Map or a database adapter) and pass it via
 * `RunOptions.classLibrary`. The runtime forwards it through
 * `ExecuteContext.classLibrary` so kinds can call lookup().
 */
export interface ClassLibrary {
  /**
   * Look up a class by its code. Returns the runtime-shaped entry,
   * or undefined when the code is unknown.
   *
   * MUST be deterministic for the lifetime of a single run — calling
   * twice with the same code returns identical entries. The
   * conformance suite depends on this; the audit trail does too.
   */
  lookup(class_code: string): ClassLibraryEntry | undefined;
}

/**
 * Convenience factory: build a ClassLibrary from an array of entries.
 *
 * Useful for tests, conformance vectors, and the in-memory ISO seed.
 * The returned library is frozen — entries cannot be mutated after
 * construction, matching the determinism guarantee.
 */
export function makeClassLibrary(
  entries: readonly ClassLibraryEntry[],
): ClassLibrary {
  const byCode = new Map<string, ClassLibraryEntry>();
  for (const entry of entries) {
    byCode.set(entry.class_code, entry);
  }
  return Object.freeze({
    lookup(class_code: string): ClassLibraryEntry | undefined {
      return byCode.get(class_code);
    },
  });
}
