/**
 * Brief 44 PR 44.6 — `<GeoTransformerPicker>`.
 *
 * A small row primitive consumed by the Inputs workspace (Brief 38)
 * when the CSV column doesn't natively match the geo dim's
 * granularity. Three slots:
 *
 *   · Expected — derived from the dim (granularity + display name)
 *   · CSV col  — the user's column header + a sample value
 *   · Transform — a dropdown of valid transformers (filtered to
 *     ones whose output granularity matches the dim) + a live
 *     preview ("53201 → WI") so the actuary sees what each pick does
 *
 * Visual lock: §1.5 ASCII frame in the Brief 44 markdown. BEM CSS,
 * no inline styles, no emojis.
 */

import { useMemo } from "react";

import {
  GEO_TRANSFORMER_META,
  applyTransformer,
  suggestTransformer,
  type GeoTransformerId,
} from "./geoTransformers";

import "./GeoTransformerPicker.css";

export interface GeoTransformerPickerProps {
  /** Geo dim granularity — drives which transformers are offered. */
  readonly dimGranularity: "state" | "county" | "zip";
  /** Display name of the dim (header copy). */
  readonly dimDisplayName: string;
  /** User's CSV column header. */
  readonly csvColumnName: string;
  /** Optional sample value — drives auto-suggest + preview. */
  readonly csvSampleValue?: string;
  /** The currently picked transformer. Falls back to a suggestion when omitted. */
  readonly value?: GeoTransformerId;
  /** Called when the user picks a different transformer. */
  readonly onChange: (next: GeoTransformerId) => void;
  /** Optional `data-testid`. */
  readonly testId?: string;
}

const ID_LABEL_BY_GRANULARITY: Readonly<Record<"state" | "county" | "zip", string>> = {
  state: "USPS state code",
  county: "5-digit county FIPS",
  zip: "5-digit ZCTA",
};

export function GeoTransformerPicker({
  dimGranularity,
  dimDisplayName,
  csvColumnName,
  csvSampleValue,
  value,
  onChange,
  testId = "rater-geo-transformer-picker",
}: GeoTransformerPickerProps): JSX.Element {
  const suggestion = useMemo(
    () => suggestTransformer(csvSampleValue, dimGranularity),
    [csvSampleValue, dimGranularity],
  );
  const effective = value ?? suggestion;

  // Filter the dropdown to transformers whose output matches the dim's
  // granularity. "identity" is always present so the user can opt out.
  const options = useMemo(() => {
    return Object.values(GEO_TRANSFORMER_META).filter((m) => {
      if (m.id === "identity") return true;
      if (m.outputGranularity === "any") return true;
      return m.outputGranularity === dimGranularity;
    });
  }, [dimGranularity]);

  // Live preview using the picked transformer + the sample value.
  const previewOut =
    csvSampleValue && csvSampleValue.trim()
      ? applyTransformer(effective, csvSampleValue)
      : null;
  const previewLabel = csvSampleValue?.trim() ?? "(no sample)";

  return (
    <div
      className="rater-geo-transformer-picker"
      data-testid={testId}
      role="group"
      aria-label="Geographic transformer picker"
    >
      <div className="rater-geo-transformer-picker__col rater-geo-transformer-picker__col--expected">
        <span className="rater-geo-transformer-picker__label">Expected</span>
        <span className="rater-geo-transformer-picker__value">
          <strong>{dimDisplayName}</strong>{" "}
          <span className="rater-geo-transformer-picker__hint">
            ({dimGranularity}, {ID_LABEL_BY_GRANULARITY[dimGranularity]})
          </span>
        </span>
      </div>

      <div className="rater-geo-transformer-picker__col rater-geo-transformer-picker__col--csv">
        <span className="rater-geo-transformer-picker__label">CSV col</span>
        <span className="rater-geo-transformer-picker__value">
          <code className="rater-geo-transformer-picker__code">{csvColumnName}</code>
        </span>
      </div>

      <div className="rater-geo-transformer-picker__col rater-geo-transformer-picker__col--transform">
        <label className="rater-geo-transformer-picker__label" htmlFor={`${testId}-select`}>
          Transform
        </label>
        <select
          id={`${testId}-select`}
          className="rater-geo-transformer-picker__select"
          value={effective}
          onChange={(e) => onChange(e.target.value as GeoTransformerId)}
        >
          {options.map((m) => (
            <option key={m.id} value={m.id} title={m.hint}>
              {m.label}
              {m.id === suggestion && value === undefined ? "  (suggested)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="rater-geo-transformer-picker__col rater-geo-transformer-picker__col--preview">
        <span className="rater-geo-transformer-picker__label">Preview</span>
        <span className="rater-geo-transformer-picker__value">
          <code className="rater-geo-transformer-picker__code">{previewLabel}</code>
          <span className="rater-geo-transformer-picker__arrow"> → </span>
          {previewOut !== null ? (
            <code className="rater-geo-transformer-picker__code rater-geo-transformer-picker__code--out">
              {previewOut}
            </code>
          ) : (
            <span className="rater-geo-transformer-picker__bad">
              {effective === "zip5_to_county"
                ? "(ZIP→county lazy-load deferred)"
                : "(no match)"}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
