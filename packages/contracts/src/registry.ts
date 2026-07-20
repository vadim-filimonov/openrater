/**
 * Block kind registry — v0
 *
 * The single source of truth for which block kinds exist in a given
 * scope. Two ways to use it:
 *
 *   1. The DEFAULT scope (`globalRegistry`). Module-scoped. Single
 *      shared registry per process. Most callers don't think about
 *      this at all — `registerBuiltinKinds()` registers into it,
 *      `compilePlan(plan)` reads from it, and the system works.
 *
 *   2. ISOLATED scopes (`new KindRegistry()`). Each instance has its
 *      own kind set. Use this when:
 *        · multi-tenant SaaS: tenant A has custom kinds, tenant B
 *          does not — don't pollute one with the other
 *        · tests: each suite gets a fresh registry, no need for
 *          `_clearRegistryForTests()` between tests
 *        · sandboxing: untrusted plans only see a vetted kind subset
 *
 * Adding a new kind to the default scope is a one-file change:
 *   1. Author the kind (implementing BlockKind)
 *   2. Call registerBlockKind(MyKind)  // mutates globalRegistry
 *   3. Import the file from the kinds barrel
 *
 * To register into an isolated scope, call `registry.register(kind)`
 * directly and pass `registry` to `compilePlan(plan, registry)`.
 *
 * The registry is not magic — it's a Map. But making it the only
 * entry point means the rest of the system never has to know about
 * specific kinds.
 */

import type { BlockCategory, BlockKind } from "./block-types";

/**
 * A registry of block kinds — a single named scope of "which kinds
 * exist." A `compilePlan(plan, registry)` call resolves every
 * `node.kind` against the supplied registry.
 *
 * The default `globalRegistry` is what `registerBlockKind()` /
 * `getBlockKind()` / etc. operate on. Construct your own instance
 * to isolate a tenant, a test suite, or a sandboxed runtime from
 * the shared global.
 */
export class KindRegistry {
  private readonly kinds = new Map<string, BlockKind>();

  /**
   * Register a block kind. Calls to register the same id are a hard
   * error — the registry refuses to silently overwrite.
   */
  register<P, I, O>(kind: BlockKind<P, I, O>): void {
    if (this.kinds.has(kind.id)) {
      throw new Error(
        `Block kind "${kind.id}" is already registered. ` +
          `Block kind ids must be unique within a registry.`,
      );
    }
    this.kinds.set(kind.id, kind as unknown as BlockKind);
  }

  /**
   * Look up a kind by its id. Returns undefined if not found —
   * callers must handle the missing case. We don't throw because
   * plans can reference kinds from packages that aren't loaded;
   * the compile layer surfaces those as `unknown-kind` errors.
   */
  get(id: string): BlockKind | undefined {
    return this.kinds.get(id);
  }

  /** List all registered kinds. Used by the library / tray for browsing. */
  list(): readonly BlockKind[] {
    return Array.from(this.kinds.values());
  }

  /** Filter by category — used by the tray's context-aware suggestions. */
  listByCategory(category: BlockCategory): readonly BlockKind[] {
    return this.list().filter((k) => k.category === category);
  }

  /**
   * Find kinds whose first input port accepts the given output type.
   * Used by the drag-from-port quick-create menu.
   */
  findAcceptingType(typeId: string): readonly BlockKind[] {
    return this.list().filter((k) => {
      const firstIn = k.inputs[0];
      if (!firstIn) return false;
      if (typeof firstIn.type === "string") {
        return firstIn.type === typeId;
      }
      return false;
    });
  }

  /**
   * Clear all registered kinds. Public on the instance because
   * isolated registries are throwaway by design — a per-test or
   * per-tenant registry might legitimately want a reset.
   */
  clear(): void {
    this.kinds.clear();
  }
}

/**
 * The default, shared registry. `registerBuiltinKinds()` and the
 * `registerBlockKind()` / `getBlockKind()` / etc. convenience
 * functions all operate on this instance.
 *
 * Multi-tenant or sandbox callers should construct `new
 * KindRegistry()` and pass it to `compilePlan(plan, registry)`
 * instead of using the global.
 */
export const globalRegistry = new KindRegistry();

// ── Convenience wrappers around globalRegistry ──────────────
//
// The pre-class API. Kept for backwards compatibility — existing
// callers that did `registerBlockKind(MyKind)` keep working without
// changes. New code that needs isolation should hold a
// `KindRegistry` instance directly.

/**
 * Register a block kind into the default `globalRegistry`. Calls to
 * register the same id are a hard error — the registry refuses to
 * silently overwrite.
 */
export function registerBlockKind<P, I, O>(kind: BlockKind<P, I, O>): void {
  globalRegistry.register(kind);
}

/**
 * Look up a kind by its id in the default `globalRegistry`. Returns
 * undefined if not found.
 */
export function getBlockKind(id: string): BlockKind | undefined {
  return globalRegistry.get(id);
}

/** List all kinds in the default `globalRegistry`. */
export function listBlockKinds(): readonly BlockKind[] {
  return globalRegistry.list();
}

/** List kinds in the default `globalRegistry` filtered by category. */
export function listBlockKindsByCategory(
  category: BlockCategory,
): readonly BlockKind[] {
  return globalRegistry.listByCategory(category);
}

/**
 * Find kinds in the default `globalRegistry` whose first input port
 * accepts the given output type.
 */
export function findKindsAcceptingType(typeId: string): readonly BlockKind[] {
  return globalRegistry.findAcceptingType(typeId);
}

/**
 * Clear the default `globalRegistry`. ONLY for testing — production
 * code never calls this. We expose it because Vitest re-imports
 * modules across test files and we want each test suite to start
 * fresh if it shares the global.
 *
 * Tests that want full isolation should `new KindRegistry()` and
 * skip this entirely.
 */
export function _clearRegistryForTests(): void {
  globalRegistry.clear();
}
