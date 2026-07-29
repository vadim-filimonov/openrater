/**
 * computePlanReadiness — the ONE "can this plan rate yet?" selector.
 *
 * P2 G13 (ADR-0056, owner decision D1 ruled 2026-07-06): readiness
 * gates on **"compiles to a runnable chain, issue-free"** — the dry
 * projector compile — NOT on stage-bucket accounting or a factor-table
 * count. The pre-G13 selector read `section_layout` buckets nothing
 * writes (so "Set eligibility" could never complete and the Algorithm
 * dot never cleared on a from-scratch plan) and hard-gated on "≥1
 * factor table", which the spine calls optional (a literal-base chain
 * rates with zero tables).
 *
 * TWO grades, one selector (every surface calls THIS — Brief 74's Home
 * and the per-plan Overview can never drift):
 *   · "compiled"   — the caller supplied the dry projection
 *     (ProjectionResult from `stagesToRuntimePlan`): readiness IS
 *     "a runnable chain emitted AND zero severity-error projection
 *     issues". The plan detail page runs this grade (it already holds
 *     the projection for scoring).
 *   · "structural" — no projection supplied (list pages that can't
 *     afford a substrate fetch per plan): readiness approximates with
 *     "≥1 rating-chain stage". Honest label via `grade` so a consumer
 *     can qualify the signal.
 *
 * `hasInputs` is reported for checklist DISPLAY but is deliberately
 * NOT a rail — a constants-only plan compiles and rates.
 *
 * Brief 89 R7 (2026-07-13) — the RATE rail. `compileReady` is engine
 * truth ("a runnable chain emitted, issue-free") but it is NOT "the
 * golden-path sample run will produce a number": a chain step that
 * reads an input nothing declares (the scaffold's column-shaped LCM,
 * a factor keyed on an undeclared dim) compiles fine and REFUSES at
 * run time. The pill said "Ready to rate" over a red refusal (F5).
 * Callers that own the substrate now also pass
 * `undeclaredRequiredInputCount` (required-by-structure minus
 * declared) and gate golden-path affordances on `rateReady` with
 * `nextStepHint` as the phrase. `compileReady` keeps its meaning for
 * Ship/publish gating (a declared-and-mapped column-shaped LCM is a
 * legitimate plan — 89.2/R8 will separate unset-constant repair from
 * true input declaration; the hint phrasing here stays input-worded
 * until then).
 */

export interface PlanReadinessSubstrate {
  /** Count of declared inputs (`input_node` stages) — display row. */
  readonly declaredInputCount: number;
  /** Count of rating-chain stages (`multiplicative_chain`). */
  readonly chainStageCount: number;
  /**
   * The dry compile, when the caller holds the full substrate: whether
   * the projected plan carries a runnable chain (`chain.mult` emitted)
   * and how many severity-"error" ProjectionIssues the projection
   * reported (ADR-0056). Omit/null on list pages → structural grade.
   */
  readonly projection?: {
    readonly hasRunnableChain: boolean;
    readonly errorIssueCount: number;
  } | null;
  /**
   * Brief 89 R7 — fields the rating structure reads that no
   * `input_node` declares (the ghost-row count, TRUE risk inputs
   * only after R8). Omit on list pages (defaults 0 → `rateReady`
   * degrades to `compileReady`, honest for the structural grade).
   */
  readonly undeclaredRequiredInputCount?: number;
  /**
   * Brief 89 R8 — chain-owned scalar slots with no authored value
   * and no deliberate declaration (the column-shaped LCM). Phrased
   * as "N steps need values." — the repair lives in Rating, not the
   * dictionary.
   */
  readonly unsetValueStepCount?: number;
}

export interface PlanReadiness {
  /** ≥1 declared input — checklist display only, never a rail. */
  readonly hasInputs: boolean;
  /** ≥1 authored rating-chain stage (the structural signal). */
  readonly hasAlgorithm: boolean;
  /** The compile verdict (dry-compile grade), else = hasAlgorithm. */
  readonly compiles: boolean;
  /** Severity-error projection issues (0 under the structural grade). */
  readonly errorIssueCount: number;
  /** Which evidence produced `compiles`. */
  readonly grade: "compiled" | "structural";
  /** D1 — THE rail: compiles && zero error issues. */
  readonly compileReady: boolean;
  /** Names the blocker ("Build the algorithm first." / "Fix N authoring
   *  issues first."). Null when ready. */
  readonly blockingHint: string | null;
  /** Brief 89 R7 — the ghost-row count fed by the caller (0 default). */
  readonly undeclaredRequiredInputCount: number;
  /** Brief 89 R8 — unset chain-constant slots (0 default). */
  readonly unsetValueStepCount: number;
  /** R7 — the golden-path rail: compileReady AND nothing the structure
   *  needs is undeclared/unset. Pill / Rate sample / Run verdict read THIS. */
  readonly rateReady: boolean;
  /** R7 — the pill phrase when !rateReady: names the next step in plan
   *  words ("2 steps need values." / "Declare 2 inputs the algorithm
   *  needs."). Null when ready. */
  readonly nextStepHint: string | null;
}

export function computePlanReadiness(
  substrate: PlanReadinessSubstrate,
): PlanReadiness {
  const hasInputs = substrate.declaredInputCount > 0;
  const hasAlgorithm = substrate.chainStageCount > 0;
  const projection = substrate.projection ?? null;
  const grade = projection ? ("compiled" as const) : ("structural" as const);
  const compiles = projection ? projection.hasRunnableChain : hasAlgorithm;
  const errorIssueCount = projection ? projection.errorIssueCount : 0;
  const compileReady = compiles && errorIssueCount === 0;

  const blockingHint = compileReady
    ? null
    : !compiles
      ? "Build the algorithm first."
      : `Fix ${errorIssueCount} authoring issue${errorIssueCount === 1 ? "" : "s"} first.`;

  const undeclaredRequiredInputCount =
    substrate.undeclaredRequiredInputCount ?? 0;
  const unsetValueStepCount = substrate.unsetValueStepCount ?? 0;
  const rateReady =
    compileReady &&
    undeclaredRequiredInputCount === 0 &&
    unsetValueStepCount === 0;
  // R7/R8 phrase ladder. A FULLY-empty plan gets the fork phrase —
  // either door is a valid next step (Brief 89 R6). Unset constants
  // phrase before declares: their repair (set a value in Rating) is
  // one click closer than a declaration.
  const atGenesis = !hasInputs && !hasAlgorithm;
  const nextStepHint = rateReady
    ? null
    : atGenesis
      ? "Bring the plan's variables."
      : !compileReady
        ? blockingHint
        : unsetValueStepCount > 0
          ? unsetValueStepCount === 1
            ? "1 step needs a value."
            : `${unsetValueStepCount} steps need values.`
          : `Declare ${undeclaredRequiredInputCount} input${undeclaredRequiredInputCount === 1 ? "" : "s"} the algorithm needs.`;

  return {
    hasInputs,
    hasAlgorithm,
    compiles,
    errorIssueCount,
    grade,
    compileReady,
    blockingHint,
    undeclaredRequiredInputCount,
    unsetValueStepCount,
    rateReady,
    nextStepHint,
  };
}
