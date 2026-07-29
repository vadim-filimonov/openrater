/**
 * Unit tests for `derive.composite` (ADR-0025 / FCA #21).
 *
 * Locks the projection-side contract that was missing when the spec's
 * own recommended composite shape built into a plan that refused
 * every row:
 *   - member level ids join with the substrate's "·" separator, in
 *     port order (joins are not commutative)
 *   - an unresolved member ("" level id) yields "" — ONE clean
 *     unknown-key miss downstream, never a garbled partial key
 *   - the row issue names the member that failed, not the downstream
 *     lookup's opaque unknown-key
 *   - explainStep renders the auditor-friendly join line
 */

import { describe, it, expect } from "vitest";
import { DeriveCompositeKind } from "./derive-composite";
import { COMPOSITE_LEVEL_SEPARATOR } from "../dimension-types";

describe("derive.composite — execute", () => {
  it("joins two member level ids with the substrate separator, in port order", () => {
    const out = DeriveCompositeKind.execute(
      { part_1: "pts_1", part_2: "lic_10_plus" },
      { dimSlug: "gd_basis", partNames: ["sdip_band", "lic_band"] },
    );
    expect(out.level_id).toBe(`pts_1${COMPOSITE_LEVEL_SEPARATOR}lic_10_plus`);
  });

  it("joins three members when part_3 is wired (R-065 caps at 3)", () => {
    const out = DeriveCompositeKind.execute(
      { part_1: "a", part_2: "b", part_3: "c" },
      { dimSlug: "triple" },
    );
    expect(out.level_id).toBe("a·b·c");
  });

  it("an unresolved member poisons the key to '' — one clean miss, no partial key", () => {
    const out = DeriveCompositeKind.execute(
      { part_1: "", part_2: "lic_10_plus" },
      { dimSlug: "gd_basis" },
    );
    expect(out.level_id).toBe("");
  });

  it("coerces non-string member values defensively (externalInputs are unknown)", () => {
    const out = DeriveCompositeKind.execute(
      {
        part_1: 68510 as unknown as string,
        part_2: "T4",
      },
      { dimSlug: "zip_x_terr" },
    );
    expect(out.level_id).toBe("68510·T4");
  });
});

describe("derive.composite — row issues + explain", () => {
  it("names the unresolved MEMBER in the row issue, not the downstream lookup", () => {
    const issues = DeriveCompositeKind.collectRowIssues!(
      { part_1: "pts_1", part_2: "" },
      { dimSlug: "gd_basis", partNames: ["sdip_band", "lic_band"] },
      { level_id: "" },
    );
    expect(issues).toHaveLength(1);
    expect(issues![0]!.message).toContain("`gd_basis`");
    expect(issues![0]!.message).toContain("`lic_band`");
    expect(issues![0]!.severity).toBe("warning");
  });

  it("no issues on a resolved key", () => {
    expect(
      DeriveCompositeKind.collectRowIssues!(
        { part_1: "a", part_2: "b" },
        { dimSlug: "x" },
        { level_id: "a·b" },
      ),
    ).toBeUndefined();
  });

  it("explainStep renders the join as its own trace line", () => {
    const line = DeriveCompositeKind.explainStep!(
      { part_1: "pts_1", part_2: "lic_10_plus" },
      { dimSlug: "gd_basis", partNames: ["sdip_band", "lic_band"] },
      { level_id: "pts_1·lic_10_plus" },
    );
    expect(line).toBe(
      "gd_basis = sdip_band=pts_1 + lic_band=lic_10_plus → pts_1·lic_10_plus",
    );
  });

  it("explainStep marks the unresolved member", () => {
    const line = DeriveCompositeKind.explainStep!(
      { part_1: "", part_2: "b" },
      { dimSlug: "gd", partNames: ["a_band", "b_band"] },
      { level_id: "" },
    );
    expect(line).toContain("a_band=(unresolved)");
    expect(line).toContain("→ unresolved");
  });
});
