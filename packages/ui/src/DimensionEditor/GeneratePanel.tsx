/**
 * <GeneratePanel> — banded-dim level generator (Frame 14).
 *
 * Brief 30 §5.2 / §−1 Q4. Opens inline from the `⌃ Generate…`
 * button in the level table toolbar; replaces the level table
 * while open. Three sections:
 *
 *   1. Method picker — equal-width / log-scale.
 *      Quantile + Manual are sketched as disabled rows for
 *      forward consistency with the mockup; both land later
 *      (quantile needs a bound sample dataset; manual is just
 *      "type directly into the level table" → cancels Generate).
 *   2. Parameters — min / max / count numeric inputs.
 *   3. Live preview — first N + (last if truncated) generated
 *      bands, rendered as a fixed-height code block so the panel
 *      doesn't jump as the user types.
 *
 * Lock #4 (confirm-before-overwrite): when the editor's existing
 * level vector contains hand-tuned bands (per `hasHandTunedLevels`),
 * a red warning row renders + the primary button text changes to
 * "Replace N bands". Otherwise the button reads "Generate".
 *
 * Pure presentation. Parent owns the recipe state during preview;
 * the panel emits `onApply(recipe)` on confirm or `onCancel()` on
 * cancel.
 */

import type { JSX } from "react";
import { useMemo, useState } from "react";
import { Button } from "@openrater/design-system";
import {
  applyGenerateRecipe,
  defaultBandLabel,
  hasHandTunedLevels,
  type BandedGenerateMethod,
  type BandedGenerateRecipe,
} from "./banded-utils";
import type { LevelRow } from "./LevelRowsTable";
import "./GeneratePanel.css";

export interface GeneratePanelProps {
  /**
   * The current banded levels. Used to:
   *   • detect hand-tuned work that the generate would overwrite
   *   • seed sensible defaults (count = current count if any,
   *     min/max = span of current levels if any)
   */
  readonly currentLevels: readonly LevelRow[];
  /**
   * Default min/max to seed the panel with when there are no
   * current levels. Optional; defaults to 0 / 100.
   */
  readonly defaultMin?: number;
  readonly defaultMax?: number;
  /**
   * Default count to seed the panel with when there are no current
   * levels. Optional; defaults to 5.
   */
  readonly defaultCount?: number;
  /** Fires when the user clicks the confirm/replace button. */
  readonly onApply: (
    recipe: BandedGenerateRecipe,
    levels: readonly LevelRow[],
  ) => void;
  /** Fires when the user clicks Cancel. */
  readonly onCancel: () => void;
  readonly testId?: string;
}

const METHODS: ReadonlyArray<{
  readonly value: BandedGenerateMethod;
  readonly label: string;
  readonly hint: string;
}> = [
  {
    value: "equal-width",
    label: "Equal-width",
    hint: "Same span per band (min → max ÷ count).",
  },
  {
    value: "log-scale",
    label: "Log-scale (base e)",
    hint: "Geometric bands — wider as values grow. Requires min > 0.",
  },
];

/**
 * Disabled rows in the method picker — render them so the user
 * sees the future shape but can't pick them yet.
 */
const DISABLED_METHODS: ReadonlyArray<{
  readonly label: string;
  readonly hint: string;
}> = [
  {
    label: "Quantile",
    hint: "Requires bound sample dataset. (lands with the test-runner)",
  },
  {
    label: "Manual list",
    hint: "Type breakpoints directly into the level table (cancel + edit).",
  },
];

export function GeneratePanel(props: GeneratePanelProps): JSX.Element {
  const {
    currentLevels,
    defaultMin = 0,
    defaultMax = 100,
    defaultCount = 5,
    onApply,
    onCancel,
    testId = "rater-generate-panel",
  } = props;

  // Seed from current levels when present.
  const seed = useMemo(() => {
    const banded = currentLevels.filter((l) => l.kind === "banded");
    if (banded.length === 0) {
      return { min: defaultMin, max: defaultMax, count: defaultCount };
    }
    const los = banded.map((l) => l.lo).filter((v): v is number => typeof v === "number");
    const his = banded.map((l) => l.hi).filter((v): v is number => typeof v === "number");
    return {
      min: los.length > 0 ? Math.min(...los) : defaultMin,
      max: his.length > 0 ? Math.max(...his) : defaultMax,
      count: banded.length || defaultCount,
    };
  }, [currentLevels, defaultMin, defaultMax, defaultCount]);

  const [method, setMethod] = useState<BandedGenerateMethod>("equal-width");
  const [minDraft, setMinDraft] = useState(String(seed.min));
  const [maxDraft, setMaxDraft] = useState(String(seed.max));
  const [countDraft, setCountDraft] = useState(String(seed.count));

  const min = Number(minDraft);
  const max = Number(maxDraft);
  const count = Math.floor(Number(countDraft));
  const isValid =
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    max > min &&
    Number.isFinite(count) &&
    count >= 2 &&
    count <= 100 &&
    (method !== "log-scale" || min > 0);

  const recipe: BandedGenerateRecipe = { method, min, max, count };

  const previewLevels = useMemo(() => {
    if (!isValid) return [] as readonly LevelRow[];
    return applyGenerateRecipe(recipe);
  }, [isValid, recipe]);

  const handTuned = useMemo(
    () => hasHandTunedLevels(currentLevels),
    [currentLevels],
  );
  const willReplace = currentLevels.length > 0;

  const handleApply = () => {
    if (!isValid) return;
    onApply(recipe, previewLevels);
  };

  return (
    <div
      className="rater-generate-panel"
      data-testid={testId}
      role="region"
      aria-label="Generate banded levels"
    >
      <div className="rater-generate-panel__cols">
        <div className="rater-generate-panel__col">
          <div className="rater-generate-panel__col-label">Method</div>
          {METHODS.map((m) => {
            const active = m.value === method;
            const disabled =
              m.value === "log-scale" && min <= 0;
            return (
              <label
                key={m.value}
                className={`rater-generate-panel__method${active ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}
                data-testid={`${testId}-method-${m.value}`}
              >
                <input
                  type="radio"
                  name="rater-generate-method"
                  value={m.value}
                  checked={active}
                  disabled={disabled}
                  onChange={() => setMethod(m.value)}
                />
                <span className="rater-generate-panel__method-body">
                  <span className="rater-generate-panel__method-name">
                    {m.label}
                  </span>
                  <span className="rater-generate-panel__method-hint">
                    {disabled
                      ? `${m.hint} (set min > 0 first)`
                      : m.hint}
                  </span>
                </span>
              </label>
            );
          })}
          {DISABLED_METHODS.map((m) => (
            <label
              key={m.label}
              className="rater-generate-panel__method is-disabled"
            >
              <input type="radio" disabled />
              <span className="rater-generate-panel__method-body">
                <span className="rater-generate-panel__method-name">
                  {m.label}
                </span>
                <span className="rater-generate-panel__method-hint">
                  {m.hint}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="rater-generate-panel__col">
          <div className="rater-generate-panel__col-label">Parameters</div>
          <div className="rater-generate-panel__params">
            <label className="rater-generate-panel__field">
              <span className="rater-generate-panel__field-label">Min</span>
              <input
                type="number"
                inputMode="decimal"
                value={minDraft}
                onChange={(e) => setMinDraft(e.target.value)}
                data-testid={`${testId}-min`}
                className="rater-generate-panel__input"
              />
            </label>
            <label className="rater-generate-panel__field">
              <span className="rater-generate-panel__field-label">Max</span>
              <input
                type="number"
                inputMode="decimal"
                value={maxDraft}
                onChange={(e) => setMaxDraft(e.target.value)}
                data-testid={`${testId}-max`}
                className="rater-generate-panel__input"
              />
            </label>
            <label className="rater-generate-panel__field">
              <span className="rater-generate-panel__field-label">Count</span>
              <input
                type="number"
                inputMode="numeric"
                min="2"
                max="100"
                value={countDraft}
                onChange={(e) => setCountDraft(e.target.value)}
                data-testid={`${testId}-count`}
                className="rater-generate-panel__input"
              />
            </label>
          </div>
          <div
            className="rater-generate-panel__preview"
            data-testid={`${testId}-preview`}
          >
            <div className="rater-generate-panel__col-label">Preview</div>
            {isValid ? (
              <div
                className="rater-generate-panel__preview-list"
                aria-live="polite"
              >
                {previewLevels.slice(0, 5).map((l, i) => (
                  <div
                    key={l.id}
                    className="rater-generate-panel__preview-row"
                  >
                    <span className="rater-generate-panel__preview-num">
                      L{i + 1}
                    </span>
                    <code className="rater-generate-panel__preview-id">{l.id}</code>
                    <span className="rater-generate-panel__preview-range">
                      {defaultBandLabel(l.lo!, l.hi!)}
                    </span>
                  </div>
                ))}
                {previewLevels.length > 5 && (
                  <div className="rater-generate-panel__preview-row rater-generate-panel__preview-row--more">
                    … {previewLevels.length - 5} more
                  </div>
                )}
              </div>
            ) : (
              <div className="rater-generate-panel__preview-empty">
                {method === "log-scale" && min <= 0
                  ? "Log-scale requires min > 0."
                  : max <= min
                    ? "Set max > min."
                    : count < 2
                      ? "Count must be ≥ 2."
                      : "Enter min, max, and count to preview."}
              </div>
            )}
          </div>
        </div>
      </div>

      {willReplace && handTuned && (
        <div
          className="rater-generate-panel__warning"
          role="alert"
          data-testid={`${testId}-replace-warning`}
        >
          <span className="rater-generate-panel__warning-icon">!</span>
          <span>
            Generating will <strong>replace your {currentLevels.length} existing
            hand-tuned band{currentLevels.length === 1 ? "" : "s"}</strong>.
            Custom labels will be discarded.
          </span>
        </div>
      )}

      <div className="rater-generate-panel__actions">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          data-testid={`${testId}-cancel`}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleApply}
          disabled={!isValid}
          data-testid={`${testId}-apply`}
        >
          {willReplace && handTuned
            ? `Replace ${currentLevels.length} bands`
            : willReplace
              ? `Replace ${currentLevels.length} bands`
              : "Generate"}
        </Button>
      </div>
    </div>
  );
}
