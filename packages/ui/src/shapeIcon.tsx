/**
 * shapeIconFor — Brief 67 §3.5 (one shape vocabulary).
 *
 * The single shape → lucide-icon mapping for dimension chips and axis
 * slots. Matches the Dimensions workspace's SHAPE_META vocabulary
 * (List / BarChart3 / MapPin / Library / Grid2x2) so a dim LOOKS the
 * same in its home section and everywhere it's picked up — and
 * retires the private unicode glyph taxonomy (▣ ╱ ⌖ ⊗ C) that
 * appeared nowhere else on the platform (unicode glyphs for
 * affordances are a constitution violation; for identity they were
 * simply a second language).
 */

import type { ReactNode } from "react";
import { BarChart3, Grid2x2, Library, List, MapPin } from "lucide-react";
import { inferDimensionShape, isGeographicLookupDim } from "@openrater/contracts";
import type { DimensionRow } from "./DimensionsTable";

export function shapeIconFor(dim: DimensionRow, size = 13): ReactNode {
  if (dim.dimension_type === "classification") {
    return <Library size={size} aria-hidden />;
  }
  // ADR-0038 — geo grouping is decided by isGeographicLookupDim at the
  // read boundary (a geo dim authored with shape:"categorical" still
  // reads as geographic).
  if (isGeographicLookupDim(dim)) {
    return <MapPin size={size} aria-hidden />;
  }
  switch (inferDimensionShape(dim)) {
    case "banded":
      return <BarChart3 size={size} aria-hidden />;
    case "composite":
      return <Grid2x2 size={size} aria-hidden />;
    case "categorical":
    default:
      return <List size={size} aria-hidden />;
  }
}
