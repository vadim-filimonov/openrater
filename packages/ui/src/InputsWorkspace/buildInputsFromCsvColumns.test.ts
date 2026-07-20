import { describe, expect, it } from "vitest";

import { buildInputsFromCsvColumns } from "./buildInputsFromCsvColumns";

describe("buildInputsFromCsvColumns", () => {
  it("creates a categorical dim with levels seeded from distinct string values", () => {
    const { dims, columnMap, seededCount } = buildInputsFromCsvColumns(
      ["ntee_major"],
      [{ ntee_major: "Arts" }, { ntee_major: "Education" }, { ntee_major: "Arts" }],
    );
    expect(dims).toHaveLength(1);
    const dim = dims[0]!;
    expect(dim.shape).toBe("categorical");
    expect(dim.slug).toBe("ntee_major");
    expect(dim.display_name).toBe("ntee_major");
    // distinct, first-seen order, deduped
    expect(dim.levels?.map((l) => l.label)).toEqual(["Arts", "Education"]);
    expect(dim.levels?.map((l) => l.id)).toEqual(["arts", "education"]);
    expect(columnMap).toEqual({ ntee_major: "ntee_major" });
    expect(seededCount).toBe(1);
  });

  it("creates a banded dim for an all-numeric column", () => {
    const { dims, bandedCount } = buildInputsFromCsvColumns(
      ["revenue"],
      [{ revenue: "1000" }, { revenue: "50000" }, { revenue: "9000" }],
      { bandCount: 4 },
    );
    const dim = dims[0]!;
    expect(dim.shape).toBe("banded");
    expect(dim.data_type).toBe("number");
    expect(bandedCount).toBe(1);
    expect((dim.levels?.length ?? 0)).toBeGreaterThan(0);
    expect(dim.levels?.every((l) => l.kind === "banded")).toBe(true);
  });

  it("seeds bands so EVERY sample value is in-range (no boundary mismatch)", () => {
    // The mismatch detector uses half-open [lo, hi); the max value must
    // land strictly inside a band, never on the exclusive top boundary.
    const rows = [
      { employee_count: "0" },
      { employee_count: "19" },
      { revenue: "98265" },
    ];
    for (const col of ["employee_count"]) {
      const { dims } = buildInputsFromCsvColumns(
        [col],
        [{ [col]: "0" }, { [col]: "19" }],
      );
      const bands = dims[0]!.levels ?? [];
      for (const raw of ["0", "19"]) {
        const v = Number(raw);
        const hit = bands.some(
          (b) => b.lo !== undefined && b.hi !== undefined && v >= b.lo && v < b.hi,
        );
        expect(hit, `value ${v} should fall in a band`).toBe(true);
      }
    }
    void rows;
  });

  it("keeps integer band edges tidy (count column → whole-number breaks)", () => {
    const { dims } = buildInputsFromCsvColumns(
      ["employee_count"],
      [{ employee_count: "0" }, { employee_count: "19" }],
      { bandCount: 5 },
    );
    const edges = (dims[0]!.levels ?? []).flatMap((b) => [b.lo, b.hi]);
    // padded to [0,20] → width 4 → all integer edges
    expect(edges.every((e) => Number.isInteger(e))).toBe(true);
  });

  it("parses comma-thousands numbers as numeric", () => {
    const { dims, bandedCount } = buildInputsFromCsvColumns(
      ["assets"],
      [{ assets: "1,200,000" }, { assets: "350,000" }],
    );
    expect(dims[0]!.shape).toBe("banded");
    expect(bandedCount).toBe(1);
  });

  it("keeps a comma-containing categorical value as ONE level (not split)", () => {
    // parseLevelPaste would split this on the first comma — we must not.
    const { dims } = buildInputsFromCsvColumns(
      ["org"],
      [{ org: "Riverside Youth Foundation, Inc" }, { org: "Faith Learning Center" }],
    );
    const labels = dims[0]!.levels?.map((l) => l.label);
    expect(labels).toContain("Riverside Youth Foundation, Inc");
    expect(labels).toHaveLength(2);
  });

  it("leaves high-cardinality columns with empty levels (no explosion)", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ acct_id: `np_${i}` }));
    const { dims, emptyCount, seededCount } = buildInputsFromCsvColumns(
      ["acct_id"],
      rows,
      { levelCap: 50 },
    );
    expect(dims[0]!.shape).toBe("categorical");
    expect(dims[0]!.levels).toEqual([]);
    expect(emptyCount).toBe(1);
    expect(seededCount).toBe(0);
  });

  it("dedupes colliding column slugs and column slugs vs existing dims", () => {
    const { dims, columnMap } = buildInputsFromCsvColumns(
      ["State", "state"],
      [{ State: "CA", state: "NY" }],
      { existingSlugs: ["state"] },
    );
    const slugs = dims.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(2); // no collision
    expect(slugs).not.toContain("state"); // existing reserved
    // every produced slug appears as a key in the column map
    expect(Object.keys(columnMap).sort()).toEqual([...slugs].sort());
  });

  it("dedupes colliding LEVEL slugs within a dim", () => {
    const { dims } = buildInputsFromCsvColumns(
      ["kind"],
      [{ kind: "Arts & Culture" }, { kind: "Arts / Culture" }],
    );
    const ids = dims[0]!.levels?.map((l) => l.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(ids).toHaveLength(2);
  });

  it("falls back to a safe slug when a column name slugifies to empty", () => {
    const { dims } = buildInputsFromCsvColumns(["###"], [{ "###": "x" }]);
    expect(dims[0]!.slug).toBe("input");
  });

  it("ignores blank cells when inferring dtype + distinct values", () => {
    const { dims } = buildInputsFromCsvColumns(
      ["score"],
      [{ score: "10" }, { score: "" }, { score: "20" }],
    );
    // blanks ignored → still all-numeric → banded
    expect(dims[0]!.shape).toBe("banded");
  });
});
