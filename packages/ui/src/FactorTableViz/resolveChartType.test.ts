/**
 * resolveChartType tests — Brief 34 PR 34.4.
 */

import { describe, expect, it } from "vitest";
import {
  availableChartTypes,
  resolveChartType,
  DEFAULT_VIZ_CONFIG,
} from "./resolveChartType";

describe("resolveChartType — auto path", () => {
  it("1-D categorical → bar", () => {
    expect(
      resolveChartType({ is2D: false, rowBanded: false, colBanded: false }),
    ).toBe("bar");
  });

  it("1-D banded → line", () => {
    expect(
      resolveChartType({ is2D: false, rowBanded: true, colBanded: false }),
    ).toBe("line");
  });

  it("2-D categorical × categorical → heatmap", () => {
    expect(
      resolveChartType({ is2D: true, rowBanded: false, colBanded: false }),
    ).toBe("heatmap");
  });

  it("2-D banded × categorical → small-multiples", () => {
    expect(
      resolveChartType({ is2D: true, rowBanded: true, colBanded: false }),
    ).toBe("small-multiples");
  });

  it("2-D categorical × banded → small-multiples", () => {
    expect(
      resolveChartType({ is2D: true, rowBanded: false, colBanded: true }),
    ).toBe("small-multiples");
  });

  it("2-D banded × banded → heatmap (surface is opt-in)", () => {
    expect(
      resolveChartType({ is2D: true, rowBanded: true, colBanded: true }),
    ).toBe("heatmap");
  });
});

describe("resolveChartType — override path", () => {
  it("honors override over auto", () => {
    expect(
      resolveChartType(
        { is2D: true, rowBanded: false, colBanded: false },
        { chartType: "small-multiples" },
      ),
    ).toBe("small-multiples");
  });

  it("'auto' falls back to shape-based pick", () => {
    expect(
      resolveChartType(
        { is2D: false, rowBanded: true, colBanded: false },
        { chartType: "auto" },
      ),
    ).toBe("line");
  });

  it("DEFAULT_VIZ_CONFIG behaves as auto", () => {
    expect(
      resolveChartType(
        { is2D: false, rowBanded: false, colBanded: false },
        DEFAULT_VIZ_CONFIG,
      ),
    ).toBe("bar");
  });

  it("surface override is honored when caller asks", () => {
    expect(
      resolveChartType(
        { is2D: true, rowBanded: true, colBanded: true },
        { chartType: "surface" },
      ),
    ).toBe("surface");
  });
});

describe("availableChartTypes", () => {
  it("1-D shows bar + line + distribution, all enabled (Brief 45 PR 45.5)", () => {
    const entries = availableChartTypes({
      is2D: false,
      rowBanded: false,
      colBanded: false,
    });
    expect(entries.map((e) => e.chartType)).toEqual([
      "bar",
      "line",
      "distribution",
    ]);
    expect(entries.every((e) => !e.disabled)).toBe(true);
  });

  it("2-D shows heatmap + small-multiples — the Surface pill stays OFF until its renderer exists (Brief 67)", () => {
    const entries = availableChartTypes({
      is2D: true,
      rowBanded: true,
      colBanded: true,
    });
    expect(entries.map((e) => e.chartType)).toEqual([
      "heatmap",
      "small-multiples",
    ]);
  });

  // ────────────────────────────────────────────────────────────────
  // Brief 44 PR 44.5 — Map pill availability
  // ────────────────────────────────────────────────────────────────

  it("map pill appears for 1-D geographic tables", () => {
    const entries = availableChartTypes({
      is2D: false,
      rowBanded: false,
      colBanded: false,
      rowGeographic: true,
    });
    const map = entries.find((e) => e.chartType === "map");
    expect(map).toBeDefined();
    expect(map?.disabled).toBe(false);
  });

  it("map pill is absent for 1-D non-geographic tables", () => {
    const entries = availableChartTypes({
      is2D: false,
      rowBanded: false,
      colBanded: false,
    });
    expect(entries.find((e) => e.chartType === "map")).toBeUndefined();
  });

  it("map pill is absent for 2-D tables (even geographic)", () => {
    const entries = availableChartTypes({
      is2D: true,
      rowBanded: false,
      colBanded: false,
      rowGeographic: true,
    });
    expect(entries.find((e) => e.chartType === "map")).toBeUndefined();
  });

  it("map mode is never auto-picked (1-D categorical + geographic → bar)", () => {
    expect(
      resolveChartType({
        is2D: false,
        rowBanded: false,
        colBanded: false,
        rowGeographic: true,
      }),
    ).toBe("bar");
  });

  it("map mode honors the override", () => {
    expect(
      resolveChartType(
        { is2D: false, rowBanded: false, colBanded: false, rowGeographic: true },
        { chartType: "map" },
      ),
    ).toBe("map");
  });
});

describe("resolveChartType — Brief 45 PR 45.5 (callout + distribution)", () => {
  it("1-D uniform (ratio < 0.005, populated ≥ 2) → callout", () => {
    expect(
      resolveChartType({
        is2D: false,
        rowBanded: false,
        colBanded: false,
        populatedCount: 50,
        uniformityRatio: 0,
      }),
    ).toBe("callout");
  });

  it("1-D uniform at non-1.0 constant value still routes to callout", () => {
    expect(
      resolveChartType({
        is2D: false,
        rowBanded: false,
        colBanded: false,
        populatedCount: 20,
        uniformityRatio: 0.001,
      }),
    ).toBe("callout");
  });

  it("1-D uniform with single populated cell DOES NOT route to callout (needs ≥ 2)", () => {
    expect(
      resolveChartType({
        is2D: false,
        rowBanded: false,
        colBanded: false,
        populatedCount: 1,
        uniformityRatio: 0,
      }),
    ).toBe("bar");
  });

  it("1-D uniform with null uniformityRatio falls through to bar/line", () => {
    expect(
      resolveChartType({
        is2D: false,
        rowBanded: false,
        colBanded: false,
        populatedCount: 5,
        uniformityRatio: null,
      }),
    ).toBe("bar");
  });

  it("1-D dense (>30 levels) → distribution", () => {
    expect(
      resolveChartType({
        is2D: false,
        rowBanded: false,
        colBanded: false,
        populatedCount: 50,
        uniformityRatio: 0.4,
      }),
    ).toBe("distribution");
  });

  it("1-D exactly 30 levels DOES NOT route to distribution (>30 strict)", () => {
    expect(
      resolveChartType({
        is2D: false,
        rowBanded: false,
        colBanded: false,
        populatedCount: 30,
        uniformityRatio: 0.4,
      }),
    ).toBe("bar");
  });

  it("uniform short-circuits dense — flat 500-level table → callout (not distribution)", () => {
    expect(
      resolveChartType({
        is2D: false,
        rowBanded: false,
        colBanded: false,
        populatedCount: 500,
        uniformityRatio: 0.001,
      }),
    ).toBe("callout");
  });

  it("dense + banded → distribution (not line) — density wins over band shape", () => {
    expect(
      resolveChartType({
        is2D: false,
        rowBanded: true,
        colBanded: false,
        populatedCount: 200,
        uniformityRatio: 0.4,
      }),
    ).toBe("distribution");
  });

  it("override beats all auto-routes (override 'bar' wins on dense table)", () => {
    expect(
      resolveChartType(
        {
          is2D: false,
          rowBanded: false,
          colBanded: false,
          populatedCount: 200,
          uniformityRatio: 0.4,
        },
        { chartType: "bar" },
      ),
    ).toBe("bar");
  });

  it("override 'distribution' works on a sparse table too", () => {
    expect(
      resolveChartType(
        {
          is2D: false,
          rowBanded: false,
          colBanded: false,
          populatedCount: 5,
          uniformityRatio: 0.3,
        },
        { chartType: "distribution" },
      ),
    ).toBe("distribution");
  });

  it("availableChartTypes adds the 'Distribution' pill for 1-D shapes", () => {
    const entries = availableChartTypes({
      is2D: false,
      rowBanded: false,
      colBanded: false,
    });
    const dist = entries.find((e) => e.chartType === "distribution");
    expect(dist).toBeDefined();
    expect(dist?.disabled).toBe(false);
  });

  it("availableChartTypes does NOT add 'Distribution' to 2-D shapes", () => {
    const entries = availableChartTypes({
      is2D: true,
      rowBanded: true,
      colBanded: false,
    });
    expect(entries.find((e) => e.chartType === "distribution")).toBeUndefined();
  });
});
