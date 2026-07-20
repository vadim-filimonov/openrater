/**
 * deriveRunView — turn a single-risk RunResult into the Test tab's
 * result view (V4 audit G2).
 *
 * The projected runtime plan emits one money output per coverage chain
 * (in tower order) plus, when the plan carries a `round` tail stage, an
 * aggregate output (`total_premium` by convention). The old Test tab
 * summed EVERY numeric output for its headline, so a plan with an
 * aggregate double-counted: building $640 + bpp $196 + liability $0 +
 * total $836 read as $1,672.
 *
 * The rules here:
 *   · headline = the plan's aggregate output when present, else the
 *     sum of the per-coverage money outputs;
 *   · rows     = the per-coverage outputs only (the aggregate is the
 *     headline, never a row), in plan-node order — the projector emits
 *     output nodes in tower order;
 *   · non-money outputs (factor diagnostics, contributions) never
 *     enter the math and never render as currency;
 *   · one currency format for every value — whole dollars, cents only
 *     when a value genuinely has them ("$0", not "$0.00").
 */

export interface RunOutputNode {
  readonly kind: string;
  readonly params?: unknown;
}

export interface DerivedRunView {
  /** The headline number (the aggregate when present). */
  readonly premium: number;
  readonly premiumLabel: string;
  /** Per-coverage rows in tower order — never includes the aggregate. */
  readonly outputs: readonly { field: string; valueLabel: string }[];
}

/** "$836" / "$0" / "$12.50" — cents only when the value has them. */
export function formatRunPremium(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * @param plan       the projected runtime plan (its output nodes carry
 *                   fieldName + fieldType and sit in tower order)
 * @param outputs    RunResult.outputs from runPlan
 * @param totalField the aggregate output's field name — the round tail
 *                   stage's `output_field`, `"total_premium"` by
 *                   convention (TOTAL_TOWER_OUTPUT_FIELD)
 * @returns the view, or null when the run produced nothing usable
 *          (the caller renders its honest error state)
 */
export function deriveRunView(
  plan: {
    readonly nodes?: ReadonlyArray<RunOutputNode>;
  },
  outputs: Record<string, unknown>,
  totalField = "total_premium",
): DerivedRunView | null {
  // Money outputs in plan-node (= tower) order.
  let entries: Array<{ field: string; value: number }> = [];
  for (const node of plan.nodes ?? []) {
    if (node.kind !== "output") continue;
    const params = node.params as
      | { fieldName?: string; fieldType?: string }
      | undefined;
    if (params?.fieldType !== "money") continue;
    const field = params.fieldName;
    if (typeof field !== "string" || field.length === 0) continue;
    const value = outputs[field];
    if (isFiniteNumber(value)) entries.push({ field, value });
  }

  // Fallback for plans whose outputs carry no money typing (hand-built
  // runtime plans): every numeric output, in record order. The
  // aggregate exclusion below still guards the double-count.
  if (entries.length === 0) {
    entries = Object.entries(outputs)
      .filter((e): e is [string, number] => isFiniteNumber(e[1]))
      .map(([field, value]) => ({ field, value }));
  }
  if (entries.length === 0) return null;

  const aggregate = entries.find((e) => e.field === totalField);
  const coverageRows = entries.filter((e) => e.field !== totalField);
  const premium =
    aggregate?.value ?? coverageRows.reduce((sum, e) => sum + e.value, 0);

  return {
    premium,
    premiumLabel: formatRunPremium(premium),
    outputs: coverageRows.map((e) => ({
      field: e.field,
      valueLabel: formatRunPremium(e.value),
    })),
  };
}
