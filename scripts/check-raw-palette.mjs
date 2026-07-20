#!/usr/bin/env node
/**
 * Raw-palette discipline guard.
 *
 * `tokens.css` says:
 *
 *   > Components NEVER reference these directly. Components reference
 *   > the SEMANTIC tokens (--rater-text-*, --rater-surface-*,
 *   > --rater-cat-*, --rater-feedback-*, --rater-accent-*).
 *
 * The 7 raw-palette hues (--rater-color-azure-*, --rater-color-red-*,
 * --rater-color-emerald-*, etc.) exist ONLY to redefine the semantic
 * layer in tokens.css. Components that reach past the alias layer
 * break the palette-redefinability contract: a future hue change
 * won't propagate cleanly because some components are locked to the
 * specific shade.
 *
 * This guard scans every component file for `var(--rater-color-…)`
 * references and fails on any file not present in
 * `scripts/raw-palette-allowlist.txt`. As each file is migrated to
 * semantic tokens, it is removed from the allowlist.
 *
 * Exit codes:
 *   0 — every raw-palette reference is either in tokens.css or in
 *       an allowlisted file
 *   1 — at least one unallowed reference; the offending file:line +
 *       token name are printed
 *
 * Run via `pnpm raw-palette:check`. Wire into CI alongside
 * `tokens:check`.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ALLOWLIST_FILE = join(ROOT, "scripts/raw-palette-allowlist.txt");
const TOKENS_FILE = "packages/design-system/src/tokens.css";

/**
 * Parse the allowlist into a Set of project-root-relative paths.
 * Lines starting with `#` are comments; blanks are skipped; trailing
 * whitespace stripped.
 */
function readAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return new Set();
  const text = readFileSync(ALLOWLIST_FILE, "utf-8");
  const out = new Set();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    out.add(line);
  }
  return out;
}

/**
 * Heuristic: a line is a "comment" if, after stripping leading
 * whitespace, it starts with one of `//`, `/*`, `*`, or `*​/`.
 * Catches single-line `// var(--rater-color-…)`, block-comment bodies
 * `* ... var(--rater-color-…) ...`, and JSDoc examples. False
 * positives are rare — a line starting with `*` outside a comment
 * is almost always a multiline-comment continuation in CSS or JS.
 *
 * Doesn't catch inline trailing comments (e.g.,
 * `color: red; // var(--rater-color-…)`). The few of those won't
 * matter — guard treats them as real refs, which is the safer side
 * to err on.
 */
function isCommentLine(body) {
  const trimmed = body.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  );
}

/**
 * Find every `var(--rater-color-…)` reference + its file:line. Strip
 * matches in tokens.css (the only place raw refs are allowed), in
 * allowlisted files, and in comment lines (the
 * ref is documentation, not runtime).
 */
function findUnallowedRefs(allowlist) {
  const detailed = execSync(
    `grep -rEn --include="*.css" --include="*.tsx" --include="*.ts" \
      "var\\(--rater-color-[a-z0-9-]+" \
      packages frontend/src 2>/dev/null || true`,
    { cwd: ROOT, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
  );

  const refs = [];
  for (const line of detailed.split("\n")) {
    if (!line) continue;
    const match = line.match(/^([^:]+):(\d+):/);
    if (!match) continue;
    const file = match[1];
    // tokens.css IS the source of truth for raw-palette aliasing.
    if (file === TOKENS_FILE) continue;
    if (allowlist.has(file)) continue;

    // Strip the `path:line:` prefix and skip refs inside comments —
    // a JSDoc example like `/** ... var(--rater-color-azure-500) ... */`
    // documents the API, doesn't constitute a runtime reference.
    const body = line.slice(match[0].length);
    if (isCommentLine(body)) continue;

    const tokenRegex = /var\((--rater-color-[a-z0-9-]+)\)/gi;
    let tokenMatch;
    while ((tokenMatch = tokenRegex.exec(body)) !== null) {
      refs.push({
        file,
        line: Number(match[2]),
        token: tokenMatch[1],
      });
    }
  }
  return refs;
}

/**
 * Also report which allowlisted files NO LONGER contain raw refs —
 * those entries can be retired from the allowlist (and the guard
 * tightens automatically next run).
 */
function findCleanedAllowlistEntries(allowlist) {
  if (allowlist.size === 0) return [];
  const cleaned = [];
  for (const path of allowlist) {
    const full = join(ROOT, path);
    if (!existsSync(full)) {
      // File deleted entirely — also retirable.
      cleaned.push({ path, reason: "file-deleted" });
      continue;
    }
    const text = readFileSync(full, "utf-8");
    // Walk line-by-line so we can skip comment lines (matches the
    // behaviour of `findUnallowedRefs`). A file whose only `var(--rater-
    // color-…)` references live in JSDoc examples is effectively clean.
    let hasRuntimeRef = false;
    for (const rawLine of text.split("\n")) {
      if (!/var\(--rater-color-/.test(rawLine)) continue;
      if (isCommentLine(rawLine)) continue;
      hasRuntimeRef = true;
      break;
    }
    if (!hasRuntimeRef) {
      cleaned.push({ path, reason: "no-raw-refs-left" });
    }
  }
  return cleaned;
}

function main() {
  const allowlist = readAllowlist();
  const unallowed = findUnallowedRefs(allowlist);
  const cleaned = findCleanedAllowlistEntries(allowlist);

  if (unallowed.length === 0) {
    console.log(
      `\x1b[32m✓ raw-palette-check: every var(--rater-color-…) reference is in tokens.css or allowlisted.\x1b[0m`,
    );
    console.log(
      `  Allowlisted files: \x1b[33m${allowlist.size}\x1b[0m`,
    );
    if (cleaned.length > 0) {
      console.log("");
      console.log(
        `  \x1b[33m${cleaned.length} allowlist entr${cleaned.length === 1 ? "y" : "ies"} can be retired:\x1b[0m`,
      );
      for (const entry of cleaned.slice(0, 10)) {
        console.log(`    · ${entry.path}  (${entry.reason})`);
      }
      if (cleaned.length > 10) {
        console.log(`    · … ${cleaned.length - 10} more`);
      }
      console.log("");
      console.log(
        `  Remove these lines from scripts/raw-palette-allowlist.txt`,
      );
      console.log(`  to tighten the guard.`);
    }
    process.exit(0);
  }

  // Group by file for readable output
  const byFile = new Map();
  for (const r of unallowed) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(`${r.line}  ${r.token}`);
  }

  console.error(
    `\x1b[31m✗ raw-palette-check: ${unallowed.length} unallowed reference${unallowed.length === 1 ? "" : "s"} across ${byFile.size} file${byFile.size === 1 ? "" : "s"}.\x1b[0m`,
  );
  console.error("");
  for (const [file, sites] of byFile.entries()) {
    console.error(`  \x1b[33m${file}\x1b[0m (${sites.length}):`);
    for (const site of sites.slice(0, 5)) {
      console.error(`    · ${site}`);
    }
    if (sites.length > 5) {
      console.error(`    · … ${sites.length - 5} more`);
    }
  }
  console.error("");
  console.error(
    "  Components must consume the semantic alias layer, not the raw",
  );
  console.error(
    "  palette. See packages/design-system/src/tokens.css §9 for the",
  );
  console.error("  canonical aliases: --rater-text-*, --rater-surface-*,");
  console.error("  --rater-cat-*, --rater-feedback-*, --rater-accent-*.");
  console.error("");
  console.error(
    "  If the reference is an approved exception, add it to scripts/raw-palette-allowlist.txt.",
  );

  process.exit(1);
}

main();
