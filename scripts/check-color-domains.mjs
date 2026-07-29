#!/usr/bin/env node
/**
 * Color-domain + type-DNA guard — V2_INTERFACE_SPEC enforcement.
 *
 * The spec assigns every color a DOMAIN (interaction / status /
 * computation-kind / data-viz) and every label one type DNA (tracking +
 * weight tokens). These invariants are exactly the kind that erode one
 * innocent-looking diff at a time, so they are gated:
 *
 *   1. primitives-neutral — design-system primitives carry ZERO
 *      computation-kind (--rater-cat-*) color. The one exception is
 *      Chip/, which DEFINES the computation tone classes consumed by
 *      canvas surfaces.
 *   2. tracking-tokens — label tracking comes from --rater-tracking-*
 *      tokens. Raw `letter-spacing: 0.0Xem` >= 0.03em is an eyebrow
 *      that escaped the DNA. (Micro glyph metrics < 0.03em are fine.)
 *   3. weight-tokens — font-weight comes from --rater-fw-* tokens.
 *      Raw numerics (the 520/620/650 off-ramp, but also raw 600) are
 *      how the type ramp drifted the first time.
 *   4. data-viz-domain — Analytics is a data-viz surface: deltas ride
 *      --rater-viz-delta-*, series ride the categorical/choropleth
 *      ramps. Computation-kind cat-* has no meaning in an exhibit.
 *      (cat-categorical-* / cat-choropleth-* are viz ramps that carry
 *      the cat- prefix for historical reasons; they rename to viz-*
 *      in the P9 cutover.)
 *   5. retired-labels — "Parametrize" / "Assemble" / "Verify" are
 *      retired USER-VISIBLE names (now Factor Tables / Algorithm /
 *      Test; the in-canvas trace toggle is "Trace"). Internal ids,
 *      file names, and comments are fine — JSX text and quoted label
 *      values are not.
 *
 * Run via `pnpm design:check`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  "packages/design-system/src",
  "packages/ui/src",
  "frontend/src",
];

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(p, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

const failures = [];
function fail(rule, file, line, detail) {
  failures.push(`  [${rule}] ${relative(ROOT, file)}:${line}  ${detail}`);
}

const cssFiles = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d), [".css"]));
const tsxFiles = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d), [".tsx"]));

for (const file of cssFiles) {
  const rel = relative(ROOT, file);
  if (rel.endsWith("tokens.css")) continue;
  const lines = readFileSync(file, "utf8").split("\n");

  const isPrimitive =
    rel.includes("design-system/src/primitives/") &&
    !rel.includes("/Chip/");
  const isAnalytics = rel.includes("ui/src/AnalyticsWorkspace/");

  lines.forEach((text, i) => {
    // 1. primitives-neutral
    if (isPrimitive && text.includes("--rater-cat-")) {
      fail("primitives-neutral", file, i + 1, text.trim());
    }

    // 2. tracking-tokens — raw em >= 0.03
    const ls = text.match(/letter-spacing:\s*(-?0?\.\d+)em/);
    if (ls && Math.abs(parseFloat(ls[1])) >= 0.03) {
      fail("tracking-tokens", file, i + 1, text.trim());
    }

    // 3. weight-tokens — any raw numeric weight
    if (/font-weight:\s*\d/.test(text)) {
      fail("weight-tokens", file, i + 1, text.trim());
    }

    // 4. data-viz-domain
    if (isAnalytics) {
      const cats = text.match(/--rater-cat-[a-z0-9-]+/g) ?? [];
      for (const c of cats) {
        if (
          !c.startsWith("--rater-cat-categorical-") &&
          !c.startsWith("--rater-cat-choropleth-")
        ) {
          fail("data-viz-domain", file, i + 1, text.trim());
        }
      }
    }
  });
}

// 5. retired-labels — user-visible strings only (JSX text / quoted labels)
const RETIRED = [
  />\s*Parametrize\s*</,
  />\s*Assemble\s*</,
  />\s*Verify\s*</,
  /"Parametrize"/,
  /'Parametrize'/,
  /"Assemble the /,
  /label:\s*"Verify"/,
  /label:\s*"Assemble/,
  /label:\s*"Parametrize/,
];
for (const file of tsxFiles) {
  if (file.endsWith(".test.tsx")) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((text, i) => {
    const code = text.replace(/^\s*(\/\/|\*|\/\*).*$/, ""); // strip comment lines
    for (const re of RETIRED) {
      if (re.test(code)) fail("retired-labels", file, i + 1, text.trim());
    }
  });
}

if (failures.length > 0) {
  console.error(`check-color-domains: ${failures.length} violation(s)\n`);
  console.error(failures.join("\n"));
  console.error(
    "\nFix: use the domain token (--rater-accent-*/--rater-feedback-*/--rater-viz-*)," +
      "\na --rater-tracking-*/--rater-fw-* type token, or the renamed label." +
      "\nSee docs/V2_INTERFACE_SPEC.md (design constitution).",
  );
  process.exit(1);
}
console.log(
  `check-color-domains: clean (${cssFiles.length} css, ${tsxFiles.length} tsx scanned)`,
);
