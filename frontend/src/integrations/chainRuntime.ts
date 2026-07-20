/**
 * Chain runtime constants (lcm + base-rate input defaults) for the plan
 * projector (`stagesToRuntimePlan`).
 *
 * Extracted from PlanDetailRoute (Brief 46) so BOTH the plan re-rating
 * path AND the book re-rate path (`runBookRerate`) resolve the same
 * runtime config — DRY, one source of truth.
 *
 * ── PURE BACK-COMPAT (cold-test L30 / ADR-0033) ──
 *
 * The base rate is a first-class chain property now (`ChainSpec.base_value`,
 * set in ASSEMBLE): the projector emits it as a `constant` base node and a
 * from-scratch plan scores without any per-template injection. The
 * per-template MAP survives ONLY so a legacy plan whose row still carries
 * `template_id = "nonprofit_990"` keeps resolving its LCM + base rates the
 * old way. New plans never touch it; when the last template-tagged plan is
 * gone it can be deleted (ADR-0033 §0 — the 3rd patch, pending that
 * data migration). It is NOT in the engine/projector itself — it's a
 * caller-supplied config.
 */

export interface ChainRuntimeDefaults {
  readonly lcm: number;
  /** Base rates the chain references as `form_input.<field>`; the
   *  projector applies each as an `input`-node `defaultValue`. */
  readonly inputDefaults: Readonly<Record<string, number>>;
}

/** Legacy per-template defaults. Only `nonprofit_990` (the historical
 *  cold-test fixture) remains; new plans carry `base_value`. */
export const CHAIN_RUNTIME_DEFAULTS_BY_TEMPLATE: Readonly<
  Record<string, ChainRuntimeDefaults>
> = {
  nonprofit_990: {
    lcm: 1.35,
    inputDefaults: { do_base_rate: 600, gl_base_rate: 300 },
  },
};

/** The generic fallback for every plan with no template entry. Empty
 *  `inputDefaults` — a chain carries its own `base_value`. `lcm` is the
 *  IDENTITY 1.0 (E11): a non-identity placeholder like 1.35 silently
 *  mis-scaled every premium ~35% on a fresh plan the author never opted
 *  into. The actuary sets a real LCM in the Assemble CONSTANTS panel;
 *  an authored LCM overrides this on the wire. Kept in lockstep with the
 *  seeded `LCM` inventory constant in PlanDetailRoute (cold-test N15:
 *  seed and runtime default must agree, or the panel disagrees with what
 *  scoring applies). Legacy template plans keep their own LCM above. */
export const DEFAULT_CHAIN_RUNTIME: ChainRuntimeDefaults = {
  lcm: 1.0,
  inputDefaults: {},
};

/** Resolve the chain runtime config for a plan by its `template_id`. */
export function resolveChainRuntime(
  templateId: string | null | undefined,
): ChainRuntimeDefaults {
  return (
    (templateId && CHAIN_RUNTIME_DEFAULTS_BY_TEMPLATE[templateId]) ||
    DEFAULT_CHAIN_RUNTIME
  );
}
