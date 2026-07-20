/**
 * CSV roundtrip library barrel.
 *
 * Shared by CSV batch import, Factor Table editing, territory mapping,
 * classification, and eligibility-rule authoring.
 *
 * Pure functions; no React, no I/O. Consumers wrap these with
 * their row schemas to produce typed `ImportDiff<TRow>`
 * conflict previews.
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

// Shared identifier matching and the
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
