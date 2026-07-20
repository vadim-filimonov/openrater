/**
 * InputsPanelV2 — the rebuilt Inputs body (Interface Guide v2, station S2).
 *
 * The v2 Inputs surface, rebuilt in the calm v2 language while REUSING the
 * v1 logic (CSV parse / auto-match / scoring) — §2B logic/view split. The
 * mount (InputsWorkspaceMount) owns all wiring + persistence and renders
 * this view in place of the v1 <InputsWorkspace> when ?v2=1.
 *
 * Stages of the surface (built incrementally):
 *   A — declare (dictionary) + connect a data source (CSV)        ✓
 *   B — map columns to fields (auto-recognition + manual)         ✓ here
 *   C — live scoring preview + score the whole book
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FileDown,
  Upload,
  FileSpreadsheet,
  RotateCcw,
  Wand2,
  Play,
  AlertTriangle,
  ChevronRight,
  X,
  Globe,
  Sparkles,
  ExternalLink,
  ListPlus,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import {
  executePlanBatch,
  resolveEligibilityTier,
  ELIGIBILITY_TIER_LABELS,
  // book intake — the SAME header pre-flight the chat door runs.
  preflightHeader,
  composePreflightSentence,
} from "@openrater/contracts";
import type {
  Dimension,
  Plan,
  ProjectionIssue,
  RunResult,
  PrimitiveType,
  EligibilityTier,
  TraceEntry,
  PolicyBookResult,
  PolicyResult,
  ConnectorEvaluator,
} from "@openrater/contracts";
import {
  parseCsvForInputsAsync,
  emptyPlanInputMapping,
  autoMatchColumns,
  applyAutoMatchToMapping,
  projectRowsToExternalInputs,
  detectMismatches,
  applyAliasOverride,
  detectOutOfRange,
  detectDtypeMismatch,
  autoDetectGrouping,
  planTotalOutputField,
  suggestRollupFields,
  isRatioMapping,
  formatRatio,
  computeRatioForRow,
  RATIO_PREFIX,
  emptyWebhookConfig,
  applyCohortPolicyTail,
} from "../InputsWorkspace";
import type {
  PlanInputMapping,
  RequiredInputEntry,
  MatchCandidate,
  InputDtypeMap,
  Mismatch,
  OutOfRangeBand,
  PolicyGroupingConfig,
  RollupFieldSpec,
  WebhookConfig,
  CohortRowTail,
} from "../InputsWorkspace";
import { Button, IconButton, Chip, EmptyState } from "@openrater/design-system";
import { resolvePremiumColumn } from "../AnalyticsWorkspace/analytics-bridge";
import {
  COVERAGE_SUM_COLUMN,
  declaredPremiumRollup,
  isTotalLessMultiCoverage,
  resolvePlanPremiumContext,
  sumMoneyFields,
} from "../AnalyticsWorkspace/premium-resolution";
import { TierVerdictChip } from "../TierVerdictChip";
import { PremiumBuildUp } from "../PremiumBuildUp";
import { DictionaryTable, type GhostInput } from "./DictionaryTable";
import { PlanGenesis } from "../PlanGenesis";
import { PolicyGroupingCard } from "./PolicyGroupingCard";
import { WebhookSource, type WebhookInferResult } from "./WebhookSource";
import type { InputDictEntry } from "../InputDictionary/types";
import "./inputs-v2.css";

/** The source-picker option that starts a derived-ratio binding (P2.5). */
const RATIO_OPTION = "@@ratio-new";

export interface InputStageLike {
  readonly stage_id: string;
  readonly stage_kind: string;
  readonly display_name?: string;
  readonly config_json?: unknown;
}

export interface InputsPanelSampleDataset {
  readonly url: string;
  readonly label?: string | undefined;
}

export interface InputsPanelV2Props {
  readonly stages: readonly InputStageLike[];
  /** Controlled source + column-map substrate (owned by the mount).
   *  `null` ⇒ not loaded yet (the mount uses null before first hydrate). */
  readonly inputMapping?: PlanInputMapping | null | undefined;
  /** Persist a new mapping (CSV source, column_map, …). Absent ⇒ read-only. */
  readonly onMappingChange?: ((mapping: PlanInputMapping) => void) | undefined;
  /** The fields the plan needs mapped — drives the binding table + auto-match. */
  readonly requiredInputs?: readonly RequiredInputEntry[] | undefined;
  /** Dimension catalog — feeds auto-match value matching. */
  readonly dimensions?: readonly Dimension[] | undefined;
  /** Runtime plan — scores the sample rows for the live premium preview. */
  readonly plan?: Plan | undefined;
  /** Per-input dtypes so the projector coerces typed values (Phase C). */
  readonly inputDtypes?: InputDtypeMap | undefined;
  /** Brief 75 phase 4 — deep-link to the Run tab, which owns book
   *  EXECUTION (Inputs keeps intake + mapping + this preview). Absent ⇒
   *  no pointer renders. */
  readonly onOpenRun?: (() => void) | undefined;
  /** Fetch a webhook sample + infer its field schema (P2.1) — wired by the
   *  mount to testWebhookRequest + inferPayloadSchema. Absent ⇒ the webhook
   *  "Fetch sample" action is disabled. */
  readonly onInferSchema?:
    | ((config: WebhookConfig) => Promise<WebhookInferResult>)
    | undefined;
  /** Per-policy roll-up results (P2.2) — the mount rates each location,
   *  reduces to the policy, and runs policy-scope appetite gates. Non-empty
   *  only when `inputMapping.grouping_config` + `rollup_fields` are set; the
   *  view then renders the per-policy list in place of the per-row strip. */
  readonly policyRollupResults?: readonly PolicyBookResult[] | undefined;
  /** ADR-0056 — structured issues from the plan's projection (the dry
   *  compile). Severity-"error" entries mean parts of the plan price
   *  NOTHING (skipped stage kind, missing factor table, dropped
   *  predicate) — rendered as a strip above the premium preview so a
   *  confident-looking preview can never sit on a silently degraded
   *  plan. Absent/empty ⇒ nothing renders. */
  readonly projectionIssues?: readonly ProjectionIssue[] | undefined;
  /** Enrich the book by invoking the plan's API Lab route(s) per row (P2.3):
   *  resolve each route's bound inputs from the row, invoke the connection,
   *  and push the outputs back as new columns. Owned by the mount (it has the
   *  connector/route data + cost). Absent ⇒ read-only / no routes. */
  readonly onEnrichBook?:
    | ((mapping: PlanInputMapping) => void | Promise<void>)
    | undefined;
  /** True while an enrich run is in flight — drives the button's loading state. */
  readonly enriching?: boolean | undefined;
  /** Inputs fed by an API Lab route (P2.3): id → { route name, resolved value }
   *  ("" value ⇒ bound but not run yet). Drives the "API · via {route}"
   *  provenance chip in place of the CSV-column select. Read-only display. */
  readonly apiSourcedByKey?:
    | ReadonlyMap<string, { readonly sourceLabel: string; readonly value: string }>
    | undefined;
  /** Jump to the API Lab route that feeds an api-sourced input. Absent ⇒ no
   *  jump affordance on the provenance chip. */
  readonly onOpenApiLab?: (() => void) | undefined;
  /**  — the "Fetch from an API" source door follows the API Lab
   *  ship flag. Default true (existing consumers unchanged). */
  readonly showApiSourceDoor?: boolean | undefined;
  /** Paid-connector cost guardrail (Brief 62.6 PR3) — a ReactNode the mount
   *  builds when the plan's rating tail binds a connector, so scoring the book
   *  pre-fetches per-row connector data (costs money). Rendered above the
   *  premium preview so the cost warning + Run gate precede Score-all. Null
   *  for plans with no connector source. */
  readonly bookGuardrail?: ReactNode | undefined;
  /** Surfaces the projected cohort rows so the mount can pre-fetch each row's
   *  connector data + price the guardrail (Brief 62.6 PR3). Fired (ref-guarded)
   *  whenever the projection changes. */
  readonly onCohortRows?:
    | ((rows: readonly Readonly<Record<string, unknown>>[]) => void)
    | undefined;
  /** Resolves a model-sourced IRPM step in the plan's Final-adjustments tail
  /** Resolves a connector-sourced IRPM step per row (Brief 62.6) — available
   *  only after the cost guardrail's pre-fetch runs. Absent ⇒ a connector-
   *  sourced tail degrades to the chain premium in the preview. */
  readonly connectorEvaluator?: ConnectorEvaluator | undefined;
  /** Declared-input dictionary CRUD (P0.1). When present, the dictionary
   *  table is editable (declare / rename / retype / delete) on a draft plan;
   *  absent ⇒ the read-only stage-derived view. */
  readonly dictionary?:
    | {
        readonly inputs: readonly InputDictEntry[];
        readonly onUpsert?: ((entry: InputDictEntry) => void) | undefined;
        readonly onDelete?: ((id: string) => void) | undefined;
        readonly busy?: boolean | undefined;
        /** Count of fields the rating structure needs but aren't declared. */
        readonly undeclaredCount?: number | undefined;
        /** Declare all of the structure's undeclared fields (P0.2). */
        readonly onDeclareAll?: (() => void) | undefined;
        /** Declare a batch of inputs at once — declare-from-book columns. */
        readonly onBulkAdd?:
          | ((entries: readonly InputDictEntry[]) => void)
          | undefined;
      }
    | undefined;
  /** Sample-row cap for the parsed snapshot. */
  readonly maxSampleRows?: number | undefined;
  /** Optional one-click sample CSV for the dropzone. */
  readonly sampleDataset?: InputsPanelSampleDataset | undefined;
  /**
   * V2_INTERFACE_SPEC §2.4 — downloads a one-row CSV template whose
   * headers are the declared inputs, so a book can be filled by ops
   * and re-dropped with zero mapping friction. Rendered as a quiet
   * action in the dropzone when provided.
   */
  readonly onDownloadCsvTemplate?: (() => void) | undefined;
  /**
   * Brief 89 (R2–R4) — the two-door genesis block. The MOUNT passes this
   * only when it judged the plan fully empty (zero stages of ANY kind,
   * zero dimensions, zero factor tables); the panel adds its own
   * source/dictionary emptiness checks and the block dissolves the
   * moment either fails. `onAlgorithmDoor` navigates to Rating;
   * `onDuplicate` (only when another plan exists) goes to the plan list.
   */
  readonly genesis?:
    | {
        readonly onAlgorithmDoor: () => void;
        readonly onDuplicate?: (() => void) | undefined;
      }
    | undefined;
}

interface InputFieldVM {
  id: string;
  name: string;
  slug: string;
  type: string;
  source: string;
}

function str(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function typeLabel(dtype: string): string {
  switch (dtype) {
    case "money":
    case "currency":
      return "Money $";
    case "boolean":
    case "bool":
      return "Yes / No";
    case "number":
    case "integer":
      return "Number";
    default:
      return "Text";
  }
}

function typeClass(dtype: string): string {
  if (dtype === "money" || dtype === "currency")
    return "rater-inputs2__type--money";
  if (dtype === "boolean" || dtype === "bool") return "rater-inputs2__type--bool";
  return "";
}

/** Trim a sample value for the preview cell. */
function fmtSample(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  return s.length > 28 ? s.slice(0, 27) + "…" : s;
}

/** Whole-dollar currency for premium previews. */
function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Column slug → a friendlier display name (annual_gross_sales → Annual gross sales). */
function prettify(slug: string): string {
  const s = slug.replace(/[_-]+/g, " ").trim();
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : slug;
}

/** Parsed-CSV dtype → the declared-input PrimitiveType for declare-from-book. */
function csvDtypeToPrimitive(d: unknown): PrimitiveType {
  switch (d) {
    case "number":
      return "float";
    case "boolean":
      return "bool";
    case "date":
      return "date";
    default:
      return "string";
  }
}

/** Tidy a single trace output value (a factor, a band id, a flag). */
function fmtTrace(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "");
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  return s === "" ? "—" : s;
}

/** One quiet line summarising every banded input that clamped a tail value. */
function oorSummary(bands: readonly OutOfRangeBand[]): string {
  const total = bands.reduce((sum, b) => sum + b.count, 0);
  const allClamped = bands.every((b) => b.clamped);
  return `${total} value${total === 1 ? "" : "s"} across ${bands.length} banded input${
    bands.length === 1 ? "" : "s"
  } fell outside every band — ${
    allClamped
      ? "clamped to the nearest band, not the neutral 1.0 factor."
      : "priced at the neutral 1.0 factor."
  }`;
}

/** A scored sample row: its premium, eligibility verdict, and full result. */
interface ScoredRow {
  readonly premium: number | null;
  readonly tier: EligibilityTier | null;
  readonly result: RunResult;
}

/**
 * The inline factor trace for one expanded row (P1.3) — the "why".
 * Lists every node that fired with its actuary-language explanation (or
 * the raw output value when the kind supplies none); error nodes show
 * the failure. Terse by design — a "what fired" audit, not the deep
 * TracePanel. Mirrors the v1 ScoringPreviewPane TraceRow, restyled v2.
 */
/** Plain-language fallbacks for engine kind ids (Brief 65 §3.5 — the
 *  trace is the explainability surface; it never speaks in kindIds). */
function traceKindLabel(kindId: string): string {
  if (kindId.startsWith("chain.")) return "Rating step";
  if (kindId.startsWith("lookup.")) return "Table lookup";
  if (kindId.startsWith("eligibility.")) return "Eligibility rule";
  if (kindId.startsWith("derive.")) return "Derived value";
  if (kindId.startsWith("model.")) return "Model";
  if (kindId.startsWith("modifier")) return "Modifier";
  if (kindId === "literal") return "Constant";
  if (kindId === "input" || kindId === "input_node") return "Input";
  if (kindId === "output") return "Output";
  if (kindId === "clamp") return "Limit";
  if (kindId === "round") return "Rounding";
  return "Rating step";
}

function TraceCard({
  index,
  row,
  nameByNodeId,
}: {
  readonly index: number;
  readonly row: ScoredRow;
  readonly nameByNodeId?: ReadonlyMap<string, string> | undefined;
}): JSX.Element {
  const entries = Object.entries(row.result.trace as Record<string, TraceEntry>);
  return (
    <div
      className="rater-inputs2__trace"
      role="region"
      aria-label={`Row ${index + 1} factor trace`}
    >
      <div className="rater-inputs2__trace-head">
        <span className="rater-inputs2__trace-title">Row {index + 1}</span>
        {/* Canonical tier visual (Brief 55) — one color language across the
            filter editor, gate rail, scored row, and Analytics legend. */}
        {row.tier ? <TierVerdictChip tier={row.tier} /> : null}
        <span
          className={`rater-inputs2__trace-premium${
            row.result.row_status === "error" ? " is-error" : ""
          }`}
        >
          {row.result.row_status === "error"
            ? "cannot rate"
            : row.premium !== null
              ? fmtMoney(row.premium)
              : "no premium"}
        </span>
      </div>
      {/* ADR-0056 — the row's structured issues, above the step trace:
          the WHY in one glance (unknown key, unmapped territory, an
          authored default that fired) before the step-by-step how.
          Display-deduped: several nodes can miss on the SAME fact (one
          unknown class feeds many lookups) — one line per distinct
          message keeps the story readable; the full per-node record
          stays in the step trace below. */}
      {row.result.issues && row.result.issues.length > 0 ? (
        <ul className="rater-inputs2__trace-issues">
          {[
            ...new Map(
              row.result.issues.map((iss) => [
                `${iss.code}:${iss.message}`,
                iss,
              ]),
            ).values(),
          ].map((iss, k) => (
            <li
              key={k}
              className={`rater-inputs2__trace-issue${
                iss.severity === "error" ? " is-error" : ""
              }`}
            >
              {iss.message}
            </li>
          ))}
        </ul>
      ) : null}
      {entries.length === 0 ? (
        <p className="rater-inputs2__trace-empty">
          No rating steps fired for this row.
        </p>
      ) : (
        <ul className="rater-inputs2__trace-list">
          {entries.map(([nodeId, entry]) => {
            const outVals = Object.values(entry.outputs);
            const headlineOut = outVals.length > 0 ? outVals[0] : undefined;
            const hasErr = !!entry.error;
            return (
              <li
                key={nodeId}
                className={`rater-inputs2__trace-item${hasErr ? " is-bad" : ""}`}
              >
                <span className="rater-inputs2__trace-kind">
                  {nameByNodeId?.get(nodeId) ?? traceKindLabel(entry.kindId)}
                </span>
                <span className="rater-inputs2__trace-val">
                  {hasErr
                    ? `error: ${entry.error?.message ?? "unknown"}`
                    : entry.explanation
                      ? entry.explanation
                      : fmtTrace(headlineOut)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The premium a policy row DISPLAYS (V4 plan G10): the post-tail composed
 * final (IRPM → loadings → minimum premium, computed by `evaluatePolicyBook`
 * when the plan authors a policy tail) — falling back to the pre-tail rolled
 * subtotal for no-tail books. Exported so the cold-test fixture gate can
 * assert the DISPLAYED P-001 headline equals the $4,731 oracle, not just the
 * engine result.
 */
export function policyHeadlinePremium(
  result: PolicyBookResult,
  premiumField: string | null,
): number | null {
  if (result.composed && Number.isFinite(result.composed.final)) {
    return result.composed.final;
  }
  const rolled = premiumField
    ? result.rollup.rolled[premiumField]
    : undefined;
  return typeof rolled === "number" && Number.isFinite(rolled) ? rolled : null;
}

/** Adapt a policy's `composed` roll-up tail into the minimal `PolicyResult`
 *  shape <PremiumBuildUp> reads (subtotal + adjustments + total). The book
 *  path has no policy "lines" — the contributors are LOCATIONS — so the
 *  subtotal-row tag is overridden via `subtotalTag` at the call site. */
function composedToPolicyResult(
  policyId: string,
  composed: NonNullable<PolicyBookResult["composed"]>,
): PolicyResult {
  return {
    policy_id: policyId,
    lines: [],
    subtotal: composed.subtotal,
    package_credit: 1,
    after_credit: composed.subtotal,
    minimum_premium: 0,
    minimum_applied: false,
    total: composed.final,
    adjustments: composed.adjustments,
  };
}

/**
 * Per-policy roll-up list (P2.2) — when a book is grouped by policy, each
 * policy shows its FILED premium (the composed post-tail final when a policy
 * tail is authored; the rolled subtotal otherwise) + appetite verdict,
 * expandable to the per-location breakdown, the deciding reason, and the
 * subtotal → adjustments → filed build-up. Reuses the canonical
 * <TierVerdictChip> / <PremiumBuildUp> + the same click-to-expand language
 * as the per-row trace.
 */
function PolicyList({
  results,
  premiumField,
  expanded,
  onToggle,
}: {
  readonly results: readonly PolicyBookResult[];
  readonly premiumField: string | null;
  readonly expanded: string | null;
  readonly onToggle: (policyId: string | null) => void;
}): JSX.Element {
  return (
    <div className="rater-inputs2__policies" aria-label="Policies">
      {results.map((r) => {
        const isOpen = expanded === r.policy_id;
        // ADR-0056 — a policy with unrateable locations has NO premium:
        // its rolled sum is missing those locations, so rendering it (or
        // $0) would be a plausible wrong number. error > decline > ok.
        const hasErrors = (r.row_errors ?? 0) > 0;
        const premium = hasErrors
          ? null
          : policyHeadlinePremium(r, premiumField);
        const locs = premiumField
          ? (r.rollup.breakdown[premiumField] ?? [])
          : [];
        return (
          <Fragment key={r.policy_id}>
            <button
              type="button"
              className={`rater-inputs2__policy${isOpen ? " is-open" : ""}`}
              onClick={() => onToggle(isOpen ? null : r.policy_id)}
              aria-expanded={isOpen}
            >
              <ChevronRight
                size={14}
                className="rater-inputs2__policy-caret"
                aria-hidden
              />
              <span className="rater-inputs2__policy-id">{r.policy_id}</span>
              <span className="rater-inputs2__policy-locs">
                {r.rollup.location_count} location
                {r.rollup.location_count === 1 ? "" : "s"}
              </span>
              <span className="rater-inputs2__policy-right">
                {hasErrors ? (
                  <span
                    className="rater-inputs2__policy-err"
                    title={`${r.row_errors} location${(r.row_errors ?? 0) === 1 ? "" : "s"} cannot be rated — expand for the reason`}
                  >
                    Error
                  </span>
                ) : (
                  <TierVerdictChip tier={r.appetite.tier} />
                )}
                {/* G11 — a declined policy's premium is indicative, not
                    written; it renders muted so the book headline (written
                    only) visibly excludes it. */}
                <span
                  className={`rater-inputs2__policy-prem${
                    !hasErrors && r.appetite.tier === "decline"
                      ? " is-indicative"
                      : ""
                  }`}
                  title={
                    hasErrors
                      ? "No premium — this policy has locations the plan cannot rate"
                      : r.appetite.tier === "decline"
                        ? "Indicative — the plan declines this policy; not written premium"
                        : undefined
                  }
                >
                  {premium !== null ? fmtMoney(premium) : "—"}
                </span>
              </span>
            </button>
            {isOpen ? (
              <div className="rater-inputs2__policy-detail">
                <div className="rater-inputs2__policy-reason">
                  {r.appetite.deciding?.reasoning ?? "No appetite rule applied."}
                </div>
                {locs.length > 0 ? (
                  <ul className="rater-inputs2__policy-locrows">
                    {locs.map((loc) => (
                      <li
                        key={loc.location_id}
                        className="rater-inputs2__policy-locrow"
                      >
                        <span className="rater-inputs2__policy-locid">
                          {loc.location_id}
                        </span>
                        <span className="rater-inputs2__policy-locval">
                          {loc.value !== null ? fmtMoney(loc.value) : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {/* The subtotal → adjustments → filed build-up (V4 G10) —
                    how the per-location subtotal above became the headline. */}
                {r.composed ? (
                  <PremiumBuildUp
                    result={composedToPolicyResult(r.policy_id, r.composed)}
                    subtotalTag={`${r.rollup.location_count} location${
                      r.rollup.location_count === 1 ? "" : "s"
                    }`}
                  />
                ) : null}
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

export function InputsPanelV2({
  stages,
  inputMapping,
  onMappingChange,
  requiredInputs,
  dimensions,
  plan,
  inputDtypes,
  onOpenRun,
  onInferSchema,
  policyRollupResults,
  projectionIssues,
  onEnrichBook,
  enriching,
  apiSourcedByKey,
  onOpenApiLab,
  showApiSourceDoor = true,
  bookGuardrail,
  onCohortRows,
  connectorEvaluator,
  dictionary,
  maxSampleRows = 10000,
  sampleDataset,
  onDownloadCsvTemplate,
  genesis,
}: InputsPanelV2Props): JSX.Element {
  const fields: InputFieldVM[] = stages
    .filter((s) => s.stage_kind === "input_node")
    .map((s) => {
      const cfg =
        s.config_json && typeof s.config_json === "object"
          ? (s.config_json as Record<string, unknown>)
          : {};
      return {
        id: s.stage_id,
        name: s.display_name ?? str(cfg, "field_name") ?? "Field",
        slug: str(cfg, "field_name") ?? str(cfg, "source_path") ?? "",
        type: str(cfg, "data_type") ?? "text",
        source: str(cfg, "source") ?? "form",
      };
    });

  const source = inputMapping?.source;
  const csv =
    source && source.kind === "csv" && source.columns.length > 0
      ? source
      : null;
  // P2.1 — a webhook source. Its inferred payload fields play the role CSV
  // columns play: they drive the mapping table. No sample rows are stored,
  // so there's no live preview (a webhook is fetched at Score-all time).
  const webhook = source && source.kind === "webhook" ? source : null;
  const editable = typeof onMappingChange === "function";
  // P2.3 — the plan has at least one API Lab route feeding an input. Gates the
  // "Enrich book" affordance (no route ⇒ nothing to enrich) + drives the
  // per-row "API · via {route}" provenance chips.
  const hasApiSourced = (apiSourcedByKey?.size ?? 0) > 0;

  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // book intake — a fresh upload auto-applies the
  // EXACT/NORMALIZED column matches (the demo book maps 9/9 with zero
  // clicks); fuzzy hits stay amber suggestions for a person. The flag
  // arms here and the effect below (where the candidates exist) fires
  // once per upload; Auto-recognize remains the re-run button.
  const autoApplyPendingRef = useRef(false);
  const loadCsvText = useCallback(
    async (text: string) => {
      if (!onMappingChange) return;
      setParsing(true);
      setError(null);
      const result = await parseCsvForInputsAsync(text, { maxSampleRows });
      setParsing(false);
      if (!result.ok) {
        setError(result.error?.message ?? "Could not read that CSV.");
        return;
      }
      const base = inputMapping ?? emptyPlanInputMapping();
      autoApplyPendingRef.current = true;
      onMappingChange({
        ...base,
        source: result.snapshot,
        column_map: base.column_map ?? {},
      });
    },
    [onMappingChange, inputMapping, maxSampleRows],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => void loadCsvText(String(reader.result ?? ""));
      reader.onerror = () => setError("Could not read that file.");
      reader.readAsText(file);
    },
    [loadCsvText],
  );

  const loadSample = useCallback(async () => {
    if (!sampleDataset) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch(sampleDataset.url);
      const text = await res.text();
      await loadCsvText(text);
    } catch {
      setParsing(false);
      setError("Could not load the sample dataset.");
    }
  }, [sampleDataset, loadCsvText]);

  // Brief 65 §3.6 — Replace is destructive (it wipes sample_rows,
  // including paid connector-enriched values). It arms first (a second
  // click within the bar confirms, stating the loss), and the replaced
  // book is kept for one in-session Undo from the empty dropzone.
  const [replaceArmed, setReplaceArmed] = useState(false);
  const undoBookRef = useRef<PlanInputMapping["source"] | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const replaceSource = useCallback(() => {
    if (!onMappingChange || !inputMapping) return;
    if (!replaceArmed) {
      setReplaceArmed(true);
      return;
    }
    undoBookRef.current = inputMapping.source;
    setUndoAvailable(true);
    setReplaceArmed(false);
    onMappingChange({
      ...inputMapping,
      source: { kind: "csv", columns: [], sample_rows: [] },
    });
    setError(null);
  }, [onMappingChange, inputMapping, replaceArmed]);
  const undoReplace = useCallback(() => {
    const kept = undoBookRef.current;
    if (!kept || !onMappingChange) return;
    const base = inputMapping ?? emptyPlanInputMapping();
    onMappingChange({ ...base, source: kept });
    undoBookRef.current = null;
    setUndoAvailable(false);
  }, [onMappingChange, inputMapping]);

  // ── Source-mode switches (P2.1) ────────────────────────────────
  const switchToWebhook = useCallback(() => {
    if (!onMappingChange) return;
    const base = inputMapping ?? emptyPlanInputMapping();
    onMappingChange({
      ...base,
      source: emptyWebhookConfig(),
      column_map: base.column_map ?? {},
    });
    setError(null);
  }, [onMappingChange, inputMapping]);
  const switchToCsv = useCallback(() => {
    if (!onMappingChange) return;
    const base = inputMapping ?? emptyPlanInputMapping();
    onMappingChange({
      ...base,
      source: { kind: "csv", columns: [], sample_rows: [] },
      column_map: base.column_map ?? {},
    });
    setError(null);
  }, [onMappingChange, inputMapping]);
  const handleWebhookChange = useCallback(
    (cfg: WebhookConfig) => {
      if (!onMappingChange || !inputMapping) return;
      onMappingChange({ ...inputMapping, source: cfg });
    },
    [onMappingChange, inputMapping],
  );

  // G12 — the parser caps sample_rows at maxSampleRows but records the
  // original file size in totalRowCount. When they differ the book was
  // truncated at upload: only loadedRowCount rows exist to score, and every
  // count on the surface must say so instead of promising the full file.
  const loadedRowCount = csv?.sample_rows?.length ?? 0;
  const rowCount =
    csv && typeof csv.totalRowCount === "number"
      ? csv.totalRowCount
      : loadedRowCount;
  const bookTruncated = rowCount > loadedRowCount;

  // ── Mapping (Phase B) ──────────────────────────────────────────
  const columnMap = useMemo(
    () => inputMapping?.column_map ?? {},
    [inputMapping],
  );
  const sampleRows = useMemo(
    () => (csv ? (csv.sample_rows ?? []) : []),
    [csv],
  );
  // Source columns drive the mapping table — CSV headers OR the webhook's
  // inferred payload fields (P2.1).
  const sourceColumns = useMemo(
    () =>
      csv
        ? csv.columns.map((c) => ({ name: c }))
        : webhook
          ? webhook.payload_schema.fields.map((f) => ({ name: f.name }))
          : [],
    [csv, webhook],
  );
  // Bare names for the per-row mapping <select>s — source-agnostic, so a
  // webhook's inferred fields populate the dropdowns exactly like CSV headers.
  const columnNames = useMemo(
    () => sourceColumns.map((c) => c.name),
    [sourceColumns],
  );
  // Only inputs + dimensions bind to a source column; factors/models are
  // computed downstream, so they don't belong in the column-mapping table.
  const mappingInputs = useMemo(() => {
    // Brief 89 R8 — an UNDECLARED unset chain constant (column-shaped
    // LCM) is a Rating repair, not a mappable/declarable input: keep
    // it out of the unified VM. Declaring it deliberately (the E10e
    // column-shaped path) re-admits it.
    const declared = new Set(
      (dictionary?.inputs ?? []).map((e) => e.fieldName),
    );
    return (requiredInputs ?? []).filter(
      (r) =>
        (r.category === "inputs" || r.category === "dimensions") &&
        !(r.constantSlot === true && !declared.has(r.id)),
    );
  }, [requiredInputs, dictionary?.inputs]);
  const candidates = useMemo<Record<string, readonly MatchCandidate[]>>(
    () =>
      mappingInputs.length > 0 && sourceColumns.length > 0
        ? autoMatchColumns(
            mappingInputs,
            sourceColumns,
            sampleRows,
            dimensions ?? [],
          )
        : {},
    [mappingInputs, sourceColumns, sampleRows, dimensions],
  );
  const mappedCount = mappingInputs.filter((r) => columnMap[r.id]).length;

  // book intake — the armed upload applies exact matches
  // the moment the candidates exist. One firing per upload; existing
  // mappings are never overwritten (applyAutoMatchToMapping's law).
  useEffect(() => {
    if (!autoApplyPendingRef.current) return;
    if (!onMappingChange || !inputMapping) return;
    if (mappingInputs.length === 0 || sourceColumns.length === 0) return;
    autoApplyPendingRef.current = false;
    const result = applyAutoMatchToMapping(
      mappingInputs,
      candidates,
      columnMap,
      { mode: "exact" },
    );
    if (Object.keys(result.mapping).length !== Object.keys(columnMap).length) {
      onMappingChange({ ...inputMapping, column_map: result.mapping });
    }
  }, [
    candidates,
    mappingInputs,
    sourceColumns,
    columnMap,
    inputMapping,
    onMappingChange,
  ]);

  // book intake — the pre-flight sentence above the Match table:
  // leftovers (ignored columns), fuzzy suggestions, and missing
  // required inputs, minus whatever a person already mapped by hand.
  // Same derivation + same sentence the chat door refuses with.
  const preflightLine = useMemo(() => {
    if (sourceColumns.length === 0 || mappingInputs.length === 0) return null;
    const requiredByField = new Map(
      (dictionary?.inputs ?? []).map((d) => [d.fieldName, d.required]),
    );
    const p = preflightHeader(
      sourceColumns.map((c) => c.name),
      mappingInputs.map((r) => ({
        name: r.id,
        display_name: r.name !== r.id ? r.name : null,
        required: requiredByField.get(r.id) ?? false,
      })),
    );
    const usedColumns = new Set(
      Object.values(columnMap).filter((v): v is string => typeof v === "string"),
    );
    const mappedIds = new Set(
      Object.entries(columnMap)
        .filter(([, v]) => Boolean(v))
        .map(([k]) => k),
    );
    const suggested = p.suggested.filter(
      (s) => !mappedIds.has(s.input) && !usedColumns.has(s.column),
    );
    return {
      suggestionFor: new Map(suggested.map((s) => [s.input, s.column])),
      sentence: composePreflightSentence({
        unknown: p.unknown.filter((c) => !usedColumns.has(c)),
        missing: p.missing.filter((i) => !mappedIds.has(i)),
        suggested,
        note: p.note,
      }),
    };
  }, [sourceColumns, mappingInputs, dictionary?.inputs, columnMap]);

  const handleMapColumn = useCallback(
    (inputId: string, columnName: string) => {
      if (!onMappingChange || !inputMapping) return;
      const next = { ...columnMap };
      if (columnName) next[inputId] = columnName;
      else delete next[inputId];
      onMappingChange({ ...inputMapping, column_map: next });
    },
    [onMappingChange, inputMapping, columnMap],
  );

  // ── Derived-ratio binding (P2.5) ───────────────────────────────
  // Bind an input to colA ÷ colB (the `@ratio:` sentinel, Brief 45 K8) —
  // for a banded input the data carries the components, not the ratio.
  // Hidden until chosen: a "Ratio…" option seeds it with the first two
  // columns, then a compact A ÷ B picker edits it in place.
  const handleStartRatio = useCallback(
    (inputId: string) => {
      const cols = csv?.columns ?? [];
      if (cols.length < 2) return;
      handleMapColumn(inputId, formatRatio(cols[0]!, cols[1]!));
    },
    [csv, handleMapColumn],
  );
  const handleSetRatio = useCallback(
    (inputId: string, numerator: string, denominator: string) => {
      handleMapColumn(inputId, formatRatio(numerator, denominator));
    },
    [handleMapColumn],
  );

  const handleAutoRecognize = useCallback(() => {
    if (!onMappingChange || !inputMapping) return;
    const result = applyAutoMatchToMapping(mappingInputs, candidates, columnMap);
    onMappingChange({ ...inputMapping, column_map: result.mapping });
  }, [onMappingChange, inputMapping, mappingInputs, candidates, columnMap]);

  /** The auto-match bucket for the column currently bound to an input. */
  const bucketFor = useCallback(
    (inputId: string, columnName: string): MatchCandidate["bucket"] | null => {
      const c = candidates[inputId]?.find((x) => x.columnName === columnName);
      return c ? c.bucket : null;
    },
    [candidates],
  );

  // ── Mismatch detection (P1) ────────────────────────────────────
  // A mapped column whose values aren't in the dim's levels silently scores
  // as 1.0 — surface it on the row, not in a banner stack.
  const aliasOverrides = useMemo(
    () => inputMapping?.alias_overrides ?? {},
    [inputMapping],
  );
  const mismatches = useMemo(
    () =>
      mappingInputs.length > 0 && sampleRows.length > 0 && sourceColumns.length > 0
        ? detectMismatches(
            mappingInputs,
            columnMap,
            sampleRows,
            dimensions ?? [],
            aliasOverrides,
          )
        : [],
    [mappingInputs, columnMap, sampleRows, sourceColumns, dimensions, aliasOverrides],
  );
  const mismatchByInput = useMemo(() => {
    const m = new Map<string, Mismatch>();
    for (const mm of mismatches) m.set(mm.inputId, mm);
    return m;
  }, [mismatches]);
  const [expandedMismatch, setExpandedMismatch] = useState<string | null>(null);
  const handleAlias = useCallback(
    (dimSlug: string, value: string, levelId: string) => {
      if (!onMappingChange || !inputMapping) return;
      onMappingChange({
        ...inputMapping,
        alias_overrides: applyAliasOverride(
          aliasOverrides,
          dimSlug,
          value,
          levelId,
        ),
      });
    },
    [onMappingChange, inputMapping, aliasOverrides],
  );

  // The mapping table shows for a CSV book OR a webhook with inferred fields.
  const showMapping =
    (csv !== null || (webhook !== null && webhook.payload_schema.fields.length > 0)) &&
    mappingInputs.length > 0;

  // ── Live scoring preview (Phase C) ─────────────────────────────
  // `premiumField` stays the SINGLE-column answer: the grouping
  // roll-up config below (`groupTotalField`) declares it to the book
  // runner, and a declared premium-named roll-up is an explicit basis
  // that wins over the plan's own declarations (#483) — declaring the
  // synthesized `coverage_sum_premium` there would roll a column no
  // engine output carries. The preview instead reads the plan's
  // declarations directly (93.4).
  const premiumField = useMemo(
    () => (plan ? resolvePremiumColumn(plan) : null),
    [plan],
  );
  // What the PLAN declares, classified from the authored STAGES — the
  // same authority /score uses. A total-less multi-coverage filing has
  // no premium output at all: the risk's price is the sum of its towers,
  // and `premiumField` above would name the LAST one ($72 of a $267 risk).
  const planPremium = useMemo(
    () => (plan ? resolvePlanPremiumContext(plan, stages) : null),
    [plan, stages],
  );
  const coverageSum =
    planPremium !== null && isTotalLessMultiCoverage(planPremium);
  const inputDimMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of requiredInputs ?? []) if (r.dimSlug) out[r.id] = r.dimSlug;
    return out;
  }, [requiredInputs]);
  const scored = useMemo(() => {
    if (!plan || !premiumField || !csv || sampleRows.length === 0) return null;
    // Only a plan with a multiplicative rating chain COMPUTES a premium;
    // an echo plan would emit the inputs back as bogus "premiums".
    const hasChain = plan.nodes?.some((n) => n.kind === "chain.mult");
    if (!hasChain) return null;
    const slice = sampleRows.slice(0, 8);
    // book intake — the preview scores through the SAME alias
    // vocabulary the mismatch resolve writes, so "translate → watch
    // rows go green" is one loop, not two surfaces.
    const projectOpts = {
      inputDimMap,
      ...(inputDtypes ? { inputDtypes } : {}),
      ...(aliasOverrides ? { aliasOverrides } : {}),
    };
    const externalInputs = projectRowsToExternalInputs(
      // CSV sample cells are strings; the source snapshot types them as
      // unknown. The projector coerces via inputDtypes downstream.
      slice as readonly Readonly<Record<string, string>>[],
      columnMap,
      projectOpts,
    );
    let results: readonly RunResult[] = [];
    try {
      results = executePlanBatch(plan, externalInputs);
    } catch {
      // A malformed plan / projection shouldn't crash the panel.
      results = [];
    }
    // Parity (Brief 62.4) — apply the plan's Final-adjustments tail (IRPM /
    // schedule rating → package mods → endorsements → min premium) to each
    // row's aggregated premium, so the preview shows the FILED premium (what
    // Score-all + Analytics file), not just the raw chain output. No-op for
    // no-tail plans (filed === aggregated); degrades to the chain premium if a
    // model/connector-sourced tail can't resolve yet (mirrors v1's pane).
    // 93.4 — `planPremium` makes the tail total-less-aware: a total-less
    // plan aggregates as the dec-page SUM of its towers, and a tail over
    // one is the named Law-2 refusal (never a tax on the last tower).
    let tails: readonly CohortRowTail[] | null = null;
    try {
      tails = applyCohortPolicyTail({
        plan,
        rows: externalInputs as readonly Record<string, unknown>[],
        results,
        premiumColumn: premiumField,
        planPremium,
        ...(connectorEvaluator ? { connectorEvaluator } : {}),
      });
    } catch {
      tails = null;
    }
    // Per-row audit detail (P1.3): the FILED premium, the eligibility verdict
    // (resolved from the row's gate trace), and the full RunResult so a
    // click can surface the factor build-up. resolveEligibilityTier is the
    // canonical contract helper (matched-rule beats default; worst tier
    // wins) — NOT a local re-implementation, so v2 can't drift from it.
    // The pre-tail premium, used only if the tail helper threw (an
    // unresolvable model/connector source). It must not resurrect the
    // last tower for a total-less plan — the whole point of 93.4.
    const aggregatedOf = (r: RunResult): number | null => {
      // Law 2 / G8 — an error row derives no money, and its surviving
      // towers must not be summed into one.
      if (r.row_status === "error") return null;
      if (coverageSum && planPremium !== null) {
        return sumMoneyFields(r.outputs, planPremium.moneyFields);
      }
      const raw = r.outputs[premiumField];
      return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    };
    const rows = results.map((r, i) => {
      const t = tails?.[i];
      // Law 2 — a refused composition files NO number. Never fall back
      // to the pre-tail premium: that is the silent-improvise the
      // refusal exists to kill.
      const refusal = t?.refusal ?? null;
      const filed = t ? t.filed : null;
      const premium =
        refusal !== null
          ? null
          : tails !== null
            ? typeof filed === "number" && Number.isFinite(filed)
              ? filed
              : null
            : aggregatedOf(r);
      return {
        premium,
        tier: resolveEligibilityTier(r.trace),
        result: r,
        refusal,
      };
    });
    const valid = rows
      .map((row) => row.premium)
      .filter((p): p is number => p !== null);
    const avg = valid.length
      ? valid.reduce((a, b) => a + b, 0) / valid.length
      : null;
    // P2.8 — distribution stats (min/median/max) for the headline. Shown
    // only when there's real spread (min !== max); reuses the v1 median
    // convention. An at-a-glance read of the sample's range vs the chips.
    const sortedP = [...valid].sort((a, b) => a - b);
    const min = sortedP.length ? sortedP[0]! : null;
    const max = sortedP.length ? sortedP[sortedP.length - 1]! : null;
    const median = sortedP.length
      ? sortedP.length % 2 === 0
        ? (sortedP[sortedP.length / 2 - 1]! + sortedP[sortedP.length / 2]!) / 2
        : sortedP[(sortedP.length - 1) / 2]!
      : null;
    // Out-of-range banded values, clamped at score time (cold-test L22) —
    // the clamp must never be silent. Reuses the shared detector.
    const outOfRange = detectOutOfRange(plan, results);
    return {
      rows,
      avg,
      min,
      max,
      median,
      scoredCount: valid.length,
      sampleSize: slice.length,
      outOfRange,
      declinedCount: rows.filter((row) => row.tier === "decline").length,
      // ADR-0056 — rows the plan CANNOT rate (error ≠ declined ≠ $0).
      errorCount: rows.filter((row) => row.result.row_status === "error")
        .length,
      // Law 2 (93.4) — the named reason NO row can file a premium. It is
      // plan-level (a tail over a total-less plan), so it refuses every
      // row identically ⇒ `avg` is null ⇒ `canScore` is false, and the
      // empty state is the ONE place it can surface. Distinct from
      // errorCount: those rows failed in the ENGINE; these rated fine
      // and failed to COMPOSE (mirrors scoreOne's composition_failed).
      compositionRefusal:
        rows.find((row) => row.refusal !== null)?.refusal ?? null,
    };
  }, [
    plan,
    premiumField,
    planPremium,
    coverageSum,
    csv,
    sampleRows,
    columnMap,
    inputDimMap,
    inputDtypes,
    aliasOverrides,
    connectorEvaluator,
  ]);

  // Cost-guardrail parity — project the FULL book (not the 8-row preview slice)
  // so the mount can price the connector cost guardrail + pre-fetch each row's
  // connector data. Projection is column-mapping only (no scoring) → cheap;
  // memoized. Only computed when a consumer wants the rows.
  const cohortExternalInputs = useMemo(() => {
    if (!onCohortRows || sampleRows.length === 0) return null;
    return projectRowsToExternalInputs(
      sampleRows as readonly Readonly<Record<string, string>>[],
      columnMap,
      {
        inputDimMap,
        ...(inputDtypes ? { inputDtypes } : {}),
        ...(aliasOverrides ? { aliasOverrides } : {}),
      },
    );
  }, [onCohortRows, sampleRows, columnMap, inputDimMap, inputDtypes, aliasOverrides]);
  // Fire onCohortRows only when the projection actually changes (ref-guarded,
  // mirrors v1's ScoringPreviewPane) — never on every render, no setState loop.
  const lastCohortKey = useRef<string>("");
  useEffect(() => {
    if (!onCohortRows || !cohortExternalInputs) return;
    const key = JSON.stringify(cohortExternalInputs);
    if (key === lastCohortKey.current) return;
    lastCohortKey.current = key;
    onCohortRows(cohortExternalInputs);
  }, [onCohortRows, cohortExternalInputs]);

  // Brief 65 §3.5 — the trace labels rating steps by the author's display
  // names; nodeIds that match a stage id resolve, the rest fall back to
  // plain kind labels inside <TraceCard>.
  const stageNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stages) {
      if (s.display_name) m.set(s.stage_id, s.display_name);
    }
    return m;
  }, [stages]);

  const canScore = scored !== null && scored.avg !== null;
  // P1.3 — one row's factor trace expands inline under the strip (mirrors
  // the mismatch-row disclosure). Click toggles; opening a new row swaps.
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // ── Policy grouping + roll-up (P2.2 → Brief 80 D-A) ─────────────
  // The config lives on inputMapping; the Policies card in the mapping
  // act is the ONE authoring home (finding E7 — the old quiet offer
  // was gated on a completed score and the config was invisible once
  // on). Active grouping swaps the per-row strip for a per-policy
  // list; the mount computes policyRollupResults.
  const groupingActive = !!inputMapping?.grouping_config?.policy_id_column;
  const policyResults = policyRollupResults ?? [];
  // Auto-detected key columns — drives the collapsed offer's copy.
  const detectedGrouping = useMemo<PolicyGroupingConfig>(
    () => (csv ? autoDetectGrouping(csv.columns) : {}),
    [csv],
  );
  // Brief 80 D-C — the policy premium rolls the plan's TOTAL, derived
  // (round.output_field ‖ the projected plan's premium output), never
  // guessed from column names.
  //
  // ⭐ `null` for the total-less transcription: the plan HAS no total,
  // and naming one here is worse than naming none. Every composer reads
  // a premium-NAMED roll-up as the author's explicit basis
  // (`isCoverageSumBook`), so a config carrying `premiumField` — the
  // LAST tower — would suppress the dec-page sum and file $72 of a $267
  // dec page. Declaring nothing is what lets the sum happen.
  const groupTotalField = useMemo(
    () =>
      coverageSum
        ? null
        : stages.some((s) => s.stage_kind === "round")
          ? planTotalOutputField(stages)
          : (premiumField ?? planTotalOutputField(stages)),
    [coverageSum, stages, premiumField],
  );
  // Extra roll-ups (a TIV-like column) still come from the suggester;
  // the premium leg is the derived total above.
  const suggestedRollups = useMemo<readonly RollupFieldSpec[]>(() => {
    const extras = suggestRollupFields(csv?.columns ?? []).filter(
      (f) => f.fieldName !== groupTotalField,
    );
    // Total-less: nothing premium-named may be SUGGESTED. The suggester
    // name-matches book COLUMNS, so a book carrying its own `premium`
    // column would auto-declare the very basis that suppresses the sum
    // — the same bug by another door. The card's add-a-field picker
    // stays the author's explicit escape hatch; the composers honor a
    // hand-declared basis by design.
    if (groupTotalField === null) {
      return extras.filter((f) => declaredPremiumRollup([f.fieldName]) === null);
    }
    return [
      { fieldName: groupTotalField, reducer: "sum" as const },
      ...extras,
    ];
  }, [csv, groupTotalField]);
  const enableGrouping = useCallback(() => {
    if (!onMappingChange || !inputMapping) return;
    onMappingChange({
      ...inputMapping,
      // No detection ⇒ enable with the FIRST column selected so the
      // card's picker opens on a real value (the escape hatch — the
      // user re-picks in place).
      grouping_config: detectedGrouping.policy_id_column
        ? detectedGrouping
        : { policy_id_column: csv?.columns[0] ?? "" },
      rollup_fields: suggestedRollups,
    });
  }, [onMappingChange, inputMapping, detectedGrouping, suggestedRollups, csv]);
  const disableGrouping = useCallback(() => {
    if (!onMappingChange || !inputMapping) return;
    const { grouping_config: _g, rollup_fields: _r, ...rest } = inputMapping;
    onMappingChange(rest);
  }, [onMappingChange, inputMapping]);
  // Brief 80 — the card's edit callbacks. The D-C invariant rides
  // every write: the derived total is always among the rolled fields.
  const handleGroupingChange = useCallback(
    (next: PolicyGroupingConfig) => {
      if (!onMappingChange || !inputMapping) return;
      onMappingChange({ ...inputMapping, grouping_config: next });
    },
    [onMappingChange, inputMapping],
  );
  const handleRollupsChange = useCallback(
    (next: readonly RollupFieldSpec[]) => {
      if (!onMappingChange || !inputMapping) return;
      // The D-C invariant rides every write — EXCEPT on a total-less
      // plan, which has no total to assert (re-asserting the last
      // tower on every edit is how the wrong basis kept coming back).
      const withTotal =
        groupTotalField === null ||
        next.some((f) => f.fieldName === groupTotalField)
          ? next
          : [{ fieldName: groupTotalField, reducer: "sum" as const }, ...next];
      onMappingChange({ ...inputMapping, rollup_fields: withTotal });
    },
    [onMappingChange, inputMapping, groupTotalField],
  );
  // The honesty line — sample rows whose policy-key cell is blank.
  const rowsMissingPolicyId = useMemo(() => {
    const col = inputMapping?.grouping_config?.policy_id_column;
    if (!col || !csv?.sample_rows) return null;
    return csv.sample_rows.filter((r) => {
      const v = (r as Readonly<Record<string, unknown>>)[col];
      return v === undefined || v === null || String(v).trim() === "";
    }).length;
  }, [inputMapping, csv]);
  // The rolled field shown as the headline per policy (the premium).
  const policyPremiumField = useMemo(() => {
    // Total-less: the headline is the SYNTHESIZED dec-page sum, which
    // the producer materializes into each policy's rolled map under
    // COVERAGE_SUM_COLUMN (the same name the run summary advertises as
    // `premium_field`). Falling through would headline `rolled[0]` —
    // a TIV column — now that no premium leg is declared.
    if (coverageSum) return COVERAGE_SUM_COLUMN;
    const rolled = inputMapping?.rollup_fields ?? [];
    if (premiumField && rolled.some((f) => f.fieldName === premiumField))
      return premiumField;
    return rolled[0]?.fieldName ?? premiumField ?? null;
  }, [coverageSum, inputMapping, premiumField]);
  const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null);
  // Policy-level headline — written premium across the book + counts. Each
  // policy contributes its DISPLAYED premium (composed post-tail final when
  // a policy tail is authored, else the rolled subtotal — V4 G10). G11: a
  // declined policy's premium is INDICATIVE, never written — it stays out
  // of the headline and is reported as its own figure, so the headline
  // equals the sum of the non-declined rows below it.
  const policyTotals = useMemo(() => {
    if (!groupingActive || policyResults.length === 0) return null;
    let written = 0;
    let declinedIndicative = 0;
    let declinedPolicies = 0;
    let errorPolicies = 0;
    let locations = 0;
    for (const r of policyResults) {
      locations += r.rollup.location_count;
      // ADR-0056 — a policy with unrateable locations contributes to NO
      // total (its rolled sum is partial): error > decline > ok.
      if ((r.row_errors ?? 0) > 0) {
        errorPolicies += 1;
        continue;
      }
      const v = policyHeadlinePremium(r, policyPremiumField);
      const declined = r.appetite.tier === "decline";
      if (declined) declinedPolicies += 1;
      if (v !== null) {
        if (declined) declinedIndicative += v;
        else written += v;
      }
    }
    return {
      written,
      declinedIndicative,
      declinedPolicies,
      errorPolicies,
      policies: policyResults.length,
      locations,
    };
  }, [groupingActive, policyResults, policyPremiumField]);

  // The rolled fields — read here for the preview's summary line;
  // EDITING lives in the Policies card (Brief 80 D-A retired the
  // P2.2b "Adjust" reveal, a second writer of the same config).
  const rollupFields = inputMapping?.rollup_fields ?? [];
  // What the summary line SAYS each policy rolls. A total-less plan
  // declares no premium basis — that absence is exactly what lets the
  // composers sum the dec page — so the coverages are stated first.
  // Reading the declarations alone would print "nothing yet" over a
  // list that is headlining real summed premiums.
  const rollupSummaryParts = useMemo(() => {
    const declared = rollupFields.map((f) => `${f.fieldName} (${f.reducer})`);
    if (!coverageSum) return declared;
    return [`${(planPremium?.moneyFields ?? []).join(" + ")} (sum)`, ...declared];
  }, [coverageSum, planPremium, rollupFields]);

  // ── Declare-from-context (P0.2) ────────────────────────────────
  // One contextual declare action in the dictionary head — no new surface.
  const declaredFieldNames = useMemo(
    () => new Set((dictionary?.inputs ?? []).map((e) => e.fieldName)),
    [dictionary],
  );
  // Book columns that aren't bound to any field AND aren't already declared —
  // the candidates to declare as new inputs (in either the dictionary head,
  // or the mapping head as "unmapped").
  const declarableCols = useMemo(() => {
    if (!csv) return [];
    const used = new Set(Object.values(columnMap));
    return csv.columns.filter((c) => !used.has(c) && !declaredFieldNames.has(c));
  }, [csv, columnMap, declaredFieldNames]);
  // Brief 89 §2.2 — identifier honesty for declare-from-book: a column
  // whose values LOOK numeric but carry leading zeros ("09331" class
  // codes, ZIPs) is an identifier — declaring it Number would eat the
  // zero. sample_rows keep the raw strings, so this is data truth, not
  // a name heuristic.
  const declaredDtypeFor = useCallback(
    (column: string): PrimitiveType => {
      const dtypes =
        (csv as { dtypes?: Record<string, unknown> } | null)?.dtypes ?? {};
      const inferred = csvDtypeToPrimitive(dtypes[column]);
      if (inferred !== "float" && inferred !== "int") return inferred;
      const rows = (csv?.sample_rows ?? []) as readonly Readonly<
        Record<string, unknown>
      >[];
      const leadingZero = rows.some((r) =>
        /^0\d+$/.test(String(r[column] ?? "").trim()),
      );
      return leadingZero ? "string" : inferred;
    },
    [csv],
  );
  const declareCols = useCallback(() => {
    const onBulkAdd = dictionary?.onBulkAdd;
    if (!onBulkAdd || declarableCols.length === 0) return;
    onBulkAdd(
      declarableCols.map((c) => ({
        id: "",
        fieldName: c,
        displayName: prettify(c),
        dataType: declaredDtypeFor(c),
        source: "form" as const,
        required: true,
      })),
    );
    // Brief 89 §2.2 — the declared field IS the column (fieldName ===
    // column), so the match is identity, not fuzz: extend column_map in
    // the same click. Without this the payoff lands at "0 of N mapped"
    // and the user is sent to Auto-recognize for a deterministic no-op.
    if (onMappingChange && inputMapping) {
      const additions = Object.fromEntries(
        declarableCols.map((c) => [c, c] as const),
      );
      onMappingChange({
        ...inputMapping,
        column_map: { ...inputMapping.column_map, ...additions },
      });
    }
  }, [
    dictionary,
    declarableCols,
    declaredDtypeFor,
    onMappingChange,
    inputMapping,
  ]);
  // Dictionary head: declare-from-book when a connected book has fresh
  // columns; otherwise declare the rating structure's missing fields.
  const dictDeclare = useMemo(() => {
    if (csv && declarableCols.length > 0 && dictionary?.onBulkAdd) {
      return {
        count: declarableCols.length,
        label: `Add ${declarableCols.length} book column${declarableCols.length === 1 ? "" : "s"} as inputs`,
        onDeclare: declareCols,
      };
    }
    const n = dictionary?.undeclaredCount ?? 0;
    if (n > 0 && dictionary?.onDeclareAll) {
      return {
        count: n,
        label: `Declare ${n} missing`,
        onDeclare: dictionary.onDeclareAll,
      };
    }
    return null;
  }, [csv, declarableCols, dictionary, declareCols]);
  // ── Brief 65 §3.2 — the unified input view-model glue ──────────
  // One vocabulary across acts: the dictionary's display names label the
  // mapping rows; the structure's reads mark dictionary rows as used;
  // structure-required-but-undeclared inputs become ghost rows in act 1.
  const usedSlugs = useMemo(
    () => new Set(mappingInputs.map((r) => r.id)),
    [mappingInputs],
  );
  const dictNameBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of dictionary?.inputs ?? []) m.set(e.fieldName, e.displayName);
    return m;
  }, [dictionary?.inputs]);
  const ghostInputs = useMemo<readonly GhostInput[]>(() => {
    if (!dictionary) return [];
    return mappingInputs
      .filter((r) => !declaredFieldNames.has(r.id))
      .map((r) => ({
        slug: r.id,
        name: r.name,
        requiredBy: r.subLabel ?? "the rating structure",
        dtype: (r.dtype === "number" ? "float" : "string") as PrimitiveType,
      }));
  }, [dictionary, mappingInputs, declaredFieldNames]);
  const handleDeclareGhost = useCallback(
    (g: GhostInput) => {
      dictionary?.onUpsert?.({
        id: "",
        fieldName: g.slug,
        displayName: prettify(g.slug),
        dataType: g.dtype,
        source: "form",
        required: true,
      });
    },
    [dictionary],
  );
  // Act 1 collapses to a summary bar once a source is connected (the
  // mapping act re-lists every input; stacking both full tables would
  // double the page). The user's explicit toggle wins over the auto rule.
  const hasSource = csv !== null || webhook !== null;
  const [dictOpenPref, setDictOpenPref] = useState<boolean | null>(null);
  const dictOpen = dictOpenPref ?? !hasSource;

  // ── Brief 89 — genesis (R2–R4) + the promoted bridge (§2.2) ──────
  // The mount vouches the plan is structurally empty (`genesis` prop);
  // the panel adds the live checks. Taking the data door reveals the
  // source act in place; the block dissolves the moment a source or a
  // declaration exists (R2 — no stored mode, no wizard).
  const dictEmpty =
    (dictionary ? dictionary.inputs.length : fields.length) === 0;
  const [dataDoorTaken, setDataDoorTaken] = useState(false);
  const genesisIdle =
    genesis !== undefined && !hasSource && dictEmpty && !dataDoorTaken;
  const genesisSourceStage =
    genesis !== undefined && !hasSource && dictEmpty && dataDoorTaken;
  // Copy variant: at genesis the dropzone speaks authoring ("columns
  // become typed inputs"), not scoring — Run owns score language (§6).
  const genesisCopy = genesis !== undefined && dictEmpty && !hasSource;
  // §2.2 — the bridge is promoted to the payoff position whenever a
  // book lands on an empty dictionary: a standalone primary card, never
  // an affordance behind the collapsed act summary (F2).
  const bridgePromo =
    dictEmpty &&
    csv !== null &&
    declarableCols.length > 0 &&
    dictionary?.onBulkAdd !== undefined &&
    editable;
  const bridgeReceipt = useMemo(() => {
    if (!bridgePromo) return null;
    const counts = new Map<string, number>();
    for (const c of declarableCols) {
      const p = declaredDtypeFor(c);
      const label =
        p === "float" || p === "int"
          ? "number"
          : p === "bool"
            ? "yes/no"
            : p === "date"
              ? "date"
              : "text";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const parts = ["number", "text", "yes/no", "date"]
      .filter((l) => counts.has(l))
      .map((l) => `${counts.get(l)} ${l}`);
    return `${declarableCols.length} column${declarableCols.length === 1 ? "" : "s"} · ${parts.join(" · ")} — types inferred from your rows; refine anytime.`;
  }, [bridgePromo, declarableCols, declaredDtypeFor]);

  // ── Act 2 — Book of business (the connect step). The section shows the
  // connected book even when read-only (it's information); only the write
  // affordances (Replace, dropzone) gate on `editable`. POSITION is
  // state-adaptive (Brief 65 §3.1 follow-up, browser-verified): with a
  // populated dictionary and NO book, the connect affordance must not sit
  // below a 12-row table — it renders ABOVE the dictionary; once a book
  // exists (or the plan is brand-new), the declare act leads.
  const sourceSection =
    csv || webhook || editable ? (
        <section className="rater-inputs2__source" aria-label="Data source">
          {webhook ? (
            <WebhookSource
              value={webhook}
              onChange={handleWebhookChange}
              onInfer={onInferSchema}
              editable={editable}
              onUseCsv={switchToCsv}
            />
          ) : csv ? (
            <>
            <div className="rater-inputs2__book">
              <span className="rater-inputs2__book-icon" aria-hidden>
                <FileSpreadsheet size={18} />
              </span>
              <div className="rater-inputs2__book-body">
                <div className="rater-inputs2__book-title">Book of business</div>
                <div className="rater-inputs2__book-meta">
                  {bookTruncated
                    ? `${loadedRowCount.toLocaleString()} of ${rowCount.toLocaleString()} rows loaded`
                    : `${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"}`}{" "}
                  · {csv.columns.length} column
                  {csv.columns.length === 1 ? "" : "s"}
                </div>
              </div>
              {editable ? (
                <div className="rater-inputs2__book-acts">
                  {onDownloadCsvTemplate ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<FileDown />}
                      onClick={onDownloadCsvTemplate}
                    >
                      CSV template
                    </Button>
                  ) : null}
                  {/* P2.3 — enrich the book from the plan's API Lab route(s).
                      Shown only when a route actually feeds an input. */}
                  {onEnrichBook && hasApiSourced ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Sparkles />}
                      loading={!!enriching}
                      onClick={() => {
                        if (inputMapping) void onEnrichBook(inputMapping);
                      }}
                    >
                      {enriching ? "Filling from API Lab…" : "Fill from API Lab"}
                    </Button>
                  ) : null}
                  <Button
                    variant={replaceArmed ? "danger-text" : "ghost"}
                    size="sm"
                    icon={<RotateCcw />}
                    onClick={replaceSource}
                    onMouseLeave={() => setReplaceArmed(false)}
                  >
                    {replaceArmed
                      ? `Discard ${loadedRowCount.toLocaleString()} row${loadedRowCount === 1 ? "" : "s"}?`
                      : "Replace"}
                  </Button>
                </div>
              ) : null}
            </div>
            {/* G12 — a capped book is never silent: the rows beyond the
                parse cap were discarded at upload and cannot be scored. */}
            {bookTruncated ? (
              <div className="rater-inputs2__book-capped" role="status">
                <AlertTriangle size={12} aria-hidden />
                <span>
                  Book capped at upload — the first{" "}
                  {loadedRowCount.toLocaleString()} of{" "}
                  {rowCount.toLocaleString()} rows were kept;{" "}
                  {(rowCount - loadedRowCount).toLocaleString()} rows beyond
                  the cap were discarded and will not be scored. Split the
                  file to rate the full book.
                </span>
              </div>
            ) : null}
            </>
          ) : (
            <div
              className={`rater-inputs2__dropzone${
                dragOver ? " is-dragover" : ""
              }`}
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onFiles(e.dataTransfer.files);
              }}
            >
              <span className="rater-inputs2__dropzone-icon" aria-hidden>
                <Upload size={18} />
              </span>
              <div className="rater-inputs2__dropzone-copy">
                <span className="rater-inputs2__dropzone-title">
                  {parsing
                    ? "Reading book…"
                    : genesisCopy
                      ? "Drop a book of business (CSV)"
                      : "Drop a CSV to score a book"}
                </span>
                <span className="rater-inputs2__dropzone-hint">
                  {genesisCopy
                    ? "Columns become typed inputs — rows preview premiums as you build · or click to browse"
                    : "or click to browse"}
                  {sampleDataset ? " · or use a sample" : ""}
                </span>
              </div>
              {undoAvailable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RotateCcw />}
                  onClick={(e) => {
                    e.stopPropagation();
                    undoReplace();
                  }}
                >
                  Undo replace
                </Button>
              ) : null}
              {sampleDataset ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    void loadSample();
                  }}
                >
                  {sampleDataset.label ?? "Use sample"}
                </Button>
              ) : null}
              {onDownloadCsvTemplate ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<FileDown />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownloadCsvTemplate();
                  }}
                >
                  CSV template
                </Button>
              ) : null}
              {/* P2.1 — the other source mode: fetch from an API.
                  / — the door follows the API Lab flag
                  (the consumer decides; default on for back-compat). */}
              {editable && showApiSourceDoor ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Globe />}
                  onClick={(e) => {
                    e.stopPropagation();
                    switchToWebhook();
                  }}
                >
                  Fetch from an API
                </Button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="rater-inputs2__file"
                onChange={(e) => onFiles(e.target.files)}
              />
            </div>
          )}
          {error ? (
            <p className="rater-inputs2__source-error" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : null;

  const dictRowsExist =
    (dictionary ? dictionary.inputs.length : fields.length) > 0;
  const sourceFirst = !hasSource && dictRowsExist;

  // ── Brief 89 R2 — the genesis block replaces the empty-Inputs
  // stranger stack (dictionary empty card + score-a-book dropzone)
  // while the plan is fully empty. Taking the data door reveals ONLY
  // the source act (Esc / "Both doors" returns); any source or
  // declaration dissolves the block into the normal acts below.
  if (genesisIdle && genesis) {
    return (
      <div className="rater-inputs2">
        <PlanGenesis
          onDataDoor={() => setDataDoorTaken(true)}
          onAlgorithmDoor={genesis.onAlgorithmDoor}
          {...(genesis.onDuplicate
            ? { onDuplicate: genesis.onDuplicate }
            : {})}
          editable={editable}
        />
      </div>
    );
  }
  if (genesisSourceStage) {
    return (
      <div
        className="rater-inputs2"
        onKeyDown={(e) => {
          if (e.key === "Escape") setDataDoorTaken(false);
        }}
      >
        {sourceSection}
        <div className="rater-inputs2__genesis-back">
          <Button
            variant="plain"
            size="xs"
            onClick={() => setDataDoorTaken(false)}
            data-testid="rater-genesis-back"
          >
            ← Both doors
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rater-inputs2">
      {bridgePromo ? (
        <section
          className="rater-inputs2__bridge"
          aria-label="Turn book columns into inputs"
          data-testid="rater-inputs2-bridge"
        >
          <div className="rater-inputs2__bridge-text">
            <div className="rater-inputs2__bridge-title">
              Turn these columns into the plan's inputs
            </div>
            <div className="rater-inputs2__bridge-receipt">{bridgeReceipt}</div>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<ListPlus />}
            onClick={declareCols}
          >
            Add {declarableCols.length} book column
            {declarableCols.length === 1 ? "" : "s"} as inputs
          </Button>
        </section>
      ) : null}

      {sourceFirst ? sourceSection : null}

      {/* ── Act 1 — Plan inputs (always present, never gated on a source;
             Brief 65 §3.1 kills the declare/map view swap) ── */}
      <section className="rater-inputs2__act" aria-label="Plan inputs">
        {dictOpen ? (
          dictionary ? (
            <DictionaryTable
              inputs={dictionary.inputs}
              editable={editable}
              {...(dictionary.onUpsert ? { onUpsert: dictionary.onUpsert } : {})}
              {...(dictionary.onDelete ? { onDelete: dictionary.onDelete } : {})}
              {...(dictionary.busy !== undefined ? { busy: dictionary.busy } : {})}
              // Brief 89 — one affordance: while the promoted bridge
              // renders, the head chip would be a same-label twin
              // (Brief 65 §3.7 convergence), so it yields.
              {...(dictDeclare && !bridgePromo ? { declare: dictDeclare } : {})}
              ghosts={ghostInputs}
              onDeclareGhost={handleDeclareGhost}
              usedSlugs={usedSlugs}
            />
          ) : (
            <>
              <div className="rater-inputs2__dict-head">
                <h3 className="rater-inputs2__sect-title">Plan inputs</h3>
                <span className="rater-inputs2__dict-count">
                  {fields.length} input{fields.length === 1 ? "" : "s"} declared
                </span>
              </div>
              {fields.length === 0 ? (
                <EmptyState
                  icon={<ListPlus size={24} />}
                  title="No inputs declared yet"
                  description="Declare the inputs your plan rates on — TIV, class code, construction, and so on."
                />
              ) : (
                <div className="rater-inputs2__tablewrap">
                  <table className="rater-inputs2__table">
                    <thead>
                      <tr>
                        <th>Input</th>
                        <th>Type</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((f) => (
                        <tr key={f.id}>
                          <td>
                            <div className="rater-inputs2__fname">{f.name}</div>
                            <div className="rater-inputs2__fslug">{f.slug}</div>
                          </td>
                          <td>
                            <span
                              className={`rater-inputs2__type ${typeClass(f.type)}`}
                            >
                              {typeLabel(f.type)}
                            </span>
                          </td>
                          <td className="rater-inputs2__src">{f.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        ) : (
          <button
            type="button"
            className="rater-inputs2__act-summary"
            onClick={() => setDictOpenPref(true)}
            aria-expanded={false}
          >
            <span className="rater-inputs2__act-summary-title">
              Plan inputs
            </span>
            <span className="rater-inputs2__act-summary-meta">
              {(dictionary ? dictionary.inputs.length : fields.length) || "No"}{" "}
              input
              {(dictionary ? dictionary.inputs.length : fields.length) === 1
                ? ""
                : "s"}{" "}
              declared
            </span>
            {ghostInputs.length > 0 ? (
              <span className="rater-inputs2__act-summary-warn">
                {ghostInputs.length} needed by the algorithm not declared
              </span>
            ) : null}
            <span className="rater-inputs2__act-summary-chev" aria-hidden>
              <ChevronDown size={14} />
            </span>
          </button>
        )}
        {dictOpen && hasSource ? (
          <Button
            variant="plain"
            size="xs"
            onClick={() => setDictOpenPref(false)}
          >
            Collapse plan inputs
          </Button>
        ) : null}
      </section>

      {sourceFirst ? null : sourceSection}

      {showMapping ? (
        /* ── Map columns (Phase B) ── */
        <>
          <div className="rater-inputs2__dict-head">
            <h3 className="rater-inputs2__sect-title">Match columns</h3>
            <div className="rater-inputs2__map-actions">
              <span className="rater-inputs2__dict-count">
                {mappedCount} of {mappingInputs.length} mapped
              </span>
              {/* Auto-recognize is the frequent action (right after connecting
                  a book) — visible. The occasional "declare unmapped" lives in
                  the "⋯" menu. */}
              {editable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Wand2 />}
                  onClick={handleAutoRecognize}
                >
                  Auto-recognize
                </Button>
              ) : null}
            </div>
          </div>
          {/* book intake — ONE sentence names the leftovers: ignored
              columns, fuzzy suggestions, missing required inputs. The
              chat door refuses with this same sentence. */}
          {preflightLine?.sentence ? (
            <p
              className="rater-inputs2__preflight"
              data-testid="rater-inputs2-preflight"
            >
              {preflightLine.sentence}
            </p>
          ) : null}
          <div className="rater-inputs2__tablewrap">
            <table className="rater-inputs2__table rater-inputs2__table--map">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Type</th>
                  <th>Source column</th>
                  <th>Sample</th>
                </tr>
              </thead>
              <tbody>
                {mappingInputs.map((input) => {
                  const col = columnMap[input.id] ?? "";
                  // P2.5 — a `@ratio:` binding shows an A ÷ B picker + a
                  // computed sample (the data carries the components, not the
                  // ratio). isRatioMapping checks the prefix; the payload is
                  // sliced loosely so a half-set ratio stays in ratio mode
                  // mid-edit (parseRatio would reject the partial value).
                  const ratioActive = isRatioMapping(col);
                  const ratioPayload = ratioActive
                    ? col.slice(RATIO_PREFIX.length)
                    : "";
                  const ratioSlash = ratioPayload.indexOf("/");
                  const ratioNum =
                    ratioSlash >= 0
                      ? ratioPayload.slice(0, ratioSlash)
                      : ratioPayload;
                  const ratioDen =
                    ratioSlash >= 0 ? ratioPayload.slice(ratioSlash + 1) : "";
                  const bucket =
                    ratioActive || !col ? null : bucketFor(input.id, col);
                  // book intake — an unmapped row with a fuzzy
                  // pre-flight hit shows the amber dot + names the
                  // suggested column; a person confirms via the select.
                  const suggestedColumn =
                    !col && !ratioActive
                      ? (preflightLine?.suggestionFor.get(input.id) ?? null)
                      : null;
                  const ratioSample =
                    ratioActive && ratioNum && ratioDen
                      ? computeRatioForRow(
                          (sampleRows[0] ?? {}) as Readonly<
                            Record<string, string>
                          >,
                          { numerator: ratioNum, denominator: ratioDen },
                        )
                      : null;
                  const sampleVal = ratioActive
                    ? (ratioSample ?? undefined)
                    : col
                      ? sampleRows[0]?.[col]
                      : undefined;
                  // Slug is the field identifier (e.g. annual_gross_sales),
                  // matching the dictionary view. Shown only when it differs
                  // from the display label (no redundant repeat).
                  const label =
                    dictNameBySlug.get(input.id) ??
                    input.displayName ??
                    input.name;
                  const mismatch = mismatchByInput.get(input.id);
                  // Brief 65 §3.5 — type-aware sample validation for
                  // non-dimension inputs (the dim machinery has its own).
                  const dtypeIssue =
                    !mismatch && col && !ratioActive
                      ? detectDtypeMismatch(
                          inputDtypes?.[input.id] ??
                            (input.dtype === "number" ? "number" : undefined),
                          col,
                          sampleRows,
                        )
                      : null;
                  const expanded = expandedMismatch === input.id;
                  // P2.3 — an input fed by an API Lab route shows its provenance
                  // ("API · via {route}" + resolved value) instead of a CSV
                  // column select; the connector pushes the value, not a column.
                  const apiSourced = apiSourcedByKey?.get(input.id);
                  return (
                    <Fragment key={input.id}>
                      <tr>
                      <td>
                        <div className="rater-inputs2__fname">{label}</div>
                        {input.id && input.id !== label ? (
                          <div className="rater-inputs2__fslug">{input.id}</div>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`rater-inputs2__type ${typeClass(
                            input.dtype ?? "text",
                          )}`}
                        >
                          {typeLabel(input.dtype ?? "text")}
                        </span>
                      </td>
                      <td>
                        <div
                          className={`rater-inputs2__mapcell${
                            apiSourced
                              ? " is-api"
                              : col
                                ? ""
                                : " is-unmapped"
                          }`}
                        >
                          {apiSourced ? (
                            /* P2.3 — API Lab route provenance (not a CSV column). */
                            <span className="rater-inputs2__api">
                              <Chip tone="lookup" dot variant="sans">
                                API · via {apiSourced.sourceLabel}
                              </Chip>
                              {apiSourced.value !== "" ? (
                                <code
                                  className="rater-inputs2__api-val"
                                  title={apiSourced.value}
                                >
                                  {apiSourced.value}
                                </code>
                              ) : (
                                <span className="rater-inputs2__api-pending">
                                  not run yet
                                </span>
                              )}
                              {onOpenApiLab ? (
                                <IconButton
                                  variant="ghost"
                                  size="xs"
                                  icon={<ExternalLink />}
                                  aria-label={`Open the API Lab route feeding ${label} (via ${apiSourced.sourceLabel})`}
                                  title="Open in API Lab"
                                  onClick={onOpenApiLab}
                                />
                              ) : null}
                            </span>
                          ) : ratioActive ? (
                            /* P2.5 — derived ratio: a compact A ÷ B picker. */
                            <div className="rater-inputs2__ratio">
                              <select
                                className="rater-inputs2__select rater-inputs2__ratio-sel"
                                value={ratioNum}
                                disabled={!editable}
                                onChange={(e) =>
                                  handleSetRatio(
                                    input.id,
                                    e.target.value,
                                    ratioDen,
                                  )
                                }
                                aria-label={`Numerator for ${input.name}`}
                              >
                                <option value="">—</option>
                                {columnNames.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <span
                                className="rater-inputs2__ratio-div"
                                aria-hidden
                              >
                                ÷
                              </span>
                              <select
                                className="rater-inputs2__select rater-inputs2__ratio-sel"
                                value={ratioDen}
                                disabled={!editable}
                                onChange={(e) =>
                                  handleSetRatio(
                                    input.id,
                                    ratioNum,
                                    e.target.value,
                                  )
                                }
                                aria-label={`Denominator for ${input.name}`}
                              >
                                <option value="">—</option>
                                {columnNames.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              {editable ? (
                                <IconButton
                                  variant="ghost"
                                  size="xs"
                                  icon={<X />}
                                  onClick={() => handleMapColumn(input.id, "")}
                                  aria-label="Use a single source column instead"
                                  title="Use a single source column instead"
                                />
                              ) : null}
                            </div>
                          ) : (
                            <>
                              <span
                                className={`rater-inputs2__conf rater-inputs2__conf--${
                                  bucket ?? (suggestedColumn ? "suggested" : "none")
                                }`}
                                title={
                                  bucket === "auto"
                                    ? "Auto-matched (high confidence)"
                                    : bucket === "suggested"
                                      ? "Suggested — review"
                                      : suggestedColumn
                                        ? `Suggested: ${suggestedColumn} — pick it to confirm`
                                        : undefined
                                }
                                aria-hidden
                              />
                              <select
                                className="rater-inputs2__select"
                                value={col}
                                disabled={!editable}
                                onChange={(e) =>
                                  e.target.value === RATIO_OPTION
                                    ? handleStartRatio(input.id)
                                    : handleMapColumn(input.id, e.target.value)
                                }
                                aria-label={`Source column for ${input.name}`}
                              >
                                <option value="">— Not mapped</option>
                                {columnNames.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                                {columnNames.length >= 2 ? (
                                  <option value={RATIO_OPTION}>
                                    Ratio of two columns…
                                  </option>
                                ) : null}
                              </select>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="rater-inputs2__src">
                        {mismatch ? (
                          <button
                            type="button"
                            className={`rater-inputs2__mm${
                              mismatch.severity === "hard" ? " is-hard" : ""
                            }`}
                            onClick={() =>
                              setExpandedMismatch(expanded ? null : input.id)
                            }
                            aria-expanded={expanded}
                          >
                            <AlertTriangle size={12} aria-hidden />{" "}
                            {mismatch.mismatchedValues.length} unmatched
                          </button>
                        ) : dtypeIssue ? (
                          <span
                            className="rater-inputs2__dtype-warn"
                            role="status"
                            title={`${dtypeIssue.bad} of ${dtypeIssue.total} sample values don't read as ${dtypeIssue.expectedLabel}`}
                          >
                            <AlertTriangle size={12} aria-hidden />
                            {fmtSample(sampleVal)} — not{" "}
                            {dtypeIssue.expectedLabel.startsWith("n")
                              ? "a number"
                              : dtypeIssue.expectedLabel}
                          </span>
                        ) : (
                          fmtSample(sampleVal)
                        )}
                      </td>
                      </tr>
                      {expanded && mismatch ? (
                        <tr className="rater-inputs2__mmrow">
                          <td colSpan={4}>
                            <div className="rater-inputs2__mm-detail">
                              <div className="rater-inputs2__mm-head">
                                {mismatch.mismatchedValues.length} value
                                {mismatch.mismatchedValues.length === 1
                                  ? ""
                                  : "s"}{" "}
                                in <code>{mismatch.columnName}</code> not in{" "}
                                {mismatch.dimDisplayName}
                                {mismatch.severity === "hard"
                                  ? " — blocks scoring until resolved"
                                  : ""}
                              </div>
                              {mismatch.mismatchedValues.map((mv) => (
                                <div
                                  key={mv.value}
                                  className="rater-inputs2__mm-item"
                                >
                                  <span className="rater-inputs2__mm-val">
                                    {mv.value}
                                  </span>
                                  <span className="rater-inputs2__mm-count">
                                    {mv.rowCount} row
                                    {mv.rowCount === 1 ? "" : "s"}
                                  </span>
                                  {editable ? (
                                    <select
                                      className="rater-inputs2__select"
                                      value=""
                                      onChange={(e) =>
                                        e.target.value &&
                                        handleAlias(
                                          mismatch.dimSlug,
                                          mv.value,
                                          e.target.value,
                                        )
                                      }
                                      aria-label={`Map ${mv.value} to a level`}
                                    >
                                      <option value="">Map to…</option>
                                      {mv.suggestions.map((s) => (
                                        <option
                                          key={s.canonicalLevelId}
                                          value={s.canonicalLevelId}
                                        >
                                          {s.label}
                                        </option>
                                      ))}
                                    </select>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Brief 80 D-A (finding E7) — the policy-composition
              contract's ONE authoring home: grouping columns + rolled
              fields, sentence-shaped, right where the book ↔ plan seam
              lives. Collapsed = the offer (no longer gated on a
              completed score); enabled = the editable statement. */}
          {csv ? (
            <PolicyGroupingCard
              editable={editable}
              bookColumns={csv.columns}
              grouping={inputMapping?.grouping_config}
              rollupFields={inputMapping?.rollup_fields ?? []}
              totalField={groupTotalField}
              coverageFields={planPremium?.moneyFields ?? []}
              detected={detectedGrouping}
              rowsMissingPolicyId={rowsMissingPolicyId}
              onEnable={enableGrouping}
              onDisable={disableGrouping}
              onGroupingChange={handleGroupingChange}
              onRollupsChange={handleRollupsChange}
            />
          ) : null}

          {!scored && webhook ? (
            /* Act 4 exists for every source mode — a webhook book maps
               columns but cannot preview-score in place (Brief 65 §3.6). */
            <section
              className="rater-inputs2__score"
              aria-label="Premium preview"
            >
              <div className="rater-inputs2__dict-head">
                <h3 className="rater-inputs2__sect-title">Premium preview</h3>
              </div>
              <EmptyState
                icon={<Play size={24} />}
                title="Webhook books rate at run time"
                description="Premium preview works against CSV rows today. Download the CSV template, fill a sample, and drop it here to preview premiums — the webhook mapping is kept."
              />
            </section>
          ) : null}
          {scored ? (
            <section
              className="rater-inputs2__score"
              aria-label="Premium preview"
            >
              {/* ADR-0056 — projection issues strip: a confident preview
                  must never sit on a silently degraded plan. Errors mean
                  authored parts price NOTHING; warnings mean a structural
                  fallback applied. */}
              {projectionIssues && projectionIssues.length > 0 ? (
                <div
                  className="rater-inputs2__proj-issues"
                  role="alert"
                  aria-label="Plan authoring issues"
                >
                  <div className="rater-inputs2__proj-issues-head">
                    <AlertTriangle size={13} aria-hidden />
                    <span>
                      {(() => {
                        const errs = projectionIssues.filter(
                          (i) => i.severity === "error",
                        ).length;
                        const warns = projectionIssues.length - errs;
                        const parts: string[] = [];
                        if (errs > 0)
                          parts.push(
                            `${errs} authoring issue${errs === 1 ? "" : "s"} block${errs === 1 ? "s" : ""} pricing`,
                          );
                        if (warns > 0)
                          parts.push(
                            `${warns} warning${warns === 1 ? "" : "s"}`,
                          );
                        return parts.join(" · ");
                      })()}
                    </span>
                  </div>
                  <ul className="rater-inputs2__proj-issues-list">
                    {projectionIssues.map((iss, k) => (
                      <li
                        key={k}
                        className={`rater-inputs2__proj-issue${
                          iss.severity === "error" ? " is-error" : ""
                        }`}
                      >
                        {iss.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {/* Parity — the paid-connector cost guardrail (Brief 62.6 PR3).
                  Renders above the preview so the cost warning + Run gate
                  precede the preview; the section's flex gap spaces it. Null
                  (renders nothing) unless the plan's tail binds a connector. */}
              {bookGuardrail}
              <div className="rater-inputs2__dict-head">
                <h3 className="rater-inputs2__sect-title">
                  {groupingActive ? "Policy preview" : "Premium preview"}
                </h3>
                <div className="rater-inputs2__score-actions">
                  {/* Brief 80 D-A — grouping's authoring home is the
                      Policies card in the mapping act (the old offer
                      button + "⋯ → Ungroup" retired into it). */}
                  {/* Brief 75 phase 4 — execution moved to the Run tab
                      (runs are server-scored + persist). This pointer is
                      navigation, not a second trigger. */}
                  {onOpenRun && inputMapping ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconAfter={<ArrowRight />}
                      onClick={onOpenRun}
                    >
                      Score in Run
                    </Button>
                  ) : null}
                </div>
              </div>
              {canScore ? (
                <div className="rater-inputs2__premiums">
                  <div className="rater-inputs2__prem-headline">
                    <span className="rater-inputs2__prem-avg">
                      {groupingActive && policyTotals
                        ? fmtMoney(policyTotals.written)
                        : fmtMoney(scored.avg!)}
                    </span>
                    <span className="rater-inputs2__prem-cap">
                      {groupingActive && policyTotals
                        ? `written premium · ${policyTotals.policies} ${
                            policyTotals.policies === 1 ? "policy" : "policies"
                          } · ${policyTotals.locations} location${
                            policyTotals.locations === 1 ? "" : "s"
                          }${
                            policyTotals.declinedPolicies > 0
                              ? ` · ${policyTotals.declinedPolicies} declined (${fmtMoney(policyTotals.declinedIndicative)} indicative)`
                              : ""
                          }${
                            policyTotals.errorPolicies > 0
                              ? ` · ${policyTotals.errorPolicies} cannot be rated`
                              : ""
                          }`
                        : scored.min !== null &&
                            scored.max !== null &&
                            scored.min !== scored.max
                          ? `avg of the first ${scored.sampleSize} rows · range ${fmtMoney(scored.min)}–${fmtMoney(scored.max)} · median ${fmtMoney(scored.median!)}${loadedRowCount > scored.sampleSize ? ` · Score all for the ${bookTruncated ? "loaded" : "full"} ${loadedRowCount.toLocaleString()}-row book` : ""}`
                          : loadedRowCount > scored.sampleSize
                            ? `avg of the first ${scored.sampleSize} rows previewed — Score all for the ${bookTruncated ? "loaded" : "full"} ${loadedRowCount.toLocaleString()}-row book`
                            : `avg premium · all ${scored.sampleSize} row${scored.sampleSize === 1 ? "" : "s"} previewed`}
                    </span>
                  </div>

                  {/* Out-of-range clamp note (cold-test L22) — never silent. */}
                  {scored.outOfRange.length > 0 ? (
                    <div className="rater-inputs2__prem-oor" role="status">
                      <AlertTriangle size={12} aria-hidden />
                      <span>{oorSummary(scored.outOfRange)}</span>
                    </div>
                  ) : null}

                  {/* ADR-0056 — unrateable rows are a first-class facet,
                      never folded into "declined" or averaged as $0. */}
                  {scored.errorCount > 0 ? (
                    <div className="rater-inputs2__prem-err" role="status">
                      <AlertTriangle size={12} aria-hidden />
                      <span>
                        {scored.errorCount === 1
                          ? "1 row cannot be rated"
                          : `${scored.errorCount} rows cannot be rated`}{" "}
                        — excluded from every total. Click an Error chip for
                        the reason.
                      </span>
                    </div>
                  ) : null}

                  {groupingActive && policyResults.length > 0 ? (
                    /* P2.2 — per-policy roll-up: rolled premium + appetite
                       verdict per policy, expandable to its locations. */
                    <>
                      {/* Brief 80 D-A — the roll-up SUMMARY stays with the
                          preview; editing retired into the Policies card
                          (the P2.2b "Adjust" reveal was a second writer). */}
                      <div className="rater-inputs2__rollup-bar">
                        <span className="rater-inputs2__rollup-summary">
                          Rolling up{" "}
                          {rollupSummaryParts.length > 0
                            ? rollupSummaryParts.join(", ")
                            : "nothing yet"}
                          {" — edit under Match columns · Policies"}
                        </span>
                      </div>
                      <PolicyList
                        results={policyResults}
                        premiumField={policyPremiumField}
                        expanded={expandedPolicy}
                        onToggle={setExpandedPolicy}
                      />
                    </>
                  ) : (
                    <>
                  {/* Per-row strip — click a chip to audit its build-up. A dot
                      appears ONLY when the row needs attention (amber = refer,
                      red = declined/error), so a clean standard book stays
                      calm. ADR-0056 tri-facet: an ERROR row (the plan cannot
                      rate it) reads "Error" — never a dollar, never the same
                      em-dash as "no premium column". error > decline > ok. */}
                  <div className="rater-inputs2__prem-strip">
                    {scored.rows.map((row, i) => {
                      const expanded = expandedRow === i;
                      const isError = row.result.row_status === "error";
                      const dotTier = isError
                        ? "error"
                        : row.tier === "submit" || row.tier === "decline"
                          ? row.tier
                          : null;
                      const label = isError
                        ? "Error"
                        : row.premium !== null
                          ? fmtMoney(row.premium)
                          : row.tier === "decline"
                            ? "Declined"
                            : "—";
                      const firstIssue = isError
                        ? row.result.issues?.find(
                            (iss) => iss.severity === "error",
                          )?.message
                        : undefined;
                      return (
                        <button
                          type="button"
                          key={i}
                          className={`rater-inputs2__prem-chip${
                            row.premium === null && !isError ? " is-empty" : ""
                          }${isError ? " is-error" : ""}${expanded ? " is-active" : ""}`}
                          onClick={() => setExpandedRow(expanded ? null : i)}
                          aria-expanded={expanded}
                          title={
                            isError
                              ? `Row ${i + 1} · cannot rate — ${firstIssue ?? "see the audit trace"}`
                              : row.tier
                                ? `Row ${i + 1} · ${ELIGIBILITY_TIER_LABELS[row.tier]} — click to audit`
                                : `Row ${i + 1} — click to audit`
                          }
                        >
                          {dotTier ? (
                            <span
                              className="rater-inputs2__prem-dot"
                              data-tier={dotTier}
                              aria-hidden
                            />
                          ) : null}
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* The expanded row's factor trace — the audit "why". */}
                  {expandedRow !== null && scored.rows[expandedRow] ? (
                    <TraceCard
                      index={expandedRow}
                      row={scored.rows[expandedRow]!}
                      nameByNodeId={stageNameById}
                    />
                  ) : null}
                    </>
                  )}
                </div>
              ) : (
                <p className="rater-inputs2__prem-empty">
                  {/* Law 2 (93.4) — a composition refusal is PLAN-level:
                      the engine rated every row fine, but no premium can
                      be filed, so every row refuses identically and the
                      avg is null. It lands here, not in the error banner
                      above. Sending the author to an audit trace for
                      "unknown key, missing input" would misdirect twice:
                      the rows rated, and the fix is in the plan. */}
                  {scored.compositionRefusal !== null
                    ? `The filed premium could not be composed: ${scored.compositionRefusal}`
                    : scored.sampleSize > 0 &&
                        scored.errorCount === scored.sampleSize
                      ? `None of the ${scored.sampleSize} sample rows could be rated — open a row's audit trace for the reason (unknown key, missing input).`
                      : scored.sampleSize > 0 &&
                          scored.declinedCount === scored.sampleSize
                        ? `All ${scored.sampleSize} sample rows were declined by the appetite gate — no premium is produced for a declined risk.`
                        : "No premium produced — check that the rating inputs are mapped to source columns."}
                </p>
              )}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
