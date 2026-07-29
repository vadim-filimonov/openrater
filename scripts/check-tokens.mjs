#!/usr/bin/env node
/**
 * Token-discipline guard.
 *
 * Greps the codebase for every `var(--rater-…)` reference in CSS +
 * inline-style, intersects it with the set of tokens DEFINED in
 * `packages/design-system/src/tokens.css`, and prints any
 * references that aren't backed by a definition.
 *
 * The UI Audit (docs/design/UI_AUDIT.md) caught 8 distinct
 * undefined tokens referenced across the codebase
 * (`--rater-r-10`, `--rater-cat-error*`, `--rater-t-9`, `--rater-t-15`,
 * `--rater-r-md`, `--rater-r-sm`, `--rater-r-pill`). PR 1 swept all
 * of them; this script ensures they don't come back.
 *
 * Exit codes:
 *   0 — every var(--rater-…) reference points at a defined token
 *   1 — one or more undefined references; the failing names +
 *       call-sites are printed.
 *
 * Run via `pnpm tokens:check` from the repo root. Wire into CI
 * before lint/typecheck.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TOKENS_FILE = join(ROOT, "packages/design-system/src/tokens.css");

/**
 * Pull every defined token name (`--rater-…`) from tokens.css.
 *
 * A definition looks like `--rater-r-6: 6px;` — left-of-colon at
 * line start with optional whitespace.
 */
function readDefinedTokens() {
  const text = readFileSync(TOKENS_FILE, "utf-8");
  const defined = new Set();
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(--rater-[a-z0-9-]+)\s*:/i);
    if (match) defined.add(match[1]);
  }
  return defined;
}

/**
 * Find every `var(--rater-…)` reference in CSS + TSX, capture the
 * token name and the file:line.
 */
function findReferences() {
  const out = execSync(
    `grep -rEnh --include="*.css" --include="*.tsx" --include="*.ts" \
      "var\\(--rater-[a-z0-9-]+" \
      packages frontend/src 2>/dev/null || true`,
    { cwd: ROOT, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
  );
  // Also need the filenames — re-run with -l for the file list,
  // then walk each. Simpler: run grep with `-rEon` (offsets) +
  // include the path.
  const detailed = execSync(
    `grep -rEn --include="*.css" --include="*.tsx" --include="*.ts" \
      "var\\(--rater-[a-z0-9-]+" \
      packages frontend/src 2>/dev/null || true`,
    { cwd: ROOT, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
  );
  void out;

  const refs = [];
  for (const line of detailed.split("\n")) {
    if (!line) continue;
    // grep -rn format: `path:line:matched-content`
    // The matched content may itself contain colons; capture the
    // path + line robustly by matching from the start.
    const match = line.match(/^([^:]+):(\d+):/);
    if (!match) continue;
    // Multiple var(--rater-…) refs may appear on the same line.
    const tokenRegex = /var\((--rater-[a-z0-9-]+)\)/gi;
    let tokenMatch;
    while ((tokenMatch = tokenRegex.exec(line)) !== null) {
      refs.push({
        file: match[1],
        line: Number(match[2]),
        token: tokenMatch[1],
      });
    }
  }
  return refs;
}

function main() {
  const defined = readDefinedTokens();
  const refs = findReferences();

  const undefinedRefs = refs.filter((r) => !defined.has(r.token));
  if (undefinedRefs.length === 0) {
    const tokenCount = new Set(refs.map((r) => r.token)).size;
    console.log(
      `\x1b[32m✓ tokens-check: ${refs.length} references across ${tokenCount} tokens — all defined.\x1b[0m`,
    );
    process.exit(0);
  }

  // Group by token name for readable output
  const byToken = new Map();
  for (const r of undefinedRefs) {
    if (!byToken.has(r.token)) byToken.set(r.token, []);
    byToken.get(r.token).push(`${r.file}:${r.line}`);
  }

  console.error(
    `\x1b[31m✗ tokens-check: ${undefinedRefs.length} undefined-token reference${undefinedRefs.length === 1 ? "" : "s"} across ${byToken.size} token name${byToken.size === 1 ? "" : "s"}.\x1b[0m`,
  );
  console.error("");
  for (const [token, sites] of byToken.entries()) {
    console.error(`  \x1b[33m${token}\x1b[0m (${sites.length}):`);
    for (const site of sites.slice(0, 5)) {
      console.error(`    · ${site}`);
    }
    if (sites.length > 5) {
      console.error(`    · … ${sites.length - 5} more`);
    }
  }
  console.error("");
  console.error(
    "  Either define the token in packages/design-system/src/tokens.css,",
  );
  console.error(
    "  or sweep the references to a canonical equivalent. The UI audit",
  );
  console.error(
    "  doc (docs/design/UI_AUDIT.md) documents the canonical scale.",
  );

  process.exit(1);
}

main();
