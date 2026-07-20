/**
 * <BuildUpSheet> — Brief 70 §2, rescoped by Brief 82 (the algorithm
 * as a one-column filing exhibit).
 *
 * The algorithm IS the filing exhibit: a vertical, numbered worksheet
 * per coverage — base rate × factor × factor — reading top to bottom
 * in plan-domain words. It reads and writes the SAME TowerPlan
 * projection the canvas did (zero contract change): every edit is a
 * `plan-mutations` helper folded through `onPlanChange`, and the
 * consumer's existing autosave reverse-projects via towerPlanToStages.
 *
 * Brief 82 O-1 — NO sample-risk testing here:
 * the ambient sample, its editor, the browser-engine run, and the
 * running column are gone. The sheet shows AUTHORED truth only — a
 * scalar step shows its value, a table step shows its shape
 * ("18 values · 0.65–1"). Run solely owns dollars (Law 1). What was
 * the floating inspector is now an in-place row editor: select a
 * step and it opens under the row (Brief 82 D-B, R1 form).
 *
 * Brief 82 O-2 — plan-agnostic by construction: every visible noun
 * (coverage names, exposure sentences, dimension words, predicates)
 * arrives via props derived from plan data. No line-of-business
 * string literal ships in this component.
 *
 * Honesty + authoring constraints that carry (Brief 68/70, binding):
 *   - Never fabricate a number; shapes are the table's identity.
 *   - Final adjustments author via the STAGE API, not the tower diff.
 *   - Chains carrying `exposure_options` round-trip losslessly via
 *     `Tower.chainVerbatim` (Brief 78 P5.3c).
 *   - Legacy `group` entries render collapsed (the fold refuses them).
 *   - NO model steps in the picker — models are tail artifacts.
 *   - Max TWO submission-field steps per chain; the picker refuses a
 *     third with the reason, it never discards.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  Maximize2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button, IconButton, SearchField, Segmented } from "@openrater/design-system";
import {
  OrderedSheet,
  OrderedSheetStaticRow,
} from "../OrderedSheet";
import { ImpactDeletePrompt } from "../ImpactDeletePrompt";
import { DimToken, countLabel, shapeOf } from "../dimensionMeta";
import type { DimensionRow } from "../DimensionsTable";
import { levelsForKeying } from "../keying";
import { resolveIcon } from "../CalculationTower/icons";
import type {
  Operator,
  Tower,
  TowerNode,
  TowerPlan,
} from "../CalculationTower/types";
import {
  addEmptyTower,
  addTotalTower,
  deleteNodeById,
  duplicateNode,
  getPerLevelTowers,
  insertNodeAtEnd,
  isTotalTower,
  matchCoverageLevel,
  removeTotalTower,
  renameNode,
  setChainBaseValue,
  setConstantValue,
  setFactorPredicate,
  setTowerExposure,
  shouldShowTotalTower,
  spawnTowersFromDim,
} from "../CalculationTower/plan-mutations";
import "./BuildUpSheet.css";

// ── Public types ────────────────────────────────────────────────────

/** One pickable step. The consumer pre-derives the product language. */
export interface SheetPickerItem {
  readonly id: string;
  readonly kind: "factor-table" | "constant" | "input";
  readonly title: string;
  /** The binding sentence ("keyed by Construction class"). */
  readonly sentence?: string;
  /** Right-aligned value range ("0.85–1.45") for factor tables. */
  readonly range?: string;
  /** Lucide icon name override. */
  readonly icon?: string;
  // kind-specific identities
  readonly tableId?: string;
  readonly field?: string;
  readonly dtype?: string;
  readonly constantId?: string;
  readonly constantValue?: number;
  readonly constantRole?: "lcm" | "flat" | "min_premium";
}

/**
 * A Final-adjustments tail row. Brief 78 P5.4 (D-F): ONE ledger for
 * both tail substrates — plan STAGES (stage API) and the plan's
 * POLICY TAIL (`plan_policy_tail`, composed per policy after
 * aggregation) — each row honest about which one it writes.
 */
export interface SheetAdjustment {
  readonly id: string;
  readonly name: string;
  readonly sentence: string;
  readonly kind: "modifier" | "endorsement" | "min_premium" | "loading";
  /** Factor-column text ("± 25%", "$500 floor", "+ 0.05"). */
  readonly meta?: string;
  /** Fold glyph — "+" where the fold is additive (Brief 70 §5). */
  readonly op?: "×" | "+" | "floor";
  /**
   * Which substrate the row writes (renders as a small tag). Rows
   * without it are plan stages (back-compat). Policy-tail rows
   * dispatch edit/delete through onOpenPolicyTail/onDeletePolicyTail.
   */
  readonly provenance?: "plan-stage" | "policy-tail";
}

export interface SheetFactorTableMeta {
  readonly title: string;
  readonly keyDims: readonly string[];
  readonly range?: string;
  /** Authored cell count — the shape column reads "N values · range". */
  readonly count?: number;
  /**  — "cited p. 6 — Rule C.5", from the table's provenance. */
  readonly citation?: string | undefined;
}

export interface BuildUpSheetProps {
  readonly plan: TowerPlan;
  /** Omit (with readOnly) to render the sheet inspect-only. */
  readonly onPlanChange?: (next: TowerPlan) => void;
  readonly readOnly?: boolean;

  /** slug → display name (binding sentences speak product words). */
  readonly dimDisplayNames?: ReadonlyMap<string, string>;
  /** tableId → axis/shape meta (binding sentences + the Value column). */
  readonly factorTableMeta?: ReadonlyMap<string, SheetFactorTableMeta>;

  /** The add-step picker's catalog (NO models — by construction). */
  readonly pickerItems?: readonly SheetPickerItem[];

  /**
   * Brief 89 R5 — the picker finishes the author's sentence instead of
   * refusing it: on a no-match query, a CREATE group offers "Factor
   * table …" (fires this with the typed name + the tower awaiting the
   * step — the consumer opens the rate-by flow and inserts the
   * referencing step on completion) and "Input …" (the sheet inserts
   * the input-driven step itself and fires onDeclareInput so the
   * dictionary gains the declared row). Absent ⇒ the old full stop.
   */
  readonly onCreateFactorTable?: (name: string, towerId: string) => void;
  readonly onDeclareInput?: (entry: {
    readonly fieldName: string;
    readonly displayName: string;
    readonly dtype: "float" | "string" | "bool";
  }) => void;

  /**
   * Brief 82 R2 (D-B) — the inline grid: the consumer renders the
   * table editor INSIDE the expanded row (it owns cells + the
   * write-through; the sheet owns the container). Absent → the row
   * editor offers "Full screen" only.
   */
  readonly renderTableEditor?: (tableId: string) => ReactNode;
  /**
   * Brief 82 R2 (F4) — the one-summoned-surface contract. Fires when
   * the sheet summons any of its surfaces (row editor, picker,
   * exposure, add-coverage) so the consumer can dismiss ITS surfaces
   * (the Tables menu).
   */
  readonly onSummon?: () => void;
  /** Bump to dismiss every sheet surface (the consumer summoned one). */
  readonly summonEpoch?: number;

  /** Structural dims offered by the empty-state coverage split. */
  readonly spawnDims?: readonly DimensionRow[];
  readonly onNavigateToDimensions?: () => void;
  readonly onOpenFactorTable?: (tableId: string) => void;

  // Final adjustments (stage API).
  readonly finalAdjustments?: readonly SheetAdjustment[];
  /**
   * Brief 78 P5.3 — the tail's four create verbs: IRPM schedule,
   * endorsement (G16 — the create path restored), flat loading
   * (§3.3-4), minimum premium (the G6 round floor).
   */
  readonly onAddAdjustment?: (
    kind: "modifier" | "min_premium" | "endorsement" | "loading",
  ) => void;
  /**
   * Brief 78 P5.4 (D-F) — opens the policy-tail editor (the whole
   * ordered tail: IRPM source binding, package factors, policy
   * endorsements, policy floor). Clicking a policy-tail ROW opens it
   * too. When present, the tail menu shows the "Policy tail" entry.
   */
  readonly onOpenPolicyTail?: () => void;
  /** Deletes ONE policy-tail adjustment (armed via the same prompt). */
  readonly onDeletePolicyTail?: (adjustmentId: string) => void;
  readonly onEditAdjustment?: (id: string) => void;
  readonly onDeleteAdjustment?: (id: string) => void;
  readonly testId?: string;
}

// ── The summoned-surface state (Brief 82 R2, the F4 rule) ───────────

/** Exactly ONE of these may be open at a time. */
type SummonedSurface =
  | { readonly kind: "row"; readonly towerId: string; readonly nodeId: string }
  | { readonly kind: "picker"; readonly towerId: string }
  | { readonly kind: "exposure"; readonly towerId: string }
  | { readonly kind: "add-coverage" }
  | { readonly kind: "add-adjustment" };

function sameSummon(
  cur: SummonedSurface | null,
  next: SummonedSurface,
): boolean {
  if (cur === null || cur.kind !== next.kind) return false;
  if (cur.kind === "row" && next.kind === "row") {
    return cur.nodeId === next.nodeId;
  }
  if (cur.kind === "add-coverage" || cur.kind === "add-adjustment") {
    return true;
  }
  return (
    (cur as { towerId: string }).towerId ===
    (next as { towerId: string }).towerId
  );
}

// ── Formatting ──────────────────────────────────────────────────────

function slugifyOutputField(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${slug || "coverage"}_premium`;
}

/**
 * F08 — the coverage display name is "<name> premium", but only when the user's
 * input doesn't already end in "premium". Typing "Liability premium" used to
 * yield "Liability premium premium".
 */
function coverageDisplayName(raw: string): string {
  const trimmed = raw.trim();
  return /\bpremium$/i.test(trimmed) ? trimmed : `${trimmed} premium`;
}

// ── Node helpers ────────────────────────────────────────────────────

function nodeIdsOfTower(tower: Tower): readonly string[] {
  return tower.entries.flatMap((e) =>
    e.kind === "node" ? [e.nodeId] : e.kind === "group" ? [e.groupId] : [],
  );
}

function isOutputEntry(
  plan: TowerPlan,
  entry: Tower["entries"][number],
): boolean {
  return (
    entry.kind === "node" &&
    plan.nodes.get(entry.nodeId)?.category === "output"
  );
}

function isBaseNode(node: TowerNode | undefined): boolean {
  return node?.ref?.kind === "chain-base";
}

/** Steps that deserve an armed delete (the chain's math changes). */
function isLoadBearingStep(node: TowerNode): boolean {
  const kind = node.ref?.kind;
  return (
    kind === "factor-table" ||
    kind === "curve" ||
    kind === "model" ||
    kind === "chain-base" ||
    (kind === "constant" && node.ref?.role === "lcm")
  );
}

/** Brief 89 R5 — a typed name becomes a field slug at the door. */
function slugifyFieldName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Build a TowerNode from a picker item — the full ref, typed at the door.
 *  Exported (Brief 89 R5): the consumer builds the same node when a
 *  picker-created factor table lands and the referencing step inserts. */
export function pickerItemToNode(
  item: SheetPickerItem,
  nodes: ReadonlyMap<string, TowerNode>,
): TowerNode {
  let n = 0;
  const mint = (seed: string): string => {
    let id = seed;
    while (nodes.has(id)) {
      n += 1;
      id = `${seed}_${n}`;
    }
    return id;
  };
  if (item.kind === "factor-table") {
    const tableId = item.tableId ?? item.id;
    return {
      id: mint(`n_ft_${tableId}`),
      category: "lookup",
      subtype: "table",
      title: item.title,
      subtitle: item.sentence ?? "Factor lookup",
      valueChip: {
        primary: item.range ?? "factor",
        ...(item.sentence !== undefined ? { secondary: item.sentence } : {}),
      },
      icon: item.icon ?? "List",
      ref: { kind: "factor-table", tableId },
    };
  }
  if (item.kind === "constant") {
    const constantId = item.constantId ?? item.id;
    return {
      id: mint(`n_const_${constantId}`),
      category: "math",
      subtype: "constant",
      title: item.title,
      subtitle: "Constant · carrier-set",
      valueChip: {
        primary:
          item.constantValue !== undefined
            ? String(item.constantValue)
            : "scalar",
        secondary: "carrier-set",
      },
      icon: item.icon ?? "Target",
      ref: {
        kind: "constant",
        constantId,
        ...(item.constantRole !== undefined ? { role: item.constantRole } : {}),
        value: item.constantValue ?? null,
      },
    };
  }
  const field = item.field ?? item.id;
  return {
    id: mint(`n_inp_${field}`),
    category: "input",
    title: item.title,
    subtitle: "Submission input · from policy form",
    valueChip: {
      primary: item.dtype ?? "value",
      secondary: "from submission",
    },
    icon: item.icon ?? "FileInput",
    ref: { kind: "submission-field", field },
  };
}

// ── The component ───────────────────────────────────────────────────

export function BuildUpSheet(props: BuildUpSheetProps): JSX.Element {
  const {
    plan,
    onPlanChange,
    readOnly = false,
    dimDisplayNames,
    factorTableMeta,
    pickerItems = [],
    onCreateFactorTable,
    onDeclareInput,
    renderTableEditor,
    onSummon,
    summonEpoch,
    spawnDims = [],
    onNavigateToDimensions,
    onOpenFactorTable,
    finalAdjustments = [],
    onAddAdjustment,
    onEditAdjustment,
    onDeleteAdjustment,
    onOpenPolicyTail,
    onDeletePolicyTail,
    testId = "rater-buildup-sheet",
  } = props;

  const writable = !readOnly && onPlanChange !== undefined;
  const commit = useCallback(
    (next: TowerPlan) => {
      onPlanChange?.(next);
    },
    [onPlanChange],
  );

  const perLevelTowers = useMemo(() => getPerLevelTowers(plan), [plan]);
  const totalTower = useMemo(
    () => plan.towers.find((t) => isTotalTower(t)) ?? null,
    [plan],
  );

  // The Total tower normalization the canvas used to own: the substrate
  // total must exist exactly when 2+ coverages do (read-only plans are
  // never normalized — Brief: the read-only autosave storm).
  useEffect(() => {
    if (!writable) return;
    const should = shouldShowTotalTower(plan);
    const has = totalTower !== null;
    if (should && !has) commit(addTotalTower(plan));
    else if (!should && has) commit(removeTotalTower(plan));
  }, [writable, plan, totalTower, commit]);

  // ── The ONE summoned surface (Brief 82 R2, F4) ────────────────────
  // Row editor, add-step picker, exposure popover, add-coverage —
  // mutually exclusive by construction: one state cell holds whichever
  // is open. Esc always returns to the reading state.
  const [summoned, setSummoned] = useState<SummonedSurface | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  // Brief 89 R5 — the CREATE group's inline type pick (Input "…").
  const [createDtype, setCreateDtype] = useState<"float" | "string" | "bool">(
    "float",
  );
  const [addCoverageName, setAddCoverageName] = useState("");

  const dismiss = useCallback(() => {
    setSummoned(null);
    setPickerQuery("");
    setCreateDtype("float");
  }, []);

  /** Toggle a surface: summoning it again closes it; summoning a
   *  different one replaces it (and tells the consumer via onSummon). */
  const toggleSummon = useCallback(
    (next: SummonedSurface) => {
      const same = sameSummon(summoned, next);
      setSummoned(same ? null : next);
      setPickerQuery("");
      if (!same) onSummon?.();
    },
    [summoned, onSummon],
  );

  // The consumer summoned one of ITS surfaces → every sheet surface
  // dismisses (the other half of the one-surface contract).
  useEffect(() => {
    if (summonEpoch !== undefined) dismiss();
  }, [summonEpoch, dismiss]);

  // A summoned row whose node was deleted dismisses.
  useEffect(() => {
    if (summoned?.kind === "row" && !plan.nodes.has(summoned.nodeId)) {
      setSummoned(null);
    }
  }, [plan, summoned]);

  // Light dismissal: Escape closes whatever is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  // Reading-state derivations (which surface, if any, is open).
  const selectedRow = summoned?.kind === "row" ? summoned : null;
  const pickerFor = summoned?.kind === "picker" ? summoned.towerId : null;
  const exposureFor =
    summoned?.kind === "exposure" ? summoned.towerId : null;
  const addCoverageOpen = summoned?.kind === "add-coverage";
  const addAdjustmentOpen = summoned?.kind === "add-adjustment";

  // ── Inline scalar editing (base rate + constants) ─────────────────
  const [inlineEdit, setInlineEdit] = useState<{
    nodeId: string;
    draft: string;
  } | null>(null);
  const commitInline = useCallback(
    (node: TowerNode, raw: string) => {
      setInlineEdit(null);
      const n = Number(raw.replace(/[$,\s]/g, ""));
      const value = Number.isFinite(n) ? n : null;
      if (node.ref?.kind === "chain-base") {
        commit(setChainBaseValue(plan, node.id, value));
      } else if (node.ref?.kind === "constant") {
        commit(setConstantValue(plan, node.id, value));
      }
    },
    [plan, commit],
  );

  // ── Armed deletes ─────────────────────────────────────────────────
  const [pendingDelete, setPendingDelete] = useState<{
    towerId: string;
    node: TowerNode;
  } | null>(null);
  const [pendingTowerDelete, setPendingTowerDelete] = useState<Tower | null>(
    null,
  );
  const [pendingFaDelete, setPendingFaDelete] =
    useState<SheetAdjustment | null>(null);

  const deleteStep = useCallback(
    (towerId: string, node: TowerNode) => {
      if (isLoadBearingStep(node)) {
        setPendingDelete({ towerId, node });
        return;
      }
      commit(deleteNodeById(plan, node.id));
    },
    [plan, commit],
  );

  // ── Sentences (product words, derived once) ───────────────────────
  const dimLabel = useCallback(
    (slug: string): string => dimDisplayNames?.get(slug) ?? slug,
    [dimDisplayNames],
  );

  // Brief 82 R3 (D-H / O-2) — input fields render by their DECLARED
  // display name; an undeclared field humanizes (no snake_case on the
  // reading surface, ever).
  const inputLabel = useCallback(
    (field: string): string => {
      const declared = pickerItems.find(
        (i) => i.kind === "input" && (i.field ?? i.id) === field,
      )?.title;
      if (declared && declared !== field) return declared;
      return field.replace(/_/g, " ");
    },
    [pickerItems],
  );

  const bindingSentence = useCallback(
    (node: TowerNode): { text: string; chips: string[] } => {
      const ref = node.ref;
      const chips: string[] = [];
      if (ref?.kind === "factor-table") {
        const meta = factorTableMeta?.get(ref.tableId);
        const keyed =
          meta && meta.keyDims.length > 0
            ? `keyed by ${meta.keyDims.map(dimLabel).join(" and ")}`
            : "factor lookup";
        if (ref.predicate) {
          // P2 G7-full (ADR-0056) — every predicate shape gates at
          // score time now (boolean input, numeric eq, string 1/0
          // membership, incl. dual-input tables). The v4-G6
          // "(not yet priced)" qualifier came off with the fix.
          // R3 (D-H) — the field speaks its display name.
          chips.push(
            `applies when ${inputLabel(
              ref.predicate.path.replace(/^form_input\./, ""),
            )} is ${String(ref.predicate.equals)}`,
          );
        }
        for (const [axis, src] of Object.entries(ref.axisSources ?? {})) {
          if (src.source === "literal") {
            chips.push(`${dimLabel(axis)} = ${String(src.value)}`);
          } else if (src.source === "computed") {
            chips.push(`${dimLabel(axis)} = sum of ${src.fields.length} fields`);
          } else if (src.source === "derived") {
            chips.push(`${dimLabel(axis)} from ${dimLabel(src.path)}`);
          }
        }
        return { text: keyed, chips };
      }
      if (ref?.kind === "constant") {
        return {
          text:
            ref.role === "lcm"
              ? "carrier loss-cost multiplier"
              : "fixed multiplier",
          chips,
        };
      }
      if (ref?.kind === "submission-field") {
        return {
          text: `reads ${inputLabel(ref.field)} from the submission`,
          chips,
        };
      }
      if (ref?.kind === "dimension") {
        return { text: `looks up ${dimLabel(ref.dimensionId)}`, chips };
      }
      return { text: node.subtitle ?? "", chips };
    },
    [factorTableMeta, dimLabel, inputLabel, plan.ratingDimension],
  );

  //  — a lookup step's title is the TABLE's display name when
  // the node's own title is just the identifier re-dressed (the
  // workbook path writes the slug into the description head). An
  // authored title that says something the id doesn't is kept.
  const nodeDisplayTitle = useCallback(
    (node: TowerNode): string => {
      const ref = node.ref;
      if (ref?.kind !== "factor-table") return node.title;
      const catalog = factorTableMeta?.get(ref.tableId)?.title?.trim();
      if (!catalog) return node.title;
      const identifierShaped =
        node.title.trim().toLowerCase().replace(/ /g, "_") ===
        ref.tableId.toLowerCase();
      return identifierShaped ? catalog : node.title;
    },
    [factorTableMeta],
  );

  const exposureSentence = useCallback(
    (tower: Tower): string => {
      // Brief 78 P5.3c (§3.3-2) — a class-conditional coverage names
      // its real mode instead of mislabeling one option as THE base.
      if ((tower.exposureOptionCount ?? 0) > 0) {
        return `Exposure varies by class · ${tower.exposureOptionCount} option${
          tower.exposureOptionCount === 1 ? "" : "s"
        }`;
      }
      if (!tower.exposureInput) return "Flat — no exposure base";
      const divisor = tower.exposureUnitDivisor ?? 100;
      // R3 (D-H) — the exposure base speaks its display name.
      return `Rated per $${divisor.toLocaleString("en-US")} of ${inputLabel(
        tower.exposureInput,
      )}`;
    },
    [inputLabel],
  );

  // ── Picker (add step) ─────────────────────────────────────────────
  const pickStep = useCallback(
    (towerId: string, item: SheetPickerItem) => {
      const node = pickerItemToNode(item, plan.nodes);
      commit(insertNodeAtEnd(plan, towerId, node));
      dismiss();
    },
    [plan, commit, dismiss],
  );

  // ── Renders ───────────────────────────────────────────────────────

  /**
   * One step row's grid content (body · value). Brief 82 D-E: the
   * Value column tells the AUTHORED truth — a scalar step shows its
   * value (editable in place), a table step shows its shape. No
   * computed number renders here (O-1); Run owns dollars.
   */
  const renderStepContent = (
    tower: Tower,
    node: TowerNode,
    towerWritable: boolean,
  ): ReactNode => {
    const isBase = isBaseNode(node);
    const { text, chips } = bindingSentence(node);
    //  — steps lead with the table's display name; the slug
    // demotes into the binding sentence. A hand-retitled step keeps
    // its author's words (only an identifier-shaped title yields).
    const displayTitle = nodeDisplayTitle(node);
    const bindText =
      node.ref?.kind === "factor-table" &&
      displayTitle !== node.ref.tableId
        ? `${node.ref.tableId} · ${text}`
        : text;
    const scalarRef =
      node.ref?.kind === "chain-base"
        ? { value: node.ref.baseValue, kind: "base" as const }
        : node.ref?.kind === "constant" && node.ref.value !== undefined
          ? { value: node.ref.value, kind: "constant" as const }
          : null;
    const editingThis = inlineEdit?.nodeId === node.id;

    const inlineVal =
      scalarRef !== null ? (
        editingThis && towerWritable ? (
          <input
            className="rater-buildup__inline-input"
            value={inlineEdit.draft}
            autoFocus
            aria-label={`${node.title} value`}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setInlineEdit({ nodeId: node.id, draft: e.target.value })
            }
            onBlur={() => commitInline(node, inlineEdit.draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitInline(node, inlineEdit.draft);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setInlineEdit(null);
              }
            }}
            data-testid={`${testId}-inline-${node.id}`}
          />
        ) : (
          <button
            type="button"
            className="rater-buildup__inline-val"
            disabled={!towerWritable}
            onClick={(e) => {
              e.stopPropagation();
              if (!towerWritable) return;
              setInlineEdit({
                nodeId: node.id,
                draft:
                  scalarRef.value !== null && scalarRef.value !== undefined
                    ? String(scalarRef.value)
                    : "",
              });
            }}
            data-testid={`${testId}-inline-open-${node.id}`}
          >
            {scalarRef.value !== null && scalarRef.value !== undefined
              ? scalarRef.kind === "base"
                ? `$${scalarRef.value.toFixed(3)}`
                : scalarRef.value.toFixed(3)
              : "set a value"}
          </button>
        )
      ) : null;

    // The Value column (Brief 82 D-E): authored scalar (editable) for
    // base/constant steps; the table's SHAPE for lookups; the node's
    // own chip for everything else. Never a computed number.
    // R3 (Law 2, structural): a lookup whose table left the catalog
    // REFUSES with a named chip — the footer's readiness verdict
    // already withholds "Ready to rate" while any exist.
    let valueCol: ReactNode;
    if (scalarRef !== null) {
      valueCol = inlineVal;
    } else if (node.ref?.kind === "factor-table") {
      const meta = factorTableMeta?.get(node.ref.tableId);
      if (factorTableMeta !== undefined && meta === undefined) {
        valueCol = (
          <span
            className="rater-buildup__blockchip"
            data-testid={`${testId}-blocked-${node.id}`}
          >
            references a deleted table
          </span>
        );
      } else {
        const shape =
          meta?.count !== undefined && meta.count > 0
            ? `${meta.count} value${meta.count === 1 ? "" : "s"}${
                meta.range !== undefined ? ` · ${meta.range}` : ""
              }`
            : (meta?.range ?? node.valueChip.primary);
        valueCol = <span className="rater-buildup__meta">{shape}</span>;
      }
    } else {
      valueCol = (
        <span className="rater-buildup__meta">{node.valueChip.primary}</span>
      );
    }

    const isSelected = selectedRow?.nodeId === node.id;
    return (
      <div className="rater-buildup__step">
        <div className="rater-buildup__step-body">
          <div className="rater-buildup__step-name">{displayTitle}</div>
          <div className="rater-buildup__step-bind">
            {isBase ? (
              scalarRef?.value == null && !editingThis ? (
                <span className="rater-buildup__bind-prompt">
                  Set a base rate to price this coverage.
                </span>
              ) : (
                <span>
                  {tower.exposureInput
                    ? `per $${(tower.exposureUnitDivisor ?? 100).toLocaleString("en-US")} of ${inputLabel(tower.exposureInput)}`
                    : "the chain's starting rate"}
                </span>
              )
            ) : (
              <>
                <span>{bindText}</span>
                {chips.map((c) => (
                  <span key={c} className="rater-buildup__wirechip">
                    {c}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
        <span className="rater-buildup__col-value">{valueCol}</span>
        {/* Brief 82 D-B (R1 form) — the selected step's editor opens
            IN PLACE under the row: what the floating inspector held
            (rename · predicate · value · duplicate · delete), without
            a pane. R2 grows this into the inline grid editor. */}
        {isSelected ? renderRowEdit(tower, node) : null}
      </div>
    );
  };

  const renderGroupRow = (groupId: string): ReactNode => {
    const group = plan.groups.get(groupId);
    return (
      <div className="rater-buildup__step">
        <div className="rater-buildup__step-body">
          <div className="rater-buildup__step-name">
            {group?.name ?? "Grouped steps"}
          </div>
          <div className="rater-buildup__step-bind">
            legacy group · {group?.nodeIds.length ?? 0} steps inside
          </div>
        </div>
        <span className="rater-buildup__col-value">
          <span className="rater-buildup__meta">not folded</span>
        </span>
      </div>
    );
  };

  /** The add-step picker popover, anchored under a coverage's add row. */
  const renderPicker = (tower: Tower): ReactNode => {
    if (pickerFor !== tower.id) return null;
    const q = pickerQuery.trim().toLowerCase();
    const match = (i: SheetPickerItem): boolean =>
      q === "" ||
      i.title.toLowerCase().includes(q) ||
      (i.sentence ?? "").toLowerCase().includes(q);
    const tables = pickerItems.filter(
      (i) => i.kind === "factor-table" && match(i),
    );
    const constants = pickerItems.filter(
      (i) => i.kind === "constant" && match(i),
    );
    const inputs = pickerItems.filter((i) => i.kind === "input" && match(i));
    const submissionCount = nodeIdsOfTower(tower).filter(
      (id) => plan.nodes.get(id)?.ref?.kind === "submission-field",
    ).length;
    const inputsBlocked = submissionCount >= 2;

    const renderRows = (
      items: readonly SheetPickerItem[],
      blocked: boolean,
    ): ReactNode =>
      items.map((item) => {
        const Icon = resolveIcon(
          item.icon ??
            (item.kind === "factor-table"
              ? "List"
              : item.kind === "constant"
                ? "Target"
                : "FileInput"),
        );
        return (
          <button
            key={item.id}
            type="button"
            className="rater-buildup__pick-row"
            disabled={blocked}
            onClick={() => pickStep(tower.id, item)}
            data-testid={`${testId}-pick-${item.id}`}
          >
            <span
              className={`rater-buildup__tile rater-buildup__tile--${
                item.kind === "factor-table"
                  ? "lookup"
                  : item.kind === "constant"
                    ? "math"
                    : "input"
              }`}
              aria-hidden
            >
              <Icon size={14} strokeWidth={1.8} />
            </span>
            <span className="rater-buildup__pick-body">
              <span className="rater-buildup__pick-name">{item.title}</span>
              {item.sentence ? (
                <span className="rater-buildup__pick-sentence">
                  {item.sentence}
                </span>
              ) : null}
            </span>
            {item.range ? (
              <span className="rater-buildup__pick-range">{item.range}</span>
            ) : null}
          </button>
        );
      });

    return (
      <div
        className="rater-buildup__picker"
        role="dialog"
        aria-label="Add a step"
        data-testid={`${testId}-picker`}
      >
        <SearchField
          value={pickerQuery}
          onChange={setPickerQuery}
          placeholder="Search factor tables, constants, inputs…"
          size="sm"
          aria-label="Search steps"
          autoFocus
        />
        {tables.length > 0 ? (
          <>
            <div className="rater-buildup__pick-group">Factor tables</div>
            {renderRows(tables, false)}
          </>
        ) : null}
        {constants.length > 0 ? (
          <>
            <div className="rater-buildup__pick-group">Constants</div>
            {renderRows(constants, false)}
          </>
        ) : null}
        {inputs.length > 0 ? (
          <>
            <div className="rater-buildup__pick-group">Inputs</div>
            {inputsBlocked ? (
              <p
                className="rater-buildup__pick-refuse"
                data-testid={`${testId}-pick-input-cap`}
              >
                This chain already reads two submission fields — the base and
                the exposure. A third doesn't apply to a multiplicative
                chain.
              </p>
            ) : null}
            {renderRows(inputs, inputsBlocked)}
          </>
        ) : null}
        {tables.length + constants.length + inputs.length === 0
          ? (() => {
              // Brief 89 R5 — finish the author's sentence instead of
              // refusing it: a no-match query grows CREATE rows. The
              // old full stop survives only when the sheet can't
              // create (read-only, or the consumer wired no hooks).
              const name = pickerQuery.trim();
              const canCreate =
                writable &&
                name.length > 0 &&
                (onCreateFactorTable !== undefined ||
                  onDeclareInput !== undefined);
              if (!canCreate) {
                return (
                  <p className="rater-buildup__pick-refuse">
                    Nothing matches "{pickerQuery}".
                  </p>
                );
              }
              const slug = slugifyFieldName(name);
              const TableIcon = resolveIcon("List");
              const InputIcon = resolveIcon("FileInput");
              return (
                <>
                  <p className="rater-buildup__pick-refuse">
                    Nothing named "{name}" in this plan yet.
                  </p>
                  <div className="rater-buildup__pick-group">Create</div>
                  {onCreateFactorTable ? (
                    <button
                      type="button"
                      className="rater-buildup__pick-row"
                      onClick={() => {
                        onCreateFactorTable(name, tower.id);
                        dismiss();
                      }}
                      data-testid={`${testId}-create-table`}
                    >
                      <span
                        className="rater-buildup__tile rater-buildup__tile--lookup"
                        aria-hidden
                      >
                        <TableIcon size={14} strokeWidth={1.8} />
                      </span>
                      <span className="rater-buildup__pick-body">
                        <span className="rater-buildup__pick-name">
                          Factor table "{name}"
                        </span>
                        <span className="rater-buildup__pick-sentence">
                          rate by a new dimension — its levels become the
                          rows, every factor starts at 1.00
                        </span>
                      </span>
                    </button>
                  ) : null}
                  {onDeclareInput && slug.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className="rater-buildup__pick-row"
                        onClick={() => {
                          // Declare-ONLY, honestly: the tower has no
                          // mid-chain "reads an input" step — a
                          // submission-field node folds into the
                          // chain's EXPOSURE on save (the ≤2-inputs
                          // cap is literally base + exposure). The
                          // create row's artifact is the DECLARED
                          // dictionary row; binding comes next via a
                          // factor table or the exposure pill.
                          onDeclareInput({
                            fieldName: slug,
                            displayName: name,
                            dtype: createDtype,
                          });
                          dismiss();
                        }}
                        data-testid={`${testId}-create-input`}
                      >
                        <span
                          className="rater-buildup__tile rater-buildup__tile--input"
                          aria-hidden
                        >
                          <InputIcon size={14} strokeWidth={1.8} />
                        </span>
                        <span className="rater-buildup__pick-body">
                          <span className="rater-buildup__pick-name">
                            Input "{name}"
                          </span>
                          <span className="rater-buildup__pick-sentence">
                            declared in the dictionary — key a factor
                            table on it, or set it as the exposure base
                          </span>
                        </span>
                      </button>
                      <div className="rater-buildup__pick-dtype">
                        <Segmented<"float" | "string" | "bool">
                          value={createDtype}
                          onChange={setCreateDtype}
                          ariaLabel="New input type"
                          items={[
                            { value: "float", label: "Number" },
                            { value: "string", label: "Text" },
                            { value: "bool", label: "Yes / No" },
                          ]}
                          testId={`${testId}-create-input-dtype`}
                        />
                      </div>
                    </>
                  ) : null}
                </>
              );
            })()
          : null}
        <p className="rater-buildup__pick-foot">
          Models join in Final adjustments — they apply to the whole premium,
          not one coverage.
        </p>
      </div>
    );
  };

  /** The exposure pill popover (per coverage head). */
  const renderExposurePopover = (tower: Tower): ReactNode => {
    if (exposureFor !== tower.id) return null;
    // Brief 78 P5.3c (§3.3-2) — a class-conditional coverage: the
    // exposure family is frozen verbatim on save (the per-class map
    // editor is its own brief), so the popover is HONEST about the
    // mode instead of offering selects whose edits would not persist.
    if ((tower.exposureOptionCount ?? 0) > 0) {
      return (
        <div
          className="rater-buildup__expo-pop"
          role="dialog"
          aria-label="Exposure base"
          data-testid={`${testId}-expo-pop`}
        >
          <p className="rater-buildup__expo-note">
            This coverage's exposure base varies by class —{" "}
            {tower.exposureOptionCount} authored option
            {tower.exposureOptionCount === 1 ? "" : "s"} resolve per
            risk at scoring. The class-conditional map is preserved
            verbatim; editing it lands with the class-conditional
            exposure editor.
          </p>
        </div>
      );
    }
    const inputs = pickerItems.filter((i) => i.kind === "input");
    const divisors = [1, 100, 1000];
    return (
      <div
        className="rater-buildup__expo-pop"
        role="dialog"
        aria-label="Exposure base"
        data-testid={`${testId}-expo-pop`}
      >
        <label className="rater-buildup__expo-label">
          Exposure base
          <select
            className="rater-buildup__expo-select"
            value={tower.exposureInput ?? ""}
            onChange={(e) => {
              commit(
                setTowerExposure(plan, tower.id, {
                  exposureInput: e.target.value || null,
                }),
              );
            }}
            data-testid={`${testId}-expo-input`}
          >
            <option value="">Flat — no exposure base</option>
            {inputs.map((i) => {
              const field = i.field ?? i.id;
              return (
                <option key={field} value={field}>
                  {i.title}
                </option>
              );
            })}
            {tower.exposureInput &&
            !inputs.some((i) => (i.field ?? i.id) === tower.exposureInput) ? (
              <option value={tower.exposureInput}>
                {tower.exposureInput}
              </option>
            ) : null}
          </select>
        </label>
        <label className="rater-buildup__expo-label">
          Per
          <select
            className="rater-buildup__expo-select"
            value={String(tower.exposureUnitDivisor ?? 100)}
            onChange={(e) =>
              commit(
                setTowerExposure(plan, tower.id, {
                  exposureUnitDivisor: Number(e.target.value),
                }),
              )
            }
            data-testid={`${testId}-expo-divisor`}
          >
            {divisors.map((d) => (
              <option key={d} value={String(d)}>
                ${d.toLocaleString("en-US")}
              </option>
            ))}
          </select>
        </label>
        <p className="rater-buildup__expo-note">
          Coverage chains apply their exposure automatically at scoring.
        </p>
      </div>
    );
  };

  /** One coverage section. */
  const renderCoverage = (tower: Tower): ReactNode => {
    // Brief 78 P5.3c — the per-tower exposure_options read-only gate
    // is gone: the save path round-trips those chains losslessly
    // (patch-over-original), so writability is plan-level only.
    const towerReadOnly = !writable;
    const entries = tower.entries.filter((e) => !isOutputEntry(plan, e));
    const first = entries[0];
    const baseNode =
      first?.kind === "node" ? plan.nodes.get(first.nodeId) : undefined;
    const baseIsChainBase = isBaseNode(baseNode);
    // Rows below the pinned base (or ALL rows when the first entry isn't
    // a chain-base — legacy chains keyed on a column-driven base).
    const sheetEntries = baseIsChainBase ? entries.slice(1) : entries;
    const rows = sheetEntries
      .filter((e) => e.kind !== "drop-slot")
      .map((e) =>
        e.kind === "node"
          ? { id: e.nodeId, kind: "node" as const }
          : { id: e.groupId, kind: "group" as const },
      );
    const stepCount = rows.length + (baseIsChainBase ? 1 : 0);

    const handleReorder = (orderedIds: readonly string[]) => {
      // Carry each row's above-gap operator with it (ADR-0050 keeps
      // chains multiplicative, but the rebuild stays generic).
      const allEntries = tower.entries;
      const opOf = new Map<string, Operator>();
      allEntries.forEach((e, i) => {
        const id =
          e.kind === "node" ? e.nodeId : e.kind === "group" ? e.groupId : "";
        if (i > 0 && id) opOf.set(id, tower.entryOps[i - 1] ?? "multiply");
      });
      const entryOf = new Map(
        allEntries.map((e) => [
          e.kind === "node" ? e.nodeId : e.kind === "group" ? e.groupId : "",
          e,
        ]),
      );
      const outputEntries = allEntries.filter((e) => isOutputEntry(plan, e));
      const head = baseIsChainBase && first ? [first] : [];
      const nextEntries = [
        ...head,
        ...orderedIds
          .map((id) => entryOf.get(id))
          .filter((e): e is Tower["entries"][number] => e !== undefined),
        ...outputEntries,
      ];
      const nextOps: Operator[] = [];
      for (let i = 1; i < nextEntries.length; i += 1) {
        const e = nextEntries[i]!;
        const id =
          e.kind === "node" ? e.nodeId : e.kind === "group" ? e.groupId : "";
        nextOps.push(opOf.get(id) ?? "multiply");
      }
      commit({
        ...plan,
        towers: plan.towers.map((t) =>
          t.id === tower.id
            ? { ...t, entries: nextEntries, entryOps: nextOps }
            : t,
        ),
      });
    };

    return (
      <section
        key={tower.id}
        className="rater-buildup__section"
        data-sheet-section={tower.id}
        aria-label={tower.name}
        data-testid={`${testId}-section-${tower.id}`}
      >
        <header className="rater-buildup__covhead">
          <h3 className="rater-buildup__covname">{tower.name}</h3>
          <span className="rater-buildup__expo-wrap">
            <button
              type="button"
              className="rater-buildup__expo-pill"
              disabled={towerReadOnly}
              onClick={() =>
                toggleSummon({ kind: "exposure", towerId: tower.id })
              }
              data-testid={`${testId}-expo-${tower.id}`}
            >
              {exposureSentence(tower)}
            </button>
            {renderExposurePopover(tower)}
          </span>
          {/* Brief 82 O-1 — no computed number in the header; the
              honest header fact is the build's SIZE. */}
          <span
            className="rater-buildup__covcount"
            data-testid={`${testId}-covcount-${tower.id}`}
          >
            {stepCount} step{stepCount === 1 ? "" : "s"}
          </span>
          {!towerReadOnly ? (
            <span className="rater-buildup__covhead-actions">
              <IconButton
                aria-label={`Delete ${tower.name}`}
                size="xs"
                variant="ghost"
                onClick={() => setPendingTowerDelete(tower)}
                data-testid={`${testId}-delete-coverage-${tower.id}`}
                icon={<Trash2 size={13} strokeWidth={1.8} />}
              />
            </span>
          ) : null}
        </header>
        {/* Brief 82 D-E — the column contract, stated once per card. */}
        <div className="rater-buildup__cols" aria-hidden>
          <span>Step</span>
          <span className="rater-buildup__cols-r">Value</span>
        </div>
        {baseIsChainBase && baseNode ? (
          <OrderedSheetStaticRow
            num={1}
            selected={selectedRow?.nodeId === baseNode.id}
            onClick={() =>
              toggleSummon({
                kind: "row",
                towerId: tower.id,
                nodeId: baseNode.id,
              })
            }
            testId={`${testId}-base-${tower.id}`}
          >
            {renderStepContent(tower, baseNode, !towerReadOnly)}
          </OrderedSheetStaticRow>
        ) : null}
        <OrderedSheet
          rows={rows}
          firstNumber={baseIsChainBase ? 2 : 1}
          ariaLabel={`${tower.name} steps`}
          readOnly={towerReadOnly}
          selectedId={
            selectedRow?.towerId === tower.id ? selectedRow.nodeId : null
          }
          onRowClick={(row) => {
            if (row.kind === "node") {
              // Toggle: clicking the open row closes its editor (D-B).
              toggleSummon({
                kind: "row",
                towerId: tower.id,
                nodeId: row.id,
              });
            }
          }}
          {...(towerReadOnly ? {} : { onReorder: handleReorder })}
          renderRow={(row) => {
            if (row.kind === "group") return renderGroupRow(row.id);
            const node = plan.nodes.get(row.id);
            if (!node) return null;
            return renderStepContent(tower, node, !towerReadOnly);
          }}
          // Brief 82 R2 (F15) — no hover-delete on the reading
          // surface: Delete lives in the expanded row editor.
          testId={`${testId}-steps-${tower.id}`}
        />
        {!towerReadOnly ? (
          <div className="rater-buildup__add-wrap">
            <button
              type="button"
              className="rater-buildup__add-step"
              onClick={() =>
                toggleSummon({ kind: "picker", towerId: tower.id })
              }
              data-testid={`${testId}-add-step-${tower.id}`}
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden />
              Add step
            </button>
            {renderPicker(tower)}
          </div>
        ) : null}
      </section>
    );
  };

  const renderFinalAdjustments = (): ReactNode => {
    const canAdd = writable && onAddAdjustment !== undefined;
    if (finalAdjustments.length === 0 && !canAdd) return null;
    return (
      <section
        className="rater-buildup__section"
        data-sheet-section="__final"
        aria-label="Final adjustments"
        data-testid={`${testId}-final`}
      >
        <header className="rater-buildup__covhead">
          <h3 className="rater-buildup__covname">Final adjustments</h3>
          <span className="rater-buildup__covhead-hint">
            applied in order, after coverages sum
          </span>
          <span
            className="rater-buildup__covcount"
            data-testid={`${testId}-covcount-final`}
          >
            {finalAdjustments.length} adjustment
            {finalAdjustments.length === 1 ? "" : "s"}
          </span>
        </header>
        <div className="rater-buildup__cols" aria-hidden>
          <span>Adjustment</span>
          <span className="rater-buildup__cols-r">Effect</span>
        </div>
        {finalAdjustments.map((row, i) => {
          // Brief 78 P5.4 (D-F) — policy-tail rows edit/delete via the
          // policy-tail handlers; plan-stage rows keep the stage path.
          const isPolicyTail = row.provenance === "policy-tail";
          const onRowEdit = isPolicyTail ? onOpenPolicyTail : undefined;
          const canEdit = isPolicyTail
            ? onOpenPolicyTail !== undefined
            : onEditAdjustment !== undefined;
          const canDelete = isPolicyTail
            ? onDeletePolicyTail !== undefined
            : onDeleteAdjustment !== undefined;
          return (
          <OrderedSheetStaticRow
            key={`${row.provenance ?? "plan-stage"}-${row.id}`}
            num={i + 1}
            {...(canEdit && writable
              ? {
                  onClick: () =>
                    isPolicyTail
                      ? onRowEdit?.()
                      : onEditAdjustment?.(row.id),
                }
              : {})}
            {...(writable && canDelete
              ? {
                  actions: (
                    <IconButton
                      aria-label={`Delete ${row.name}`}
                      size="xs"
                      variant="ghost"
                      onClick={() => setPendingFaDelete(row)}
                      data-testid={`${testId}-fa-delete-${row.id}`}
                      icon={<Trash2 size={13} strokeWidth={1.8} />}
                    />
                  ),
                }
              : {})}
            testId={`${testId}-fa-${row.id}`}
          >
            <div className="rater-buildup__step">
              <div className="rater-buildup__step-body">
                <div className="rater-buildup__step-name">
                  {row.name}
                  {/* Brief 82 R4 (D-F) — the DEFAULT substrate (plan
                      stage) is untagged; only the exception names
                      itself. Tagging the default was noise. */}
                  {isPolicyTail ? (
                    <span
                      className="rater-buildup__prov"
                      data-testid={`${testId}-fa-prov-${row.id}`}
                    >
                      policy tail
                    </span>
                  ) : null}
                </div>
                <div className="rater-buildup__step-bind">{row.sentence}</div>
              </div>
              <span className="rater-buildup__col-value">
                {row.meta ? (
                  <span className="rater-buildup__meta">{row.meta}</span>
                ) : null}
              </span>
            </div>
          </OrderedSheetStaticRow>
          );
        })}
        {finalAdjustments.length === 0 ? (
          <p className="rater-buildup__fa-empty">
            No adjustments yet — IRPM schedules, credits, and minimum
            premiums land here.
          </p>
        ) : null}
        {canAdd ? (
          <div className="rater-buildup__add-wrap">
            {/* Brief 82 R4 (D-F) — ONE add menu replaces the five
                permanent buttons. The four create verbs (G16's
                endorsement path included) + the policy tail's editor,
                summoned like every other surface. */}
            <button
              type="button"
              className="rater-buildup__add-step"
              onClick={() => toggleSummon({ kind: "add-adjustment" })}
              data-testid={`${testId}-fa-add`}
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden />
              Add adjustment
            </button>
            {addAdjustmentOpen ? (
              <div
                className="rater-buildup__fa-menu"
                role="dialog"
                aria-label="Add an adjustment"
                data-testid={`${testId}-fa-menu`}
              >
                {(
                  [
                    {
                      kind: "modifier" as const,
                      label: "Schedule modifier",
                      hint: "per-risk judgment",
                      id: "modifier",
                    },
                    {
                      kind: "endorsement" as const,
                      label: "Endorsement",
                      hint: "form-attached change",
                      id: "endorsement",
                    },
                    {
                      kind: "loading" as const,
                      label: "Loading",
                      hint: "flat multiplier",
                      id: "loading",
                    },
                    {
                      kind: "min_premium" as const,
                      label: "Minimum premium",
                      hint: "floor + rounding",
                      id: "min",
                    },
                  ] as const
                ).map((verb) => (
                  <button
                    key={verb.id}
                    type="button"
                    className="rater-buildup__fa-menu-row"
                    onClick={() => {
                      dismiss();
                      onAddAdjustment?.(verb.kind);
                    }}
                    data-testid={`${testId}-fa-add-${verb.id}`}
                  >
                    <span>{verb.label}</span>
                    <span className="rater-buildup__fa-menu-hint">
                      {verb.hint}
                    </span>
                  </button>
                ))}
                {onOpenPolicyTail !== undefined ? (
                  <>
                    <hr className="rater-buildup__fa-menu-hr" />
                    <button
                      type="button"
                      className="rater-buildup__fa-menu-row"
                      onClick={() => {
                        dismiss();
                        onOpenPolicyTail();
                      }}
                      data-testid={`${testId}-fa-policy-tail`}
                    >
                      <span>Policy tail…</span>
                      <span className="rater-buildup__fa-menu-hint">
                        composes per policy
                      </span>
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  };

  /**
   * Brief 82 D-A — "+ Add coverage" re-homed from the deleted
   * COVERAGES side-nav: a ghost row after the last coverage card.
   */
  const renderAddCoverage = (): ReactNode => {
    if (!writable) return null;
    const commitAdd = () => {
      if (!addCoverageName.trim()) return;
      commit(
        addEmptyTower(plan, {
          name: coverageDisplayName(addCoverageName),
          outputField: slugifyOutputField(addCoverageName.trim()),
          ratingDimensionValue: matchCoverageLevel(
            addCoverageName,
            plan.ratingDimensionValues,
          ),
        }),
      );
      setAddCoverageName("");
      dismiss();
    };
    return (
      <div className="rater-buildup__addcov-wrap">
        <button
          type="button"
          className="rater-buildup__addcov"
          onClick={() => toggleSummon({ kind: "add-coverage" })}
          data-testid={`${testId}-add-coverage`}
        >
          <Plus size={13} strokeWidth={1.8} aria-hidden /> Add coverage
        </button>
        {addCoverageOpen ? (
          <div
            className="rater-buildup__addcov-pop"
            role="dialog"
            aria-label="Add coverage"
          >
            <input
              className="rater-buildup__field-input"
              value={addCoverageName}
              onChange={(e) => setAddCoverageName(e.target.value)}
              placeholder="Coverage name"
              aria-label="Coverage name"
              autoFocus
              onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") commitAdd();
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={!addCoverageName.trim()}
              onClick={commitAdd}
            >
              Add
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  /**
   * Brief 82 D-B (R1 form) — the in-place row editor. Everything the
   * floating inspector held opens UNDER the selected row instead:
   * rename · open table · predicate · value · duplicate · delete.
   * R2 grows this container into the inline grid editor.
   */
  const renderRowEdit = (tower: Tower, node: TowerNode): ReactNode => {
    const ref = node.ref;
    // Brief 78 P5.3c — plan-level writability only (the per-tower
    // exposure_options gate died with the lossless round-trip).
    const towerReadOnly = !writable;
    const inputs = pickerItems.filter((i) => i.kind === "input");

    return (
      <div
        className="rater-buildup__rowedit"
        role="group"
        aria-label={`${node.title} details`}
        data-testid={`${testId}-inspector`}
        // The OrderedSheet row ignores clicks from this region — the
        // editor owns its interactions (no propagation hacks).
        data-osheet-stop-row-click
      >
        <header className="rater-buildup__insp-head">
          <div className="rater-buildup__insp-title">
            {towerReadOnly ? (
              <span className="rater-buildup__insp-name">
                {nodeDisplayTitle(node)}
              </span>
            ) : (
              <input
                className="rater-buildup__insp-name-input"
                value={node.title}
                aria-label="Step name"
                onChange={(e) =>
                  commit(renameNode(plan, node.id, e.target.value))
                }
                data-testid={`${testId}-insp-rename`}
              />
            )}
            <span className="rater-buildup__insp-kind">
              {node.subtitle ?? ref?.kind ?? "step"}
            </span>
            {/*  — the editor header answers "where did this
                number come from" without opening the build report. */}
            {ref?.kind === "factor-table" &&
            factorTableMeta?.get(ref.tableId)?.citation ? (
              <span className="rater-buildup__insp-cite">
                {factorTableMeta.get(ref.tableId)?.citation}
              </span>
            ) : null}
          </div>
          {ref?.kind === "factor-table" && onOpenFactorTable !== undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onOpenFactorTable(ref.tableId)}
              data-testid={`${testId}-insp-open-table`}
            >
              <Maximize2 size={12} strokeWidth={1.8} aria-hidden /> Full
              screen
            </Button>
          ) : null}
          <IconButton
            aria-label="Close details"
            size="xs"
            variant="ghost"
            onClick={dismiss}
            data-testid={`${testId}-insp-close`}
            icon={<X size={14} strokeWidth={1.8} />}
          />
        </header>

        {ref?.kind === "factor-table" ? (
          <div className="rater-buildup__insp-block">
            {/* Brief 82 R2 (D-B) — THE INLINE GRID: the consumer's
                table editor renders here, at content width. "Full
                screen" (header) opens the takeover for the big ones. */}
            {renderTableEditor !== undefined ? (
              <div
                className="rater-buildup__insp-grid"
                data-testid={`${testId}-insp-grid`}
              >
                {renderTableEditor(ref.tableId)}
              </div>
            ) : null}
            {/* Brief 82 D-G — the predicate builder: pick the field by
                its display name, then a value control TYPED by the
                field's dtype. Same persisted shape ({path, equals});
                P2 G7-full — every shape gates in live scoring. */}
            <div className="rater-buildup__insp-row">
              <div className="rater-buildup__insp-field">
                <span className="rater-buildup__insp-label">Applies</span>
                <select
                  className="rater-buildup__expo-select"
                  disabled={towerReadOnly}
                  value={ref.predicate?.path ?? ""}
                  onChange={(e) => {
                    const path = e.target.value;
                    if (path === "") {
                      commit(setFactorPredicate(plan, node.id, null));
                      return;
                    }
                    // Seed equals by the field's dtype (D-G).
                    const dtype = inputs.find(
                      (i) => `form_input.${i.field ?? i.id}` === path,
                    )?.dtype;
                    const seed: boolean | number | string =
                      dtype === "number" ? 1 : dtype === "string" ? "" : true;
                    commit(
                      setFactorPredicate(plan, node.id, {
                        path,
                        equals: seed,
                      }),
                    );
                  }}
                  aria-label="Applies when"
                  data-testid={`${testId}-insp-predicate-path`}
                >
                  <option value="">Always</option>
                  {inputs.map((i) => {
                    const field = i.field ?? i.id;
                    return (
                      <option key={field} value={`form_input.${field}`}>
                        only when {i.title}…
                      </option>
                    );
                  })}
                  {ref.predicate &&
                  !inputs.some(
                    (i) =>
                      `form_input.${i.field ?? i.id}` === ref.predicate?.path,
                  ) ? (
                    <option value={ref.predicate.path}>
                      only when{" "}
                      {ref.predicate.path.replace(/^form_input\./, "")}…
                    </option>
                  ) : null}
                </select>
              </div>
              {ref.predicate ? (
                <div className="rater-buildup__insp-field">
                  <span className="rater-buildup__insp-label">…is</span>
                  {typeof ref.predicate.equals === "boolean" ? (
                    <div
                      className="rater-buildup__seg"
                      role="group"
                      aria-label="Predicate value"
                    >
                      {([true, false] as const).map((v) => (
                        <button
                          key={String(v)}
                          type="button"
                          className={`rater-buildup__seg-btn${
                            ref.predicate!.equals === v ? " is-on" : ""
                          }`}
                          disabled={towerReadOnly}
                          onClick={() =>
                            commit(
                              setFactorPredicate(plan, node.id, {
                                path: ref.predicate!.path,
                                equals: v,
                              }),
                            )
                          }
                          data-testid={`${testId}-insp-predicate-${v}`}
                        >
                          {String(v)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input
                      className="rater-buildup__field-input"
                      disabled={towerReadOnly}
                      {...(typeof ref.predicate.equals === "number"
                        ? { type: "number", inputMode: "decimal" as const }
                        : {})}
                      value={String(ref.predicate.equals)}
                      aria-label="Predicate value"
                      onChange={(e) => {
                        const raw = e.target.value;
                        const coerced =
                          typeof ref.predicate!.equals === "number"
                            ? Number.isFinite(Number(raw)) && raw !== ""
                              ? Number(raw)
                              : 0
                            : raw;
                        commit(
                          setFactorPredicate(plan, node.id, {
                            path: ref.predicate!.path,
                            equals: coerced,
                          }),
                        );
                      }}
                      data-testid={`${testId}-insp-predicate-value`}
                    />
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {ref?.kind === "chain-base" || ref?.kind === "constant" ? (
          <div className="rater-buildup__insp-block">
            <div className="rater-buildup__insp-field">
              <span className="rater-buildup__insp-label">
                {ref.kind === "chain-base" ? "Base rate" : "Value"}
              </span>
              <input
                className="rater-buildup__field-input"
                disabled={towerReadOnly}
                value={
                  ref.kind === "chain-base"
                    ? (ref.baseValue ?? "")
                    : (ref.value ?? "")
                }
                aria-label="Value"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const v =
                    e.target.value === "" || !Number.isFinite(n) ? null : n;
                  commit(
                    ref.kind === "chain-base"
                      ? setChainBaseValue(plan, node.id, v)
                      : setConstantValue(plan, node.id, v),
                  );
                }}
                data-testid={`${testId}-insp-value`}
              />
            </div>
            {ref.kind === "constant" && ref.role === "lcm" ? (
              <p className="rater-buildup__insp-note">
                The loss-cost multiplier applies after the rate rounds to 3
                decimals — it is not folded into the base.
              </p>
            ) : null}
          </div>
        ) : null}

        {!towerReadOnly ? (
          <footer className="rater-buildup__insp-foot">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => commit(duplicateNode(plan, node.id))}
              data-testid={`${testId}-insp-duplicate`}
            >
              Duplicate
            </Button>
            <Button
              type="button"
              variant="danger-text"
              size="xs"
              onClick={() => deleteStep(tower.id, node)}
              data-testid={`${testId}-insp-delete`}
            >
              Delete step
            </Button>
          </footer>
        ) : null}
      </div>
    );
  };

  // ── Empty state: the creation question ────────────────────────────
  if (perLevelTowers.length === 0) {
    const pickable = spawnDims.filter(
      (d) => levelsForKeying(d).length > 0,
    );
    return (
      <div className={`rater-buildup is-empty`} data-testid={`${testId}-create`}>
        <div className="rater-buildup__create">
          <h2 className="rater-buildup__create-q">
            How does this plan build a premium?
          </h2>
          <p className="rater-buildup__create-sub">
            Start with one premium, or split it by coverage — each coverage
            gets its own build-up sheet.
          </p>
          {writable ? (
            <>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() =>
                  commit(
                    addEmptyTower(plan, {
                      name: "Premium",
                      outputField: "premium",
                    }),
                  )
                }
                data-testid={`${testId}-start-single`}
              >
                Start with one premium
              </Button>
              {pickable.length > 0 ? (
                <>
                  <p className="rater-buildup__create-or">
                    or split by a coverage dimension
                  </p>
                  <div className="rater-buildup__create-list">
                    {pickable.map((dim) => {
                      const levels = levelsForKeying(dim);
                      return (
                        <DimToken
                          key={dim.id}
                          dim={dim}
                          density="row"
                          // B7 — DimToken row density renders its own count by
                          // default; we pass an explicit `trailing` count below,
                          // so suppress the built-in to avoid "3 levels 3 levels".
                          count={false}
                          onActivate={() =>
                            commit(
                              spawnTowersFromDim(plan, {
                                slug: dim.slug,
                                levels: levels.map((l) => ({
                                  id: l.id,
                                  label: l.label,
                                })),
                              }),
                            )
                          }
                          trailing={
                            <span className="rater-buildup__create-count">
                              {countLabel(dim, shapeOf(dim))}
                            </span>
                          }
                          testId={`${testId}-spawn-${dim.slug}`}
                        />
                      );
                    })}
                  </div>
                </>
              ) : onNavigateToDimensions !== undefined ? (
                <p className="rater-buildup__create-foot">
                  A coverage split needs a dimension with levels —{" "}
                  <button
                    type="button"
                    className="rater-buildup__create-link"
                    onClick={onNavigateToDimensions}
                  >
                    define one in Dimensions
                  </button>
                  .
                </p>
              ) : null}
            </>
          ) : (
            <p className="rater-buildup__create-foot">
              This plan has no rating chain yet. It's read-only, so the
              build-up starts on a draft.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── The document (Brief 82 D-A — one column, nothing beside it) ───
  return (
    <div className="rater-buildup" data-testid={testId}>
      <div className="rater-buildup__col">
        {perLevelTowers.map((t) => renderCoverage(t))}
        {renderAddCoverage()}
        {renderFinalAdjustments()}
      </div>

      <ImpactDeletePrompt
        open={pendingDelete !== null}
        artifactName={
          pendingDelete ? nodeDisplayTitle(pendingDelete.node) : ""
        }
        artifactKind="step"
        lossStatement={
          pendingDelete
            ? `The chain stops ${
                pendingDelete.node.ref?.kind === "chain-base"
                  ? "at its base — without a base rate this coverage cannot price"
                  : "multiplying this step"
              }. Premiums change on the next save.`
            : ""
        }
        onConfirm={() => {
          if (pendingDelete) {
            commit(deleteNodeById(plan, pendingDelete.node.id));
          }
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
        testId={`${testId}-delete-prompt`}
      />
      <ImpactDeletePrompt
        open={pendingTowerDelete !== null}
        artifactName={pendingTowerDelete?.name ?? ""}
        artifactKind="coverage"
        lossStatement="Every step in this coverage's build-up goes with it. The Total recomputes from the remaining coverages on the next save."
        onConfirm={() => {
          if (pendingTowerDelete) {
            const next: TowerPlan = {
              ...plan,
              towers: plan.towers.filter(
                (t) => t.id !== pendingTowerDelete.id,
              ),
              ratingDimensionValues: plan.ratingDimensionValues.filter(
                (v) => v !== pendingTowerDelete.ratingDimensionValue,
              ),
            };
            commit(next);
          }
          setPendingTowerDelete(null);
        }}
        onCancel={() => setPendingTowerDelete(null)}
        testId={`${testId}-tower-delete-prompt`}
      />
      <ImpactDeletePrompt
        open={pendingFaDelete !== null}
        artifactName={pendingFaDelete?.name ?? ""}
        artifactKind="adjustment"
        lossStatement={
          pendingFaDelete?.kind === "min_premium"
            ? "Premiums will no longer be floored — low-band risks score their raw computed premium."
            : "This adjustment stops applying to scored premiums immediately."
        }
        onConfirm={() => {
          // Brief 78 P5.4 (D-F) — dispatch by the row's substrate.
          if (pendingFaDelete) {
            if (pendingFaDelete.provenance === "policy-tail") {
              onDeletePolicyTail?.(pendingFaDelete.id);
            } else {
              onDeleteAdjustment?.(pendingFaDelete.id);
            }
          }
          setPendingFaDelete(null);
        }}
        onCancel={() => setPendingFaDelete(null)}
        testId={`${testId}-fa-delete-prompt`}
      />
    </div>
  );
}
