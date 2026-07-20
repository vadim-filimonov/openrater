/**
 * factorTableChainRebind — Brief 70.1 (the skeptic's silent-×1.0
 * landmine).
 *
 * At score time the runtime keys every table lookup off the CHAIN's
 * stored `factor_lookups[].dimensions` slugs — NOT the factor-table
 * catalog. Those bindings are only rewritten when Assemble next saves,
 * so changing a table's axes in the Factor Tables editor left every
 * referencing chain keyed on the OLD dimensions: the lookup resolved
 * nothing and silently fell back to ×1.0 until an unrelated Assemble
 * autosave happened to fire.
 *
 * This pure helper computes the stage patches that close the loop:
 * for every `multiplicative_chain` stage whose lookups read the table
 * (`factor_kind === tableId`), it rewrites that lookup's `dimensions`
 * map to the table's NEW key dimensions — preserving any authored
 * axis source that survives the change (same slug stays bound),
 * defaulting new axes to the canonical `form_input` binding on the
 * slug (mirroring `buildDimensionsForTable`).
 *
 * The Factor Tables route applies the patches via the existing
 * `PATCH /drafts/{id}` stage-patch endpoint in the same act as the
 * axis change (Brief 70 lock D7: auto-patch).
 */

export interface AxisSourceLike {
  readonly source: string;
  readonly path?: string;
  readonly [key: string]: unknown;
}

export interface StageLikeForRebind {
  readonly stage_id: string;
  readonly stage_kind: string;
  readonly config_json: Record<string, unknown> | null;
}

export interface ChainRebindPatch {
  readonly stage_id: string;
  readonly config_json: Record<string, unknown>;
}

export interface ChainRebindResult {
  /** One patch per AFFECTED chain stage (read-modify-written whole). */
  readonly patches: readonly ChainRebindPatch[];
  /** Human labels of the re-bound lookups ("Construction factor · Building chain"). */
  readonly rebound: readonly string[];
}

/**
 * Compute the chain patches for a table whose key dimensions changed
 * to `newKeyDims`. Returns zero patches when nothing references the
 * table (the common case — cheap to call unconditionally).
 */
export function rebindChainsForTableAxes(
  stages: readonly StageLikeForRebind[],
  tableId: string,
  newKeyDims: readonly string[],
): ChainRebindResult {
  const patches: ChainRebindPatch[] = [];
  const rebound: string[] = [];

  for (const stage of stages) {
    if (stage.stage_kind !== "multiplicative_chain") continue;
    const cfg = stage.config_json;
    if (!cfg || !Array.isArray(cfg.chains)) continue;

    let touched = false;
    const nextChains = (cfg.chains as ReadonlyArray<Record<string, unknown>>).map(
      (chain) => {
        const lookups = chain.factor_lookups;
        if (!Array.isArray(lookups)) return chain;
        let chainTouched = false;
        const nextLookups = (
          lookups as ReadonlyArray<Record<string, unknown>>
        ).map((lookup) => {
          if (lookup.factor_kind !== tableId) return lookup;
          const oldDims =
            (lookup.dimensions as
              | Readonly<Record<string, AxisSourceLike>>
              | undefined) ?? {};
          const nextDims: Record<string, AxisSourceLike> = {};
          for (const slug of newKeyDims) {
            // A surviving slug keeps its authored source (literal /
            // computed / class-attribute bindings outlive the change);
            // a NEW axis gets the canonical form_input default.
            nextDims[slug] = oldDims[slug] ?? {
              source: "form_input",
              path: slug,
            };
          }
          chainTouched = true;
          rebound.push(
            [
              typeof lookup.name === "string" && lookup.name
                ? lookup.name
                : tableId,
              typeof chain.name === "string" && chain.name
                ? `${chain.name} chain`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
          );
          return { ...lookup, dimensions: nextDims };
        });
        if (!chainTouched) return chain;
        touched = true;
        return { ...chain, factor_lookups: nextLookups };
      },
    );

    if (touched) {
      // Read-modify-write the WHOLE config — unknown keys survive
      // verbatim (the 69.1 doctrine).
      patches.push({
        stage_id: stage.stage_id,
        config_json: { ...cfg, chains: nextChains },
      });
    }
  }

  return { patches, rebound };
}
