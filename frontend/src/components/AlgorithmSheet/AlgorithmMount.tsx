/**
 * <AlgorithmMount> — Brief 70 §2 / Phase 3, rescoped by Brief 82 (the
 * rate build-up sheet's rate-lab glue).
 *
 * Brief 82 O-1 (owner, 2026-07-10) — the AMBIENT SAMPLE machinery is
 * DELETED, not moved: no synthesized risk, no browser-engine run, no
 * per-step dollars on the Rating tab. Run solely owns dollars (Law 1);
 * this mount now derives the sheet's PRODUCT LANGUAGE only:
 *   - picker items, factor-table meta (shape = count + range), dim
 *     display names — derived once from the plan's catalogs;
 *   - Final adjustments: projected from the plan's tail stages
 *     (modifier.schedule / endorsement.* / clamp / round / flat_factor);
 *     authoring callbacks pass through to the route's stage drawers —
 *     the tail writes via the STAGE API, never the tower diff;
 *   - Brief 78 P5.4 (D-F): the policy tail's ledger rows append after
 *     the stage rows.
 *
 * Brief 82 O-2 — every noun here comes from plan data (display names,
 * table names, input declarations). No line-of-business literals.
 */

import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  BuildUpSheet,
  formatTableCitation,
  levelsForKeying,
  type DimensionRow,
  type SheetAdjustment,
  type SheetFactorTableMeta,
  type SheetPickerItem,
  type TowerPlan,
} from "@openrater/ui";
import type { ChainRuntimeDefaults } from "../../integrations/chainRuntime";
import { stagesToInputDictEntries } from "../../integrations/inputDictStages";

/** Narrow stage shape the mount reads (the projected desired stages). */
export interface StageLikeForSheet {
  readonly stage_id: string;
  readonly stage_kind: string;
  readonly display_name: string;
  readonly config_json?: unknown;
}

interface FactorTableLike {
  readonly id: string;
  readonly display_name: string;
  readonly key_dimension?: string;
  readonly key_dimensions?: readonly string[];
  /** MVP-016 — the table's filed provenance, when the build carried it. */
  readonly source_page?: number | null;
  readonly source_pdf_url?: string | null;
}

export interface AlgorithmMountProps {
  readonly plan: TowerPlan;
  readonly onPlanChange: (next: TowerPlan) => void;
  readonly readOnly: boolean;
  /**
   * The DESIRED stages for the current edit (towerPlanToStages of the
   * edited plan, preserved sidecars included) — the tail ledger and
   * the input catalog read these, so edits reflect live.
   */
  readonly stages: readonly StageLikeForSheet[];
  readonly dimensions: readonly DimensionRow[];
  readonly factorTables: readonly FactorTableLike[];
  readonly factorTableCells?: ReadonlyMap<
    string,
    ReadonlyMap<string, string | number>
  >;
  /** Authoring defaults (the picker's LCM constant value). */
  readonly runtimeDefaults: ChainRuntimeDefaults;
  readonly onOpenFactorTable: (tableId: string) => void;
  /** Brief 89 R5 — the picker's CREATE rows (pass-through to the sheet). */
  readonly onCreateFactorTable?: (name: string, towerId: string) => void;
  readonly onDeclareInput?: (entry: {
    readonly fieldName: string;
    readonly displayName: string;
    readonly dtype: "float" | "string" | "bool";
  }) => void;
  /** Brief 82 R2 (D-B) — the in-row table editor (route owns cells). */
  readonly renderTableEditor?: (tableId: string) => ReactNode;
  /** Brief 82 R2 (F4) — the one-summoned-surface contract. */
  readonly onSummon?: () => void;
  readonly summonEpoch?: number;
  readonly onNavigateToDimensions: () => void;
  readonly onAddAdjustment?: (
    kind: "modifier" | "min_premium" | "endorsement" | "loading",
  ) => void;
  readonly onEditAdjustment?: (stageId: string) => void;
  readonly onDeleteAdjustment?: (stageId: string) => void;
  /**
   * Brief 78 P5.4 (D-F) — the plan's POLICY TAIL projected as ledger
   * rows (provenance "policy-tail"), appended after the stage rows
   * (the tail composes after per-risk stages). The route owns the
   * projection + the editor drawer these dispatch to.
   */
  readonly policyTailRows?: readonly SheetAdjustment[];
  readonly onOpenPolicyTail?: () => void;
  readonly onDeletePolicyTail?: (adjustmentId: string) => void;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
/** Mirror of the projector's literal parse: 500 / "500" / "literal:500".
 *  form_input.* paths → null (those aren't a plan-authored floor). */
function parseLiteralAmount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.trim().match(/^(?:literal:)?(-?\d+(?:\.\d+)?)$/);
    if (m) return parseFloat(m[1]!);
  }
  return null;
}

/** Project the plan's tail stages into Final-adjustments rows. */
function stagesToAdjustments(
  stages: readonly StageLikeForSheet[],
): SheetAdjustment[] {
  const out: SheetAdjustment[] = [];
  for (const stage of stages) {
    const cfg = asObject(stage.config_json);
    if (stage.stage_kind === "modifier.schedule") {
      const schedule = asObject(cfg["schedule"]);
      const cap =
        typeof schedule["total_cap_pct"] === "number"
          ? (schedule["total_cap_pct"] as number)
          : 0;
      out.push({
        provenance: "plan-stage",
        id: stage.stage_id,
        name: stage.display_name,
        sentence: cap
          ? `underwriter judgment, capped ±${cap}%`
          : "underwriter judgment schedule",
        kind: "modifier",
        ...(cap ? { meta: `± ${cap}%` } : {}),
        op: "×",
      });
      continue;
    }
    if (stage.stage_kind === "endorsement.factor") {
      const factor =
        typeof cfg["factor"] === "number" ? (cfg["factor"] as number) : null;
      out.push({
        provenance: "plan-stage",
        id: stage.stage_id,
        name: stage.display_name,
        sentence: "endorsement — multiplies the premium",
        kind: "endorsement",
        ...(factor !== null ? { meta: `× ${factor}` } : {}),
        op: "×",
      });
      continue;
    }
    if (stage.stage_kind === "endorsement.additive") {
      const amount =
        typeof cfg["amount"] === "number" ? (cfg["amount"] as number) : null;
      out.push({
        provenance: "plan-stage",
        id: stage.stage_id,
        name: stage.display_name,
        sentence: "endorsement — adds a flat amount",
        kind: "endorsement",
        ...(amount !== null
          ? { meta: `+ $${amount.toLocaleString("en-US")}` }
          : {}),
        op: "+",
      });
      continue;
    }
    if (
      stage.stage_kind === "endorsement.sublimit" ||
      stage.stage_kind === "endorsement.rate_branch"
    ) {
      out.push({
        provenance: "plan-stage",
        id: stage.stage_id,
        name: stage.display_name,
        sentence:
          stage.stage_kind === "endorsement.sublimit"
            ? "endorsement — caps a covered amount"
            : "endorsement — rates an embedded chain",
        kind: "endorsement",
      });
      continue;
    }
    if (stage.stage_kind === "clamp") {
      const min =
        typeof cfg["min_value"] === "number"
          ? (cfg["min_value"] as number)
          : null;
      const max =
        typeof cfg["max_value"] === "number"
          ? (cfg["max_value"] as number)
          : null;
      const parts: string[] = [];
      if (min !== null) parts.push(`never below $${min.toLocaleString("en-US")}`);
      if (max !== null) parts.push(`never above $${max.toLocaleString("en-US")}`);
      out.push({
        provenance: "plan-stage",
        id: stage.stage_id,
        name: stage.display_name,
        sentence: `${parts.join(" · ") || "premium floor/ceiling"} — bounds its target output`,
        kind: "min_premium",
        op: "floor",
      });
      continue;
    }
    if (stage.stage_kind === "round") {
      // The round stage's literal floor IS the plan's minimum premium
      // (max(total, floor) → round in the projector). Surface it.
      const floor = parseLiteralAmount(cfg["min_value_input"]);
      // literal:0 is the persisted "no floor" (RoundConfig requires the
      // field) — render it as a plain rounding step.
      if (floor !== null && floor > 0) {
        out.push({
          provenance: "plan-stage",
          id: stage.stage_id,
          name: stage.display_name,
          sentence: `never below $${floor.toLocaleString("en-US")} · rounds the premium`,
          kind: "min_premium",
          meta: `$${floor.toLocaleString("en-US")} floor`,
          op: "floor",
        });
      } else {
        out.push({
          provenance: "plan-stage",
          id: stage.stage_id,
          name: stage.display_name,
          sentence: "rounds the premium",
          kind: "loading",
        });
      }
      continue;
    }
    if (stage.stage_kind === "flat_factor") {
      const factor =
        typeof cfg["factor"] === "number" ? (cfg["factor"] as number) : null;
      out.push({
        provenance: "plan-stage",
        id: stage.stage_id,
        name: stage.display_name,
        sentence: "flat loading — multiplies the premium",
        kind: "loading",
        ...(factor !== null ? { meta: `× ${factor}` } : {}),
        op: "×",
      });
    }
  }
  return out;
}

export function AlgorithmMount(props: AlgorithmMountProps): ReactNode {
  const {
    plan,
    onPlanChange,
    readOnly,
    stages,
    dimensions,
    factorTables,
    factorTableCells,
    runtimeDefaults,
    onOpenFactorTable,
    onCreateFactorTable,
    onDeclareInput,
    renderTableEditor,
    onSummon,
    summonEpoch,
    onNavigateToDimensions,
    onAddAdjustment,
    onEditAdjustment,
    onDeleteAdjustment,
    policyTailRows,
    onOpenPolicyTail,
    onDeletePolicyTail,
  } = props;

  // ── Product language ───────────────────────────────────────────────
  const dimDisplayNames = useMemo(
    () =>
      new Map(
        dimensions.flatMap((d) => {
          const pairs: [string, string][] = [[d.slug, d.display_name]];
          if (d.id !== d.slug) pairs.push([d.id, d.display_name]);
          return pairs;
        }),
      ),
    [dimensions],
  );

  // Brief 82 D-E — the Value column's shape ("18 values · 0.65–1")
  // reads count + range from the authored cells: the table's identity,
  // not a computation.
  const factorTableMeta = useMemo(() => {
    const map = new Map<string, SheetFactorTableMeta>();
    for (const ft of factorTables) {
      const keyDims =
        ft.key_dimensions ?? (ft.key_dimension ? [ft.key_dimension] : []);
      const cells = factorTableCells?.get(ft.id);
      const values = cells
        ? [...cells.values()]
            .map((v) => (typeof v === "number" ? v : Number(v)))
            .filter((n) => Number.isFinite(n))
        : [];
      const citation = formatTableCitation(ft);
      map.set(ft.id, {
        title: ft.display_name,
        keyDims,
        ...(citation !== null ? { citation } : {}),
        ...(values.length > 0
          ? {
              count: values.length,
              range: `${Math.min(...values).toFixed(2)}–${Math.max(
                ...values,
              ).toFixed(2)}`,
            }
          : {}),
      });
    }
    return map;
  }, [factorTables, factorTableCells]);

  const pickerItems = useMemo<SheetPickerItem[]>(() => {
    const items: SheetPickerItem[] = [];
    for (const ft of factorTables) {
      const meta = factorTableMeta.get(ft.id);
      const keyed =
        meta && meta.keyDims.length > 0
          ? `keyed by ${meta.keyDims
              .map((k) => dimDisplayNames.get(k) ?? k)
              .join(" and ")}`
          : "factor lookup";
      items.push({
        id: `ft:${ft.id}`,
        kind: "factor-table",
        title: ft.display_name,
        sentence: keyed,
        ...(meta?.range !== undefined ? { range: meta.range } : {}),
        tableId: ft.id,
      });
    }
    // Carrier constants — typed at the door (Brief 70.1: persistence
    // keys on the role, never the display name).
    items.push({
      id: "const:LCM",
      kind: "constant",
      title: "Carrier LCM",
      sentence: "loss-cost multiplier — applies after the 3-dp rate round",
      constantId: "LCM",
      constantValue: runtimeDefaults.lcm,
      constantRole: "lcm",
    });
    items.push({
      id: "const:FLAT",
      kind: "constant",
      title: "Flat factor",
      sentence: "a fixed multiplier, e.g. 1.05",
      constantId: "FLAT",
      constantValue: 1.0,
    });
    for (const entry of stagesToInputDictEntries(
      stages as unknown as Parameters<typeof stagesToInputDictEntries>[0],
    )) {
      items.push({
        id: `input:${entry.fieldName}`,
        kind: "input",
        title: entry.displayName || entry.fieldName,
        sentence: "from the submission",
        field: entry.fieldName,
        dtype: entry.dataType,
      });
    }
    return items;
  }, [
    factorTables,
    factorTableMeta,
    dimDisplayNames,
    runtimeDefaults.lcm,
    stages,
  ]);

  // ── Structure ──────────────────────────────────────────────────────
  const spawnDims = useMemo(
    () =>
      dimensions.filter(
        (d) =>
          (d.role === "structural" || d.role === "both") &&
          levelsForKeying(d).length > 0,
      ),
    [dimensions],
  );

  // Brief 78 P5.4 (D-F) — ONE tail ledger: plan-stage rows first
  // (they apply per risk), then the policy tail (it composes per
  // policy, after aggregation).
  const finalAdjustments = useMemo(
    () => [...stagesToAdjustments(stages), ...(policyTailRows ?? [])],
    [stages, policyTailRows],
  );

  return (
    <BuildUpSheet
      plan={plan}
      onPlanChange={onPlanChange}
      readOnly={readOnly}
      dimDisplayNames={dimDisplayNames}
      factorTableMeta={factorTableMeta}
      pickerItems={pickerItems}
      {...(onCreateFactorTable !== undefined ? { onCreateFactorTable } : {})}
      {...(onDeclareInput !== undefined ? { onDeclareInput } : {})}
      {...(renderTableEditor !== undefined ? { renderTableEditor } : {})}
      {...(onSummon !== undefined ? { onSummon } : {})}
      {...(summonEpoch !== undefined ? { summonEpoch } : {})}
      spawnDims={spawnDims}
      onNavigateToDimensions={onNavigateToDimensions}
      onOpenFactorTable={onOpenFactorTable}
      finalAdjustments={finalAdjustments}
      {...(onAddAdjustment !== undefined ? { onAddAdjustment } : {})}
      {...(onEditAdjustment !== undefined ? { onEditAdjustment } : {})}
      {...(onDeleteAdjustment !== undefined ? { onDeleteAdjustment } : {})}
      {...(onOpenPolicyTail !== undefined ? { onOpenPolicyTail } : {})}
      {...(onDeletePolicyTail !== undefined ? { onDeletePolicyTail } : {})}
    />
  );
}
