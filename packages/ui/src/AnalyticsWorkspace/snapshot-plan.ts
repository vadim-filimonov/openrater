/**
 * Snapshot body → runtime Plan projection (Brief 43 §4) — PURE module.
 *
 * Relocated out of `analytics-bridge.ts` (which carries `window`-bound
 * localStorage helpers) so server-side consumers — the scoring
 * service's `source:"plan_id"` resolution (ADR-0049 A8) — can import
 * the projection without dragging DOM types into a Node type-graph.
 * The same move the projector made for `RequiredInputCategory`.
 * `analytics-bridge` re-exports it, so browser call sites are
 * unchanged.
 *
 * A frozen snapshot's `body` is a *substrate* snapshot — the shape
 * api-lab's `_compose_body` serializes:
 *
 *   { plan, stages, dimensions, factor_tables, input_mapping }
 *
 * It is NOT a runtime `Plan` (no `nodes` / `edges`). `compilePlan`
 * iterates `plan.nodes`, so feeding the raw body straight into
 * `executePlanBatch` throws `plan.nodes is not iterable`. This
 * projector bridges the gap: it reads the frozen substrate and runs
 * the SAME `stagesToRuntimePlan` projector the live Inputs workspace
 * uses, yielding a runtime Plan that re-rates the frozen algorithm
 * against live rows.
 *
 * Returns `null` when the snapshot carries no runnable rating chain
 * (an empty plan, or one frozen before any `multiplicative_chain`
 * was authored). The caller treats `null` as "snapshot has no scored
 * plan" and leaves the baseline empty rather than scoring an echo.
 *
 * Pure: no I/O. Factor-table cells travel inlined on each
 * `factor_tables[i].cells` (api-lab `PlanFactorTable` wire shape), so
 * the projection is fully self-contained — no localStorage, no
 * re-fetch. `options` (lcmOverride / defaults / planId)
 * MUST mirror what the live Inputs path feeds `stagesToRuntimePlan`,
 * so the baseline emits the same output column the chart reads.
 */

import type { Dimension, Plan } from "@openrater/contracts";
import {
  stagesToRuntimePlan,
  type ProjectionResult,
  type StagesToRuntimePlanOptions,
} from "../InputsWorkspace/stagesToRuntimePlan";
import type {
  FactorTableLike,
  StageLike,
} from "../InputsWorkspace/deriveRequiredInputs";

/**
 * ADR-0055 / v4 G15 live-verify find — the singleton substrates land in
 * the snapshot body as their API **envelopes**, not bare payloads:
 * `_compose_body` serializes `get_input_mapping(...)` / `get_policy_tail(...)`
 * verbatim, so production bodies carry
 *
 *   input_mapping: { rating_plan_id, mapping: {…}, created_at, … }
 *   policy_tail:   { rating_plan_id, tail: […], created_at, … }
 *
 * while the module docstring's shape (payload directly) only ever existed
 * in fixtures. A reader that assumes ONE shape silently gets nothing —
 * the pre-existing `body.input_mapping?.rollup_fields` read rolled up
 * ZERO fields on every real snapshot. These two normalizers accept both
 * shapes (envelope-wrapped and bare) so re-rate, the cold-test guard,
 * and the scoring service's future tail read (G4-full) share one seam.
 */
export function snapshotBodyInputMapping(
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  const raw = body.input_mapping;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const envelope = raw as Record<string, unknown>;
  const inner = envelope.mapping;
  // The envelope shape — the payload rides its `mapping` field. A bare
  // PlanInputMapping has no `mapping` key, so this cannot misfire.
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return envelope;
}

export function snapshotBodyPolicyTail(
  body: Record<string, unknown>,
): readonly unknown[] | null {
  const raw = body.policy_tail;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const tail = (raw as Record<string, unknown>).tail;
    if (Array.isArray(tail)) return tail;
  }
  return null;
}

/**
 * ADR-0056 — project a snapshot body into `{ plan, issues }`. This is
 * the shape record-grade consumers (the scoring service's plan_id
 * path, book re-rate, Analytics baselines) migrate to in the G4/G5
 * steps so projection issues reach their surfaces.
 */
export function snapshotBodyToProjection(
  body: Record<string, unknown>,
  options?: StagesToRuntimePlanOptions,
): ProjectionResult | null {
  const stages = Array.isArray(body.stages)
    ? (body.stages as unknown as StageLike[])
    : [];
  if (stages.length === 0) return null;

  // The body's dimensions arrive in the WIRE shape (`dim_id`, levels
  // inline) — api-lab's `_compose_body` serializes the API rows
  // verbatim. The projector's `Dimension` keys on `id`, so a wire row
  // without one gets `id: dim_id` stamped on (everything else —
  // levels, geo_territories, derived_from — is field-identical between
  // the two shapes). Bodies already carrying `id` pass through
  // untouched. Before this normalization the dim lookup silently
  // missed, banded ILF lookups fell back to ×1.0, and every book
  // re-rate ran a few tenths of a percent hot on BOTH sides (the
  // ratio cancelled, so the dislocation view never showed it — the
  // Exhibits book-oracle test now pins the absolute premiums).
  const dimensions = Array.isArray(body.dimensions)
    ? (body.dimensions as ReadonlyArray<Record<string, unknown>>).map(
        (d) =>
          (d.id === undefined && typeof d.dim_id === "string"
            ? { ...d, id: d.dim_id }
            : d) as unknown as Dimension,
      )
    : [];

  // api-lab serializes each factor table with `table_id` + an inlined
  // `cells: { cellKey: value }` map (the storage sidecar is hidden by
  // the wire contract). `stagesToRuntimePlan` wants a `FactorTableLike`
  // catalog (keyed by `id`) PLUS a separate `Map<id, Map<cellKey,
  // number>>`. Split the inlined shape back into those two, keying
  // BOTH by `table_id` so `findFactorTable(...).id` and the
  // `cells.get(id)` lookup line up.
  const rawTables = Array.isArray(body.factor_tables)
    ? (body.factor_tables as ReadonlyArray<Record<string, unknown>>)
    : [];
  const factorTables: FactorTableLike[] = [];
  const cells = new Map<string, Map<string, number>>();
  for (const t of rawTables) {
    const id = typeof t.table_id === "string" ? t.table_id : undefined;
    if (!id) continue;
    // `slug` isn't on FactorTableLike but findFactorTable reads it via
    // cast; carry it through so factor_kind↔slug matching still works.
    const like: Record<string, unknown> = { id };
    if (typeof t.slug === "string") like.slug = t.slug;
    if (typeof t.display_name === "string") like.display_name = t.display_name;
    if (Array.isArray(t.key_dimensions)) {
      like.key_dimensions = t.key_dimensions;
      // The 1-D convenience field the catalog consumers read.
      if (t.key_dimensions.length === 1)
        like.key_dimension = t.key_dimensions[0];
    }
    // ADR-0063 — the linear-interpolation flag MUST survive the body
    // hop, or a curve the filing interpolates silently steps instead.
    if (t.interpolation !== undefined && t.interpolation !== null)
      like.interpolation = t.interpolation;
    factorTables.push(like as unknown as FactorTableLike);

    const inner = new Map<string, number>();
    const cellMap = t.cells;
    if (cellMap && typeof cellMap === "object") {
      for (const [k, v] of Object.entries(
        cellMap as Record<string, unknown>,
      )) {
        if (typeof v === "number" && Number.isFinite(v)) inner.set(k, v);
      }
    }
    cells.set(id, inner);
  }

  const projection = stagesToRuntimePlan(
    stages,
    dimensions,
    factorTables,
    cells,
    options,
  );

  // No rating chain → nothing meaningful to score. Mirror the live
  // Inputs path's `chainHasOutputs` gate (which falls back to an echo
  // plan; a baseline echo would just mirror inputs, so we decline).
  const hasChain = projection.plan.nodes.some((n) => n.kind === "chain.mult");
  return hasChain ? projection : null;
}

/**
 * Legacy plan-only shape. Delegates to `snapshotBodyToProjection` and
 * DROPS the projection issues — kept only for the four replay
 * consumers (Analytics bridge, book re-rate, snapshot compare, the
 * scoring service's plan_id path) until the P2 G4/G5 steps teach each
 * to carry issues. New call sites must use `snapshotBodyToProjection`.
 */
export function snapshotBodyToRuntimePlan(
  body: Record<string, unknown>,
  options?: StagesToRuntimePlanOptions,
): Plan | null {
  return snapshotBodyToProjection(body, options)?.plan ?? null;
}
