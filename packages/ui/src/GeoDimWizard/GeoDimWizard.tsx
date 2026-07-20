/**
 * Brief 44 PR 44.2 — `<GeoDimWizard>`.
 *
 * Three-step create flow for a geographic dimension:
 *
 *   1. Granularity — state / county / zip (Q1 lock: immutable after creation)
 *   2. Scope — national toggle OR multi-state pick (Q3 lock: required)
 *   3. Review — summary + auto-seeded level count, then Create
 *
 * The wizard manages step + draft state internally and emits a fully-
 * formed `GeoDimDraft` on Create. Callers (Brief 44 PR 44.3's
 * GeoDimEditor + the Dimensions left-rail) embed the wizard in
 * whatever modal/drawer they prefer — this primitive doesn't ship its
 * own dialog wrapper so consumers can choose presentation.
 *
 * Visual lock: Frames 1+2 from
 * `rate-lab/frontend/public/mockup/44-geographic-rating.html`.
 */

import { useMemo, useState } from "react";

import {
  STATE_LABEL_BY_CODE,
  STATE_SEED,
  getLevelsForScope,
  previewLevelCount,
  type GeoGranularity,
  type GeoScope,
} from "./geoLevelSeeds";

// Mirror @openrater/api-client GeoTerritory (avoid HTTP-layer dep). The
// wizard never authors territories — it emits an empty array; the
// Territories tab editor (PR 44.7) populates them later.
interface GeoTerritory {
  readonly id: string;
  readonly label: string;
  readonly members: readonly string[];
}

import "./GeoDimWizard.css";

// ──────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────

/**
 * What the wizard emits on Create. Shape mirrors a Brief 44 §3.1
 * geographic dim payload (without lifecycle fields, which the server
 * sets). The caller wraps this in UpsertDimensionRequest + POSTs.
 */
export interface GeoDimDraft {
  readonly dim_id: string;
  readonly display_name: string;
  readonly slug: string;
  readonly data_type: "string";
  readonly role: "rating-input";
  readonly dimension_type: "geographic";
  // ADR-0038 — a geographic dim's shape IS "geographic" (was wrongly stamped
  // "categorical", which filed it under the CATEGORICAL rail + mis-routed the
  // input validator). inferDimensionShape now reads back "geographic".
  readonly shape: "geographic";
  readonly geo_granularity: GeoGranularity;
  readonly geo_scope: GeoScope;
  readonly geo_territories: readonly GeoTerritory[];
  readonly levels: ReadonlyArray<{
    readonly kind: "categorical";
    readonly id: string;
    readonly label: string;
  }>;
}

export interface GeoDimWizardProps {
  /**
   * Existing dim slugs/ids for collision check. The wizard derives a
   * default slug from the user's display name; if it collides, the
   * wizard suffixes `_2`, `_3`, etc.
   */
  readonly existingSlugs?: readonly string[];

  /** Called on Create with the materialized draft. */
  readonly onCreate: (draft: GeoDimDraft) => void;

  /** Called when the user cancels (any step). */
  readonly onCancel: () => void;
}

// ──────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

const GRANULARITY_META: Record<
  GeoGranularity,
  {
    readonly title: string;
    readonly format: string;
    readonly description: string;
    readonly aside: string;
    readonly defaultSlug: string;
    readonly defaultDisplayName: string;
  }
> = {
  state: {
    title: "State",
    format: "USPS",
    description:
      "Two-letter postal code (WI, MN, IL). Coarsest unit; good for national rollups, state-of-filing rating, or jurisdictional bands.",
    aside: "51 levels max · 50 + DC",
    defaultSlug: "state",
    defaultDisplayName: "State",
  },
  county: {
    title: "County",
    format: "FIPS-5",
    description:
      "5-digit FIPS county code. Mid-grained; most common for territorial rating in commercial lines. Auto-rolls up to state.",
    aside: "3,144 levels max · nationwide",
    defaultSlug: "county",
    defaultDisplayName: "County",
  },
  zip: {
    title: "ZIP",
    format: "ZCTA-5",
    description:
      "5-digit ZIP Code Tabulation Area. Finest unit; right for catastrophe / property where exposure varies block-by-block. Largest dataset — loads ZIP boundaries per state as needed.",
    aside: "~33,000 levels · ~770 per state avg",
    defaultSlug: "zip",
    defaultDisplayName: "ZIP",
  },
};

/** URL-safe lowercased slug ASCII-only. */
function toSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "geo_dim"
  );
}

/** Suffix slug until it doesn't collide with existing dims. */
function uniqueSlug(base: string, existing: readonly string[]): string {
  const set = new Set(existing);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

export function GeoDimWizard({
  existingSlugs = [],
  onCreate,
  onCancel,
}: GeoDimWizardProps): JSX.Element {
  const [step, setStep] = useState<Step>(1);
  const [granularity, setGranularity] = useState<GeoGranularity>("state");
  const [scopeKind, setScopeKind] = useState<"national" | "subset">("subset");
  const [scopeStates, setScopeStates] = useState<readonly string[]>([]);
  // ADR-0038 / F13 — a ZIP-granularity dim is almost always grouped into
  // territories, so it must NOT default to its granularity label ("ZIP", which
  // contradicts the Review step's "name it for what it rates on, not its ZIP
  // granularity" coaching). Default ZIP to "Territory"; coarser granularities
  // (state / county) keep their label since they're often rated on directly.
  // The user can always override; the slug derives from the effective name.
  const [nameDraft, setNameDraft] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const meta = GRANULARITY_META[granularity]!;
  const effectiveName =
    nameEdited && nameDraft.trim() !== ""
      ? nameDraft.trim()
      : granularity === "zip"
        ? "Territory"
        : meta.defaultDisplayName;

  const scope: GeoScope = useMemo(() => {
    if (scopeKind === "national") return { kind: "national" };
    return { kind: "subset", states: scopeStates };
  }, [scopeKind, scopeStates]);

  const scopeValid =
    scopeKind === "national" || scopeStates.length > 0;

  const previewCount = useMemo(
    () => (scopeValid ? previewLevelCount(granularity, scope) : 0),
    [granularity, scope, scopeValid],
  );

  function toggleScopeState(code: string): void {
    setScopeStates((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  function handleCreate(): void {
    const baseSlug = toSlug(effectiveName);
    const slug = uniqueSlug(baseSlug, existingSlugs);
    const levels = getLevelsForScope(granularity, scope);

    onCreate({
      dim_id: slug,
      display_name: effectiveName,
      slug,
      data_type: "string",
      role: "rating-input",
      dimension_type: "geographic",
      shape: "geographic",
      geo_granularity: granularity,
      geo_scope: scope,
      geo_territories: [],
      levels,
    });
  }

  return (
    <section className="rater-geo-wizard" aria-label="Create geographic dimension">
      <StepBar step={step} />

      {step === 1 && (
        <Step1Granularity
          value={granularity}
          onChange={setGranularity}
        />
      )}

      {step === 2 && (
        <Step2Scope
          granularity={granularity}
          scopeKind={scopeKind}
          scopeStates={scopeStates}
          onSetKind={setScopeKind}
          onToggleState={toggleScopeState}
        />
      )}

      {step === 3 && (
        <Step3Review
          granularity={granularity}
          scope={scope}
          levelCount={previewCount}
          name={effectiveName}
          onNameChange={(v) => {
            setNameDraft(v);
            setNameEdited(true);
          }}
        />
      )}

      <footer className="rater-geo-wizard__footer">
        <button
          type="button"
          className="rater-geo-wizard__btn rater-geo-wizard__btn--ghost"
          onClick={onCancel}
        >
          Cancel
        </button>
        <div className="rater-geo-wizard__footer-spacer" />
        <button
          type="button"
          className="rater-geo-wizard__btn"
          onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
          disabled={step === 1}
        >
          ← Back
        </button>
        {step < 3 ? (
          <button
            type="button"
            className="rater-geo-wizard__btn rater-geo-wizard__btn--primary"
            onClick={() => setStep((s) => (s < 3 ? ((s + 1) as Step) : s))}
            disabled={step === 2 && !scopeValid}
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            className="rater-geo-wizard__btn rater-geo-wizard__btn--primary"
            onClick={handleCreate}
            disabled={!scopeValid}
          >
            Create dimension
          </button>
        )}
      </footer>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

interface StepBarProps {
  readonly step: Step;
}

function StepBar({ step }: StepBarProps): JSX.Element {
  const labels: Array<[Step, string]> = [
    [1, "Granularity"],
    [2, "Scope"],
    [3, "Review"],
  ];
  return (
    <div className="rater-geo-wizard__steps" aria-label="Wizard steps">
      {labels.map(([n, label], ix) => {
        const isActive = step === n;
        const isDone = step > n;
        const mod = isActive
          ? "is-active"
          : isDone
            ? "is-done"
            : "is-future";
        return (
          <span key={n} className="rater-geo-wizard__step-group">
            <span
              className={`rater-geo-wizard__step rater-geo-wizard__step--${mod}`}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="rater-geo-wizard__step-dot">{n}</span>
              <span className="rater-geo-wizard__step-label">{label}</span>
            </span>
            {ix < labels.length - 1 && (
              <span className="rater-geo-wizard__step-line" />
            )}
          </span>
        );
      })}
    </div>
  );
}

interface Step1Props {
  readonly value: GeoGranularity;
  readonly onChange: (g: GeoGranularity) => void;
}

function Step1Granularity({ value, onChange }: Step1Props): JSX.Element {
  const options: GeoGranularity[] = ["state", "county", "zip"];
  return (
    <div className="rater-geo-wizard__body">
      <h2 className="rater-geo-wizard__title">
        How fine-grained is this geographic dimension?
      </h2>
      <p className="rater-geo-wizard__sub">
        Pick the unit you'll rate on. Granularity is locked once created
        — if you need to switch later, you'll create a new dimension and
        remap.
      </p>

      <div className="rater-geo-wizard__options" role="radiogroup">
        {options.map((g) => {
          const meta = GRANULARITY_META[g]!;
          const selected = value === g;
          return (
            <label
              key={g}
              className={`rater-geo-wizard__opt${selected ? " is-selected" : ""}`}
            >
              <input
                type="radio"
                name="rater-geo-wizard-granularity"
                value={g}
                checked={selected}
                onChange={() => onChange(g)}
                className="rater-geo-wizard__opt-input"
              />
              <span className="rater-geo-wizard__opt-radio" aria-hidden="true" />
              <span className="rater-geo-wizard__opt-body">
                <span className="rater-geo-wizard__opt-title">
                  {meta.title}{" "}
                  <span className="rater-geo-wizard__opt-format">
                    {meta.format}
                  </span>
                </span>
                <span className="rater-geo-wizard__opt-hint">
                  {meta.description}
                </span>
              </span>
              <span className="rater-geo-wizard__opt-aside">{meta.aside}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

interface Step2Props {
  readonly granularity: GeoGranularity;
  readonly scopeKind: "national" | "subset";
  readonly scopeStates: readonly string[];
  readonly onSetKind: (k: "national" | "subset") => void;
  readonly onToggleState: (code: string) => void;
}

function Step2Scope({
  scopeKind,
  scopeStates,
  onSetKind,
  onToggleState,
}: Step2Props): JSX.Element {
  return (
    <div className="rater-geo-wizard__body">
      <h2 className="rater-geo-wizard__title">Which states are in scope?</h2>
      <p className="rater-geo-wizard__sub">
        Auto-seeds the level list with the right rows. You can widen the
        scope later — this is the starting set.
      </p>

      <button
        type="button"
        className={`rater-geo-wizard__toggle${scopeKind === "national" ? " is-on" : ""}`}
        onClick={() =>
          onSetKind(scopeKind === "national" ? "subset" : "national")
        }
        aria-pressed={scopeKind === "national"}
      >
        <span className="rater-geo-wizard__toggle-switch" aria-hidden="true" />
        <span className="rater-geo-wizard__toggle-body">
          <span className="rater-geo-wizard__toggle-title">Whole country</span>
          <span className="rater-geo-wizard__toggle-hint">
            Selects all 51 areas (50 states + DC). Switch off to pick a
            subset.
          </span>
        </span>
      </button>

      {scopeKind === "subset" && (
        <div className="rater-geo-wizard__states">
          <div className="rater-geo-wizard__states-head">
            <span className="rater-geo-wizard__states-title">Selected states</span>
            <span className="rater-geo-wizard__states-hint">
              · click cells to toggle
            </span>
          </div>
          <div className="rater-geo-wizard__states-grid">
            {STATE_SEED.map((s) => {
              const sel = scopeStates.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`rater-geo-wizard__state-cell${sel ? " is-selected" : ""}`}
                  onClick={() => onToggleState(s.id)}
                  aria-pressed={sel}
                  title={s.label}
                >
                  {s.id}
                </button>
              );
            })}
          </div>
          <div className="rater-geo-wizard__states-count">
            {scopeStates.length === 0 ? (
              <span className="rater-geo-wizard__states-empty">
                Pick at least one state, or toggle "Whole country" above.
              </span>
            ) : (
              <>
                <strong>{scopeStates.length}</strong> state
                {scopeStates.length === 1 ? "" : "s"} selected ·{" "}
                <span className="rater-geo-wizard__states-codes">
                  {[...scopeStates].sort().join(", ")}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface Step3Props {
  readonly granularity: GeoGranularity;
  readonly scope: GeoScope;
  readonly levelCount: number;
  readonly name: string;
  readonly onNameChange: (next: string) => void;
}

function Step3Review({
  granularity,
  scope,
  levelCount,
  name,
  onNameChange,
}: Step3Props): JSX.Element {
  const meta = GRANULARITY_META[granularity]!;
  const scopeText =
    scope.kind === "national"
      ? "Whole country (51 areas)"
      : scope.states
          .map((c: string) => STATE_LABEL_BY_CODE[c] ?? c)
          .join(", ");
  const willSeed = levelCount > 0;
  const isUnseededZip = granularity === "zip";
  return (
    <div className="rater-geo-wizard__body">
      <h2 className="rater-geo-wizard__title">Review</h2>
      <p className="rater-geo-wizard__sub">
        Name the dimension and confirm its shape. A dim grouped into
        territories is usually named for what it rates on (e.g. "Territory"),
        not its ZIP/state granularity.
      </p>

      <label className="rater-geo-wizard__name-field">
        <span className="rater-geo-wizard__name-label">Dimension name</span>
        <input
          className="rater-geo-wizard__name-input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          aria-label="Dimension name"
          placeholder={granularity === "zip" ? "Territory" : meta.defaultDisplayName}
        />
      </label>

      <dl className="rater-geo-wizard__review">
        <div className="rater-geo-wizard__review-row">
          <dt>Granularity</dt>
          <dd>
            {meta.title}{" "}
            <span className="rater-geo-wizard__review-format">
              {meta.format}
            </span>
          </dd>
        </div>
        <div className="rater-geo-wizard__review-row">
          <dt>Scope</dt>
          <dd>{scopeText}</dd>
        </div>
        <div className="rater-geo-wizard__review-row">
          <dt>Auto-seeded levels</dt>
          <dd>
            <strong>{levelCount.toLocaleString()}</strong>
            {willSeed ? " level" + (levelCount === 1 ? "" : "s") : null}
            {!willSeed && !isUnseededZip && (
              <span className="rater-geo-wizard__review-warn">
                {" "}
                · no canonical seed for these states in v1 — add custom
                levels after creation
              </span>
            )}
            {isUnseededZip && (
              <span className="rater-geo-wizard__review-warn">
                {" "}
                · ZIP levels seed from a CSV map after creation — import a
                ZIP→territory CSV on the dimension's Levels tab.
              </span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
