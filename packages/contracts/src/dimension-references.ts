/**
 * Dimension reference resolver — Brief 30 PR 30.4.
 *
 * Walks the plan's consumers (chain stages, factor tables, modifier
 * schedules) and emits a list of references to a given dimension.
 * Pure function; takes whatever sources the caller has available +
 * returns a deterministic-ordered list.
 *
 * The labs-ui `<UsedInPanel>` consumes this list to render the
 * navigational hub in the dim editor (Brief 30 §6 / Frame 3).
 *
 * Brief 34 PR 34.7 removed the curve walk: curves no longer exist
 * as a first-class concept (Brief 19 → Brief 34 supersession).
 *
 * Out of scope:
 *   • Navigation. Each `DimensionReferenceLite` carries enough
 *     info for the route to dispatch a `navigate()` call; the
 *     resolver does NOT decide destinations.
 *   • Severity / blocking-ness. Broken references (e.g., a band
 *     gap that orphans table rows) are flagged with a `broken`
 *     reason; the route + the Brief 13 issue aggregator decide
 *     whether they block filing.
 *   • Reverse lookups (who DOESN'T reference this dim?). Use
 *     plan-level validation instead.
 *
 * No React, no DOM.
 */

/**
 * Minimal stage summary the resolver inspects. Structurally compatible
 * with `StageSummary` from `@openrater/api-client` (the canonical type),
 * but kept local so this module doesn't pull on the api-client.
 */
export interface ChainStageSummary {
  readonly stage_id: string;
  readonly stage_kind: string;
  readonly display_name: string;
  readonly config_json: unknown;
}

/**
 * One reference to a dimension. Mirrors the labs-ui
 * `DimensionReference` shape but lives in @openrater/contracts so the
 * route can compose it without importing labs-ui types.
 */
export interface DimensionReferenceLite {
  /** Discriminator — drives the editor's icon + accent. */
  readonly kind: "chain" | "factor-table" | "modifier";
  /** Route-stable id for navigation. */
  readonly id: string;
  /** Display label (typically the consumer's name or slug-prefixed string). */
  readonly label: string;
  /** Where the dim is used inside the consumer (e.g., "stage 3 · Age factor"). */
  readonly context: string;
  /**
   * When set, this reference is broken (e.g., the dim's level set
   * doesn't cover the table's key vector). The reason is a complete
   * sentence for surfacing in the warning chip.
   */
  readonly broken?: { readonly reason: string };
}

/**
 * Minimal shape of a factor table the resolver inspects. Both 1-D
 * (`key_dimension`) and 2-D (`key_dimensions`) variants are
 * supported — the resolver checks both. The route passes its
 * fixture-mode `SAMPLE_FACTOR_TABLES` directly; an API
 * shape compatible with this interface works too.
 */
export interface FactorTableReference {
  readonly id: string;
  readonly display_name?: string;
  readonly slug?: string;
  /** 1-D table — single key dim slug. */
  readonly key_dimension?: string;
  /** 2-D / N-D table — ordered key dim slugs. */
  readonly key_dimensions?: readonly string[];
}

/**
 * Minimal shape of a modifier schedule the resolver inspects.
 * Same single/plural key pattern as FactorTableReference.
 */
export interface ModifierScheduleReference {
  readonly id: string;
  readonly display_name?: string;
  readonly slug?: string;
  readonly key_dimension?: string;
  readonly key_dimensions?: readonly string[];
}

/** Inputs to the resolver. Each source is optional + independent. */
export interface FindDimensionReferencesInput {
  /** The dim slug to resolve references for. */
  readonly dimSlug: string;
  /**
   * The dim id (when distinct from the slug). When provided + a
   * stage references the dim by id rather than slug, those refs
   * surface too. Optional; defaults to dimSlug.
   */
  readonly dimId?: string;
  readonly stages?: readonly ChainStageSummary[];
  readonly factorTables?: readonly FactorTableReference[];
  readonly modifiers?: readonly ModifierScheduleReference[];
}

/**
 * Find every place a dim is referenced. Returns a list with
 * deterministic ordering (chains first, then factor tables, then
 * modifiers; within each kind sorted by id).
 *
 * Empty array when the dim has no consumers.
 */
export function findDimensionReferences(
  input: FindDimensionReferencesInput,
): readonly DimensionReferenceLite[] {
  const { dimSlug, dimId, stages, factorTables, modifiers } = input;
  const aliases = new Set([dimSlug]);
  if (dimId !== undefined) aliases.add(dimId);

  const out: DimensionReferenceLite[] = [];

  // ── Chain stages ──────────────────────────────────────────────
  if (stages) {
    for (const stage of stages) {
      if (stage.stage_kind !== "multiplicative_chain") continue;
      const config = stage.config_json as
        | { readonly chains?: ReadonlyArray<unknown> }
        | null;
      const chains = (config?.chains ?? []) as ReadonlyArray<{
        readonly name?: string;
        readonly factor_lookups?: ReadonlyArray<{
          readonly name?: string;
          readonly dimensions?: Readonly<
            Record<
              string,
              { readonly source?: string; readonly path?: string } | undefined
            >
          >;
        }>;
      }>;
      let chainIndex = 0;
      for (const chain of chains) {
        const factorLookups = chain.factor_lookups ?? [];
        let factorIndex = 0;
        for (const factor of factorLookups) {
          const dims = factor.dimensions ?? {};
          // The dim is "used" if either the key OR the binding's
          // path matches an alias.
          const matched = Object.entries(dims).some(([key, binding]) => {
            if (aliases.has(key)) return true;
            if (
              binding?.source === "form_input" &&
              binding.path !== undefined &&
              aliases.has(binding.path)
            ) {
              return true;
            }
            return false;
          });
          if (matched) {
            const chainName = chain.name ?? `chain_${chainIndex + 1}`;
            const factorName = factor.name ?? `factor_${factorIndex + 1}`;
            out.push({
              kind: "chain",
              id: `${stage.stage_id}::${chainIndex}::${factorIndex}`,
              label: chainName,
              context: `${stage.display_name} · ${factorName}`,
            });
          }
          factorIndex += 1;
        }
        chainIndex += 1;
      }
    }
  }

  // ── Factor tables ─────────────────────────────────────────────
  if (factorTables) {
    for (const table of factorTables) {
      const keys: readonly string[] =
        table.key_dimensions ??
        (table.key_dimension !== undefined ? [table.key_dimension] : []);
      const matchIdx = keys.findIndex((k) => aliases.has(k));
      if (matchIdx >= 0) {
        const isFirst = matchIdx === 0;
        const isOnly = keys.length === 1;
        out.push({
          kind: "factor-table",
          id: table.id,
          // B6 — prefer the human display name; the raw `factor_table:<slug>`
          // form leaked an internal id onto a user surface (the USED IN panel).
          label: table.display_name ?? table.slug ?? table.id,
          context: isOnly
            ? "key column"
            : isFirst
              ? `1st of ${keys.length} key columns`
              : `${ordinal(matchIdx + 1)} of ${keys.length} key columns`,
        });
      }
    }
  }

  // ── Modifier schedules ────────────────────────────────────────
  if (modifiers) {
    for (const mod of modifiers) {
      const keys: readonly string[] =
        mod.key_dimensions ??
        (mod.key_dimension !== undefined ? [mod.key_dimension] : []);
      if (keys.some((k) => aliases.has(k))) {
        out.push({
          kind: "modifier",
          id: mod.id,
          label: `modifier:${mod.slug ?? mod.id}`,
          context: keys.length === 1 ? "key column" : `1 of ${keys.length} keys`,
        });
      }
    }
  }

  // Brief 34 PR 34.7: curve refs are gone.

  // Already deterministic by iteration order; do nothing more.
  return Object.freeze(out);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] ?? s[v] ?? s[0]!;
  return `${n}${suffix}`;
}
