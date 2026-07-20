/**
 * dimensionMeta — Brief 70 Phase 1 (the canonical dimension language).
 *
 * THE single source for how a dimension classifies, labels, counts,
 * and renders everywhere it appears: the Dimensions workspace (the
 * reference consumer), the Factor Tables pick list + axis chips, the
 * Algorithm step bindings, the Eligibility field menu.
 *
 * Extracted VERBATIM from DimensionsWorkspaceV2.tsx (shapeOf /
 * SHAPE_META / countLabel were module-private there) — a pure move;
 * dims2 re-consumes this module so it stays the reference
 * implementation. The owner's complaint this kills: "dimensions
 * aren't even consistent with how they are designed in other
 * sections."
 *
 * Sibling: `shapeIcon.tsx` (shapeIconFor) is the CONTRACT-based
 * classifier (inferDimensionShape + isGeographicLookupDim, ADR-0038
 * read-boundary) used where a dim may be authored with a mismatched
 * shape field. `shapeOf` here is the FIELD-based classifier dims2
 * ships; the two agree for well-formed rows. New surfaces should
 * render through <DimToken>, which routes geo through the ADR-0038
 * predicate so a geo dim authored as categorical still reads
 * geographic.
 */

import type { JSX, ReactNode } from "react";
import { BarChart3, Grid2x2, Library, List, MapPin } from "lucide-react";
import { isGeographicLookupDim } from "@openrater/contracts";
import type { DimensionRow } from "./DimensionsTable";
import "./DimToken.css";

export type DimensionShape =
  | "categorical"
  | "banded"
  | "geographic"
  | "classification"
  | "composite";

/** Classify a row into one of the 5 shapes — mirrors the v1 classifier. */
export function shapeOf(dim: DimensionRow): DimensionShape {
  if (dim.shape === "composite") return "composite";
  if (dim.shape === "banded") return "banded";
  if (dim.dimension_type === "geographic") return "geographic";
  if (dim.dimension_type === "classification") return "classification";
  return "categorical";
}

/**
 * The ADR-0038 read-boundary variant: a geo dim authored with
 * shape:"categorical" still reads GEOGRAPHIC. New surfaces (DimToken)
 * use this; dims2's own list keeps `shapeOf` (its authored-field
 * semantics are part of that workspace's editing contract).
 */
export function shapeOfCanonical(dim: DimensionRow): DimensionShape {
  if (isGeographicLookupDim(dim)) return "geographic";
  return shapeOf(dim);
}

export const SHAPE_META: Record<
  DimensionShape,
  { label: string; icon: ReactNode; unit: string; units: string }
> = {
  categorical: {
    label: "Categorical",
    icon: <List />,
    unit: "level",
    units: "levels",
  },
  banded: {
    label: "Banded",
    icon: <BarChart3 />,
    unit: "band",
    units: "bands",
  },
  geographic: {
    label: "Geographic",
    icon: <MapPin />,
    unit: "territory",
    units: "territories",
  },
  classification: {
    label: "Classification",
    icon: <Library />,
    unit: "class",
    units: "classes",
  },
  composite: {
    label: "Composite",
    icon: <Grid2x2 />,
    unit: "axis",
    units: "axes",
  },
};

/** Count + unit label for a row, by shape ("6 levels", "5 bands", "2 axes"). */
export function countLabel(dim: DimensionRow, shape: DimensionShape): string {
  if (shape === "composite") {
    const n = dim.axes?.length ?? 0;
    return n ? `${n} ${n === 1 ? "axis" : "axes"}` : "composite";
  }
  // Brief 66 §3.3 / ADR-0038 — the geo count follows the canonical
  // domain: TERRITORIES when grouped, else raw levels labeled by
  // granularity. It used to report levels.length as "territories"
  // (a national state dim with 5 territories read "51 territories").
  if (shape === "geographic") {
    const territories = dim.geo_territories?.length ?? 0;
    if (territories > 0) {
      return `${territories} ${territories === 1 ? "territory" : "territories"}`;
    }
    const n = dim.levels?.length ?? 0;
    const grain =
      dim.geo_granularity === "zip"
        ? ["ZIP", "ZIPs"]
        : dim.geo_granularity === "county"
          ? ["county", "counties"]
          : ["state", "states"];
    return `${n} ${n === 1 ? grain[0] : grain[1]}`;
  }
  const n = dim.levels?.length ?? 0;
  const m = SHAPE_META[shape];
  return `${n} ${n === 1 ? m.unit : m.units}`;
}

/* ──────────────────────────────────────────────────────────────────
   <DimToken> — the one way a dimension renders outside its home
   workspace. Neutral tile (the glyph is the only shape signal, per
   the V2 spec §1.1 reversion), display name, mono slug, unit-grammar
   count. Three densities:
     inline — 18px tile + name (binding sentences, chips)
     row    — 26px tile + name/slug + count (pick lists; ≈ dims2 row)
     header — 40px tile (detail panes)
   ────────────────────────────────────────────────────────────────── */

export interface DimTokenProps {
  readonly dim: DimensionRow;
  readonly density?: "inline" | "row" | "header";
  /** Show the count (row/header densities). Default true for row. */
  readonly count?: boolean;
  readonly selected?: boolean;
  /**
   * When provided, the token renders as a real button element (the
   * pick-list row contract — click/Enter activates). Without it, a
   * static span.
   */
  readonly onActivate?: () => void;
  readonly disabled?: boolean;
  /** Optional right-side slot (e.g., a "✓ current axis" marker). */
  readonly trailing?: ReactNode;
  readonly testId?: string;
}

export function DimToken(props: DimTokenProps): JSX.Element {
  const {
    dim,
    density = "row",
    count = density !== "inline",
    selected = false,
    onActivate,
    disabled = false,
    trailing,
    testId,
  } = props;
  const shape = shapeOfCanonical(dim);
  const meta = SHAPE_META[shape];
  const name = dim.display_name || dim.slug;

  const body = (
    <>
      <span
        className={`rater-dimtoken__tile rater-dimtoken__tile--${density}`}
        aria-hidden
      >
        {meta.icon}
      </span>
      {density === "inline" ? (
        <span className="rater-dimtoken__name">{name}</span>
      ) : (
        <span className="rater-dimtoken__body">
          <span className="rater-dimtoken__name">{name}</span>
          <span className="rater-dimtoken__slug">{dim.slug}</span>
        </span>
      )}
      {count ? (
        <span className="rater-dimtoken__count">
          {countLabel(dim, shape)}
        </span>
      ) : null}
      {trailing}
    </>
  );

  const className = `rater-dimtoken rater-dimtoken--${density}${
    selected ? " is-selected" : ""
  }`;

  if (onActivate) {
    return (
      // The pick-list row contract: a real button (keyboard-first; the
      // platform's drag affordances always have this click twin).
      // Registered in the v2-buttons guard: a row selector, not a
      // standard button.
      <button
        type="button"
        className={className}
        onClick={onActivate}
        disabled={disabled}
        data-shape={shape}
        {...(testId !== undefined ? { "data-testid": testId } : {})}
      >
        {body}
      </button>
    );
  }
  return (
    <span
      className={className}
      data-shape={shape}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
    >
      {body}
    </span>
  );
}
