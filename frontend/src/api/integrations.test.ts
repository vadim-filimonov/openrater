// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * The mapper's auto-matcher (Brief 77 step 3) — pure + pinned. exact
 * means normalized keys/labels agree (namespaces stripped); likely
 * means every token of the plan key appears in the peer field; guess
 * means the plan LABEL's tokens mostly appear (length-weighted ≥ 0.6
 * with at least one long token — the Brief 57 lesson: a lone short
 * shared token never qualifies). Anything looser is NO match.
 */
import { describe, expect, it } from "vitest";
import { autoMatch, exampleValueFor, type CatalogField } from "./integrations";

const CATALOG: CatalogField[] = [
  { key: "rest.gross_receipts", label: "Annual gross receipts", dtype: "number", unit: "USD" },
  { key: "property.construction_type", label: "Construction type", dtype: "enum" },
  { key: "geo.zip", label: "ZIP code", dtype: "string" },
  { key: "property.tiv", label: "Total insured value", dtype: "number" },
  { key: "property.quality_grade", label: "Property quality grade", dtype: "string", example: "q2" },
];

describe("autoMatch", () => {
  it("matches a namespaced peer key by its tail — exact", () => {
    expect(autoMatch({ key: "zip", label: "ZIP" }, CATALOG)).toEqual({
      peerKey: "geo.zip",
      confidence: "exact",
    });
  });

  it("matches by normalized label — exact", () => {
    expect(
      autoMatch({ key: "annual_gross_sales", label: "Annual gross receipts" }, CATALOG),
    ).toEqual({ peerKey: "rest.gross_receipts", confidence: "exact" });
  });

  it("matches token containment — likely, confirm required", () => {
    expect(
      autoMatch({ key: "construction_type", label: null }, CATALOG),
    ).toEqual({ peerKey: "property.construction_type", confidence: "exact" });
    expect(autoMatch({ key: "construction", label: null }, CATALOG)).toEqual({
      peerKey: "property.construction_type",
      confidence: "likely",
    });
  });

  it("guesses on strong label similarity — the quality-grade case", () => {
    expect(
      autoMatch({ key: "risk_quality", label: "Meridian Quality Grade" }, CATALOG),
    ).toEqual({ peerKey: "property.quality_grade", confidence: "guess" });
  });

  it("never fuzzy-matches — one short shared token is not a guess", () => {
    expect(autoMatch({ key: "annual_payroll", label: "Annual payroll" }, CATALOG)).toBeNull();
    expect(autoMatch({ key: "material_grade", label: "Material grade" }, CATALOG)).toBeNull();
  });
});

describe("exampleValueFor", () => {
  it("normalizes money display formatting to the wire shape", () => {
    expect(
      exampleValueFor(
        { dtype: "money", allowed_values: null },
        { example: "$850,000", dtype: "money" },
      ),
    ).toBe("850000");
  });

  it("refuses to prefill a value outside the plan's accepted set", () => {
    expect(
      exampleValueFor(
        {
          dtype: "string",
          allowed_values: [
            { value: "q1", label: "Quality grade 1" },
            { value: "q3", label: "Quality grade 3" },
          ],
        },
        { example: "q2", dtype: "string" },
      ),
    ).toBeNull();
  });

  it("prefills an accepted enumerated value verbatim", () => {
    expect(
      exampleValueFor(
        { dtype: "string", allowed_values: [{ value: "frame", label: "Frame" }] },
        { example: "frame", dtype: "string" },
      ),
    ).toBe("frame");
  });

  it("normalizes booleans and skips unparseable examples", () => {
    expect(
      exampleValueFor({ dtype: "bool", allowed_values: null }, { example: "Yes", dtype: "enum" }),
    ).toBe("true");
    expect(
      exampleValueFor({ dtype: "number", allowed_values: null }, { example: "inside · SF", dtype: "string" }),
    ).toBeNull();
    expect(
      exampleValueFor({ dtype: "string", allowed_values: null }, undefined),
    ).toBeNull();
  });
});
