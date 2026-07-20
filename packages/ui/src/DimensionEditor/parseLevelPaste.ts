/**
 * Pure parser for the "Paste levels" affordance on the categorical
 * <DimensionEditor> body. Brief 30 PR 30.9.
 *
 * Grammar (one row per line):
 *   `KEY`              → id = KEY, label = KEY
 *   `KEY, LABEL`       → id = KEY, label = LABEL  (label may contain
 *                        commas — only the FIRST comma splits)
 *
 * If the first non-blank line matches a recognised header pattern
 * (case-insensitive `{key|id|code|slug|abbr},{label|name|...}`), the
 * row is treated as a column header and skipped. Subsequent rows are
 * parsed under the same `key[, label]` grammar.
 *
 * Blank lines, lines with an empty key, and lines whose key collides
 * with `existingIds` or with an earlier row in the same paste are
 * silently skipped — callers can surface the skip reasons via the
 * `skipped[]` array if they want.
 *
 * The id is preserved verbatim from the user's input (no slugify) so
 * conventions like uppercase USPS codes (`WI`, `CA`) survive a paste.
 * Callers are expected to validate the resulting ids against the
 * dimension's existing constraints.
 */

const HEADER_LHS = new Set([
  "key",
  "id",
  "code",
  "slug",
  "abbr",
  "abbreviation",
]);
const HEADER_RHS = new Set([
  "label",
  "name",
  "description",
  "title",
  "display",
]);

export interface ParsedLevel {
  readonly id: string;
  readonly label: string;
}

export type SkipReason = "blank" | "duplicate" | "empty-key" | "header";

export interface SkippedLine {
  readonly line: string;
  readonly reason: SkipReason;
}

export interface ParseLevelPasteResult {
  readonly added: readonly ParsedLevel[];
  readonly skipped: readonly SkippedLine[];
  /** True when the first non-blank line was consumed as a CSV header. */
  readonly hadHeader: boolean;
}

export interface ParseLevelPasteOptions {
  /**
   * Existing level ids in the dim. Any pasted row whose key collides
   * with one of these is skipped (reason: "duplicate").
   */
  readonly existingIds?: readonly string[];
}

/**
 * Split a single row into `[id, label]`. Splits on the FIRST comma
 * only, so a label like `"Madison, WI"` survives intact.
 */
function splitRow(line: string): { id: string; label: string } {
  const commaIdx = line.indexOf(",");
  if (commaIdx < 0) {
    const id = line.trim();
    return { id, label: id };
  }
  const id = line.slice(0, commaIdx).trim();
  const label = line.slice(commaIdx + 1).trim();
  return { id, label: label === "" ? id : label };
}

function looksLikeHeader(line: string): boolean {
  const commaIdx = line.indexOf(",");
  if (commaIdx < 0) return false;
  const lhs = line.slice(0, commaIdx).trim().toLowerCase();
  const rhs = line.slice(commaIdx + 1).trim().toLowerCase();
  return HEADER_LHS.has(lhs) && HEADER_RHS.has(rhs);
}

export function parseLevelPaste(
  input: string,
  options: ParseLevelPasteOptions = {},
): ParseLevelPasteResult {
  const existing = new Set(options.existingIds ?? []);
  const added: ParsedLevel[] = [];
  const skipped: SkippedLine[] = [];
  const seenIds = new Set<string>(existing);
  let hadHeader = false;
  let headerChecked = false;

  const lines = input.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      skipped.push({ line: raw, reason: "blank" });
      continue;
    }
    if (!headerChecked) {
      headerChecked = true;
      if (looksLikeHeader(line)) {
        hadHeader = true;
        skipped.push({ line: raw, reason: "header" });
        continue;
      }
    }
    const { id, label } = splitRow(line);
    if (id === "") {
      skipped.push({ line: raw, reason: "empty-key" });
      continue;
    }
    if (seenIds.has(id)) {
      skipped.push({ line: raw, reason: "duplicate" });
      continue;
    }
    seenIds.add(id);
    added.push({ id, label });
  }

  return { added, skipped, hadHeader };
}
