/**
 * CSV roundtrip library barrel — ADR-0017.
 *
 * Shared by Briefs 6 (CSV batch import), 18 (Factor Table editor),
 * 19 (Curve editor), 20 (Territory map), 21 (Class translator),
 * and 22 (Eligibility condition builder).
 *
 * Pure functions; no React, no I/O. Consumers wrap these with
 * their per-brief row schemas to produce typed `ImportDiff<TRow>`
 * conflict previews.
 *
 * See:
 *   - docs/adr/0017-csv-import-export-semantics.md
 */

export type {
  ImportDiffState,
  ImportMode,
  ImportDiff,
  ImportDiffChange,
  ImportDiffFieldChange,
  ImportDiffIgnored,
  ParseResult,
  ParseError,
  ParseWarning,
  ColumnSpec,
  CsvSchema,
} from "./types";

export { encodeCsv, quoteIfNeeded, formatNumber } from "./encode";
export { decodeCsv } from "./decode";

export {
  computeDiff,
  emptyDiff,
  summarizeDiff,
} from "./conflict";
export type { ComputeDiffOptions, DiffSummary } from "./conflict";

// Book-intake brief §2 — the shared identifier-matching core + the
// header pre-flight both doors run before any row rates.
export {
  normalizeIdent,
  tokenize,
  levenshtein,
  nameSimilarity,
} from "./name-similarity";
export {
  preflightBook,
  preflightHeader,
  composePreflightSentence,
  sniffDelimiter,
  headerLineOf,
} from "./preflight";
export type {
  BookPreflight,
  PreflightInput,
  PreflightMatch,
  PreflightSuggestion,
} from "./preflight";

export {
  parseRequiredString,
  parseOptionalString,
  parseRequiredNumber,
  parseOptionalNumber,
  parsePositiveNumber,
  parseNonNegativeNumber,
  parseInteger,
  parseEnum,
} from "./validate";
