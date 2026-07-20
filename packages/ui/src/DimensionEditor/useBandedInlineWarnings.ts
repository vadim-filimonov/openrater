/**
 * useBandedInlineWarnings — banded gap/overlap detection as inline
 * warning rows (Brief 66 §3.5; extracted from the legacy
 * DimensionEditor so dims2 consumes the SAME integrity validation).
 *
 * A banded domain with holes looks healthy and mis-prices at runtime
 * (values fall out_of_range / clamp) — the legacy editor caught this
 * with validateBandedDimension + inline warning rows + a one-click
 * "+ Add band" gap fix, and the dims2 port left it behind. This hook is
 * the shared derivation: both surfaces map issues identically; only the
 * commit callback differs.
 */

import { useMemo } from "react";
import {
  validateBandedDimension,
  describeBandedIssue,
  type BandedDimensionIssue,
  type DimensionLevel,
} from "@openrater/contracts";
import { defaultBandId } from "./banded-utils";
import type { LevelInlineWarning, LevelRow } from "./LevelRowsTable";

/**
 * @param shape    The edited shape — non-"banded" yields [] (no work).
 * @param levels   The current level rows (the editable vector).
 * @param onInsertLevels Commit a full replacement level vector (the gap
 *                 fix inserts a band into the gap span). Omit to render
 *                 warnings without the fix CTA (read-only surfaces).
 */
export function useBandedInlineWarnings(
  shape: string,
  levels: readonly LevelRow[],
  onInsertLevels?: (levels: readonly LevelRow[]) => void,
): readonly LevelInlineWarning[] {
  return useMemo(() => {
    if (shape !== "banded") return [];
    const normalized: readonly DimensionLevel[] = levels.map(
      (l) =>
        ({
          kind: "banded" as const,
          id: l.id,
          label: l.label,
          lo: typeof l.lo === "number" ? l.lo : NaN,
          hi: typeof l.hi === "number" ? l.hi : NaN,
        }) satisfies DimensionLevel,
    );
    const issues = validateBandedDimension(normalized).filter(
      (
        i,
      ): i is Extract<
        BandedDimensionIssue,
        { kind: "gap" } | { kind: "overlap" }
      > => i.kind === "gap" || i.kind === "overlap",
    );
    return issues.map((issue) => ({
      afterIndex: issue.afterIndex,
      id: `${issue.kind}-${issue.afterIndex}`,
      title: issue.kind === "gap" ? "Coverage gap" : "Band overlap",
      detail: describeBandedIssue(issue),
      ...(issue.kind === "gap" && onInsertLevels
        ? {
            onFix: () => {
              const existingIds = new Set(levels.map((l) => l.id));
              const base = defaultBandId(issue.lo, issue.hi);
              let candidate = base;
              let suffix = 1;
              while (existingIds.has(candidate)) {
                suffix += 1;
                candidate = `${base}_${suffix}`;
              }
              onInsertLevels([
                ...levels.slice(0, issue.afterIndex + 1),
                {
                  kind: "banded",
                  id: candidate,
                  label: "",
                  lo: issue.lo,
                  hi: issue.hi,
                },
                ...levels.slice(issue.afterIndex + 1),
              ]);
            },
          }
        : {}),
    }));
  }, [shape, levels, onInsertLevels]);
}
