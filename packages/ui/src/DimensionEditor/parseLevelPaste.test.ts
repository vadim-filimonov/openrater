/**
 * Tests for parseLevelPaste — Brief 30 PR 30.9.
 *
 * Covers the grammar the categorical DimensionEditor's "Paste levels"
 * drawer commits to: blank lines, dedupe, `key, label` parsing, CSV
 * header detection, whitespace trimming, label preservation across
 * commas.
 */

import { describe, expect, it } from "vitest";
import { parseLevelPaste } from "./parseLevelPaste";

describe("parseLevelPaste", () => {
  it("returns empty result for empty input", () => {
    const result = parseLevelPaste("");
    expect(result.added).toEqual([]);
    expect(result.hadHeader).toBe(false);
  });

  it("parses one key per line — label defaults to the key", () => {
    const result = parseLevelPaste("AL\nAK\nAZ");
    expect(result.added).toEqual([
      { id: "AL", label: "AL" },
      { id: "AK", label: "AK" },
      { id: "AZ", label: "AZ" },
    ]);
    expect(result.hadHeader).toBe(false);
  });

  it("parses `key, label` rows and trims whitespace around both", () => {
    const result = parseLevelPaste("WI, Wisconsin\n  CA  ,  California  ");
    expect(result.added).toEqual([
      { id: "WI", label: "Wisconsin" },
      { id: "CA", label: "California" },
    ]);
  });

  it("splits on the first comma only — labels may contain commas", () => {
    const result = parseLevelPaste("MAD, Madison, WI");
    expect(result.added).toEqual([
      { id: "MAD", label: "Madison, WI" },
    ]);
  });

  it("skips blank lines", () => {
    const result = parseLevelPaste("AL\n\n\nAK\n  \n");
    expect(result.added).toEqual([
      { id: "AL", label: "AL" },
      { id: "AK", label: "AK" },
    ]);
    expect(
      result.skipped.filter((s) => s.reason === "blank"),
    ).toHaveLength(4);
  });

  it("dedupes within the paste — keeps the first occurrence", () => {
    const result = parseLevelPaste("AL\nAK\nAL");
    expect(result.added).toEqual([
      { id: "AL", label: "AL" },
      { id: "AK", label: "AK" },
    ]);
    expect(
      result.skipped.filter((s) => s.reason === "duplicate"),
    ).toHaveLength(1);
  });

  it("skips rows whose key collides with existingIds", () => {
    const result = parseLevelPaste("AL\nAK\nAZ", {
      existingIds: ["AK"],
    });
    expect(result.added).toEqual([
      { id: "AL", label: "AL" },
      { id: "AZ", label: "AZ" },
    ]);
    const dup = result.skipped.find((s) => s.reason === "duplicate");
    expect(dup?.line).toBe("AK");
  });

  it("skips rows whose key is empty after trimming", () => {
    const result = parseLevelPaste(",only label\nWI, Wisconsin");
    expect(result.added).toEqual([
      { id: "WI", label: "Wisconsin" },
    ]);
    expect(
      result.skipped.find((s) => s.reason === "empty-key")?.line,
    ).toBe(",only label");
  });

  it("treats `key,label` as a CSV header and skips it", () => {
    const result = parseLevelPaste("key,label\nWI,Wisconsin\nMI,Michigan");
    expect(result.hadHeader).toBe(true);
    expect(result.added).toEqual([
      { id: "WI", label: "Wisconsin" },
      { id: "MI", label: "Michigan" },
    ]);
  });

  it("recognises alternate header forms (id/code/slug × name/description)", () => {
    expect(parseLevelPaste("id,name\nA,Alpha").hadHeader).toBe(true);
    expect(parseLevelPaste("code,description\nA,Alpha").hadHeader).toBe(true);
    expect(parseLevelPaste("slug,title\nA,Alpha").hadHeader).toBe(true);
    expect(parseLevelPaste("abbr,name\nWI,Wisconsin").hadHeader).toBe(true);
  });

  it("does NOT treat a real data row as a header", () => {
    const result = parseLevelPaste("WI,Wisconsin\nMI,Michigan");
    expect(result.hadHeader).toBe(false);
    expect(result.added).toEqual([
      { id: "WI", label: "Wisconsin" },
      { id: "MI", label: "Michigan" },
    ]);
  });

  it("only checks the FIRST non-blank line for a header", () => {
    // A "key,label" row mid-paste is treated as data, not a second header.
    const result = parseLevelPaste("WI,Wisconsin\nkey,label\nMI,Michigan");
    expect(result.hadHeader).toBe(false);
    expect(result.added).toEqual([
      { id: "WI", label: "Wisconsin" },
      { id: "key", label: "label" },
      { id: "MI", label: "Michigan" },
    ]);
  });

  it("tolerates CRLF line endings", () => {
    const result = parseLevelPaste("AL\r\nAK\r\nAZ");
    expect(result.added).toEqual([
      { id: "AL", label: "AL" },
      { id: "AK", label: "AK" },
      { id: "AZ", label: "AZ" },
    ]);
  });

  it("handles the 51-USPS-codes paste in one shot", () => {
    const codes = [
      "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
      "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
      "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
      "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
      "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
      "WY",
    ];
    const result = parseLevelPaste(codes.join("\n"));
    expect(result.added).toHaveLength(51);
    expect(result.added[0]).toEqual({ id: "AL", label: "AL" });
    expect(result.added[50]).toEqual({ id: "WY", label: "WY" });
  });
});
