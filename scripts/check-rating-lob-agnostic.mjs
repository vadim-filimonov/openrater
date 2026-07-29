#!/usr/bin/env node
/**
 * check-rating-lob-agnostic.mjs — Brief 82 O-2 (owner, 2026-07-10).
 *
 * "This rating platform has to be plan agnostic — it should work for
 * a BOP plan as well as it would work for a personal auto."
 *
 * Two gates, one invariant:
 *
 * 1. FRONTEND — no line-of-business noun ships as UI copy in any
 *    Rating surface component. Every visible noun must arrive via
 *    plan data (tower names, dimension display names, input display
 *    names, table names). BOP words in FIXTURES and TESTS are fine —
 *    they are plan data; this scans only the shipped component
 *    sources.
 *
 * 2. BACKEND (owner directive 2026-07-14) — no program VALUE ships
 *    as a platform default in the plan-authoring core. The leak this
 *    ratchets against: `configs.py` used to default
 *    `ClassificationLookupConfig.output_fields` to a BOP column
 *    list and `TerritoryResolverConfig.fallback_territory` to the
 *    Kansas territory code "704". Program-shaped knowledge arrives
 *    as plan data, never as platform source. Token list mirrors
 *    `test_ingest_sources_carry_no_program_literals` (word-bounded
 *    program tokens; comments + docstrings stripped so historical
 *    port notes stay legal).
 *
 * Mechanics: strip comments (they may cite BOP examples), then fail
 * on any banned word. Values in each scan set are chosen to be
 * unambiguous — generic insurance grammar (premium, coverage,
 * deductible, endorsement, exposure, territory-as-a-concept) stays
 * legal.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The Rating tab's shipped surface (components only — no tests). */
const SCAN_FILES = [
  "packages/ui/src/BuildUpSheet/BuildUpSheet.tsx",
  "packages/ui/src/RatingInlineGrid/RatingInlineGrid.tsx",
  "frontend/src/components/AlgorithmSheet/AlgorithmMount.tsx",
  ...readdirSync(join(root, "frontend/src/components/RatingChrome"))
    .filter((n) => n.endsWith(".tsx"))
    .map((n) => `frontend/src/components/RatingChrome/${n}`),
];

/** Unambiguous LOB nouns. Add words as new lines of business land. */
const BANNED =
  /\b(bop|businessowners?|bpp|sprinklered?|constructions?|territor(?:y|ies)|buildings?|liabilit(?:y|ies)|dwellings?|homeowners?|collision|comprehensive|bodily\s+injury)\b/i;

/**
 * Backend platform core — the plan-authoring module. Scans every .py
 * in `rates/plans/`, no exemptions (the last two pieces of dormant
 * port debt — author.py's disabled starter-template constant and
 * errors.py's legacy error aliases — retired 2026-07-14).
 */
const BACKEND_SCAN_DIR = "server/src/openrater/rates/plans";
const BACKEND_SCAN_FILES = readdirSync(join(root, BACKEND_SCAN_DIR))
  .filter((n) => n.endsWith(".py"))
  .map((n) => `${BACKEND_SCAN_DIR}/${n}`);

/**
 * Program tokens (never generic insurance grammar): the programs +
 * carriers the platform has been exercised against, plus the exact
 * identifiers the two shipped defaults used to carry. Word-bounded,
 * so LOB *catalog entries* like `LineOfBusiness.BOP = "bop"` stay
 * legal (the genericity invariant allows catalog vocabulary; it
 * forbids program VALUES in platform machinery).
 */
const BACKEND_BANNED =
  /\b(iso[ _-]?bop\w*|insurance services office|meridian|kansas|cincinnati|nonprofit|ntee|bowling|bmut|is_eligible_bop|eq_zone|eq_sl|liability[ _]class[ _]group|704)\b/i;

function stripComments(src) {
  // Block comments (incl. JSDoc), then line comments. Good enough for
  // a lint gate — string literals containing "//" (URLs) are rare in
  // these files and a false STRIP there can only hide a violation in
  // a URL, which the word list wouldn't match anyway.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function stripPython(src) {
  // Triple-quoted strings (docstrings — the only triple-quoted usage
  // in the scanned files), then # line comments. Same "good enough
  // for a lint gate" bar as stripComments: a # inside a regular
  // string literal over-strips that line's tail, nothing more.
  return src
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/'''[\s\S]*?'''/g, "")
    .replace(/#[^\n]*/g, "");
}

function scan(files, strip, banned) {
  const violations = [];
  for (const file of files) {
    const stripped = strip(readFileSync(join(root, file), "utf8"));
    stripped.split("\n").forEach((line, i) => {
      const m = line.match(banned);
      if (m) {
        violations.push({
          file,
          line: i + 1,
          word: m[0],
          text: line.trim().slice(0, 90),
        });
      }
    });
  }
  return violations;
}

const frontendFiles = SCAN_FILES.filter((f) => !f.endsWith(".test.tsx"));

if (frontendFiles.length === 0 || BACKEND_SCAN_FILES.length === 0) {
  console.error("check-rating-lob-agnostic: a scan set resolved to 0 files");
  process.exit(1);
}

const violations = [
  ...scan(frontendFiles, stripComments, BANNED),
  ...scan(BACKEND_SCAN_FILES, stripPython, BACKEND_BANNED),
];

if (violations.length > 0) {
  console.error(
    `check-rating-lob-agnostic: ${violations.length} LOB/program literal(s) in platform sources (O-2):`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — "${v.word}" in: ${v.text}`);
  }
  console.error(
    "Every LOB noun and program value must come from plan data (Brief 82 O-2; ADR-0033 §0).",
  );
  process.exit(1);
}

console.log(
  `\x1b[32m✓ rating-lob-agnostic: ${frontendFiles.length} Rating surface files + ${BACKEND_SCAN_FILES.length} backend platform files — no LOB/program literal (O-2).\x1b[0m`,
);
