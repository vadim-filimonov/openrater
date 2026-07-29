/**
 * preflight — the book header meets the input dictionary BEFORE any
 * row rates (book-intake brief §2 / MVP-004 · MVP-010).
 *
 * One pure derivation, shared by BOTH doors: the app runs it on
 * upload (exact/normalized matches apply automatically; fuzzy hits
 * become amber suggestions), and the chat door (`rerate_book`) runs
 * it before rating so a header problem refuses with the CULPRIT —
 * "Missing: class_code", "building_lmit looks like building_limit" —
 * never the garbled per-row lookup error.
 *
 * Matching uses the SAME core as the app's Auto-recognize
 * (`nameSimilarity`, Brief 38 §7 / Brief 57) so the two doors can't
 * disagree about what a column name means. Thresholds mirror the
 * Brief 38 §7 locks: fuzzy suggestions surface at ≥ 0.4.
 */

import { nameSimilarity, normalizeIdent } from "./name-similarity";

/** One declared input, as the dictionary states it. */
export interface PreflightInput {
  /** The runtime field key (the CSV column maps TO this). */
  readonly name: string;
  /** Human name, when one exists (matched as a synonym). */
  readonly display_name?: string | null | undefined;
  /** Required from the caller (derived inputs are not). */
  readonly required: boolean;
}

export interface PreflightMatch {
  readonly column: string;
  readonly input: string;
}

export interface PreflightSuggestion {
  readonly column: string;
  readonly input: string;
  /** Human reason, e.g. "resembles building_limit". */
  readonly reason: string;
}

export interface BookPreflight {
  /** Exact/normalized hits — safe to apply automatically. */
  readonly matched: readonly PreflightMatch[];
  /** Fuzzy hits — pre-selectable, but a person confirms. */
  readonly suggested: readonly PreflightSuggestion[];
  /** Columns that are not plan inputs (ignored unless mapped). */
  readonly unknown: readonly string[];
  /** FCA #13 — columns the rating STRUCTURE reads directly (schedule
   *  applications, predicate/branch fields) without a dictionary
   *  declaration. These were labeled 'ignored' while every row's
   *  values were consumed and applied — a false note that shipped a
   *  wrong headline number. Named truthfully now. */
  readonly consumed: readonly string[];
  /** FCA #13 — header names appearing more than once (the classic
   *  Excel-export artifact). The parser would silently keep only the
   *  LAST copy's values (+20% written in the audit), so duplicates
   *  BLOCK: `ok` is false while any exist. */
  readonly duplicates: readonly string[];
  /** Required inputs no column matched (suggestions don't count). */
  readonly missing: readonly string[];
  /** The sniffed delimiter of the header line. */
  readonly delimiter: "," | ";" | "\t" | "|";
  /** Non-null when the delimiter isn't the comma the parser reads. */
  readonly note: string | null;
  /** True when rating can proceed: every required input matched, no
   *  duplicate headers, and the file parses as CSV. Unknown columns
   *  alone don't block. */
  readonly ok: boolean;
  /** THE user sentence (duplicates + leftovers + missing + suggestions
   *  + note); null when there is nothing to say. Both doors print
   *  this one. */
  readonly sentence: string | null;
}

/**
 * The pre-flight's suggestion bar. Deliberately ABOVE the app's 0.4
 * yellow-hint lock (Brief 38 §7): a hint in a table a person is
 * already reading can afford loose recall, but the pre-flight
 * SENTENCE asserts "X looks like Y" with no value-match context to
 * disambiguate. Measured on the sweep's battery: real misspellings
 * score ≥ 0.9 (building_lmit 0.93, sprinkler 0.905) while cross-name
 * confusions land 0.5–0.72 (case_id→class_code 0.5, BldgLimit→
 * bpp_limit 0.719 — beating the RIGHT match at 0.692). 0.75 keeps
 * every true positive observed and asserts no false one; below it a
 * column is honestly "not a plan input".
 */
const SUGGEST_THRESHOLD = 0.75;

/**
 * Sniff the header line's delimiter: the candidate that splits the
 * line into the most fields wins; comma wins ties.
 */
export function sniffDelimiter(headerLine: string): {
  delimiter: BookPreflight["delimiter"];
  note: string | null;
} {
  const candidates: BookPreflight["delimiter"][] = [",", ";", "\t", "|"];
  let best: BookPreflight["delimiter"] = ",";
  let bestCount = headerLine.split(",").length;
  for (const d of candidates.slice(1)) {
    const count = headerLine.split(d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  if (best === ",") return { delimiter: ",", note: null };
  const name = best === ";" ? "semicolons" : best === "\t" ? "tabs" : "pipes";
  return {
    delimiter: best,
    note: `This file separates columns with ${name}, not commas — export it comma-separated (or re-save as standard CSV) and try again.`,
  };
}

/** The first physical line (header), CRLF/BOM tolerant. */
export function headerLineOf(csvText: string): string {
  const stripped = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  const nl = stripped.indexOf("\n");
  const line = nl === -1 ? stripped : stripped.slice(0, nl);
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function listOf(items: readonly string[]): string {
  return items.join(", ");
}

/** Compose THE user sentence both doors print. Exported so the app
 *  can recompose it after subtracting hand-mapped columns/inputs. */
export function composePreflightSentence(args: {
  readonly unknown: readonly string[];
  readonly missing: readonly string[];
  readonly suggested: readonly PreflightSuggestion[];
  readonly note: string | null;
  readonly consumed?: readonly string[];
  readonly duplicates?: readonly string[];
}): string | null {
  const parts: string[] = [];
  if (args.note) parts.push(args.note);
  const duplicates = args.duplicates ?? [];
  if (duplicates.length > 0) {
    const n = duplicates.length;
    parts.push(
      `Duplicate column${n === 1 ? "" : "s"} (${listOf(duplicates)}) — ` +
        `each row would silently keep only the last copy's values. ` +
        `Remove the duplicate${n === 1 ? "" : "s"} and retry.`,
    );
  }
  if (args.unknown.length > 0) {
    const n = args.unknown.length;
    // FCA #13 (grammar) — '1 of your column isn't' read broken on
    // virtually every book run; the count agrees with the verb, the
    // noun stays plural ('1 of your columns').
    parts.push(
      `${n} of your columns ${n === 1 ? "isn't a plan input" : "aren't plan inputs"} (${listOf(
        args.unknown,
      )}) — ignored unless mapped.`,
    );
  }
  const consumed = args.consumed ?? [];
  if (consumed.length > 0) {
    const n = consumed.length;
    // FCA #13 — never call a load-bearing column 'ignored': these are
    // read by the rating structure and applied to every row.
    parts.push(
      `${n} column${n === 1 ? "" : "s"} (${listOf(consumed)}) ` +
        `${n === 1 ? "is" : "are"} read directly by the rating ` +
        `structure — values apply to every row as-is.`,
    );
  }
  for (const s of args.suggested) {
    parts.push(`${s.column} ${s.reason} — confirm the match in Inputs.`);
  }
  if (args.missing.length > 0) {
    parts.push(`Missing: ${listOf(args.missing)}.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Pre-flight a parsed header against the input dictionary.
 * Greedy one-input-per-column; exact/normalized equality (against the
 * slug OR the display name) beats fuzzy; fuzzy claims the best still-
 * unclaimed input at ≥ 0.4.
 */
export function preflightHeader(
  columns: readonly string[],
  inputs: readonly PreflightInput[],
  delimiterInfo?: { delimiter: BookPreflight["delimiter"]; note: string | null },
  consumedFields: readonly string[] = [],
): BookPreflight {
  const { delimiter, note } = delimiterInfo ?? { delimiter: ",", note: null };
  const byNormalized = new Map<string, PreflightInput>();
  for (const input of inputs) {
    byNormalized.set(normalizeIdent(input.name), input);
    const display = input.display_name?.trim();
    if (display) {
      const key = normalizeIdent(display);
      if (!byNormalized.has(key)) byNormalized.set(key, input);
    }
  }
  // FCA #13 — the structure-consumed vocabulary: field keys the
  // runtime plan reads that carry no dictionary declaration
  // (schedule applications, predicate/branch fields). A column that
  // normalizes onto one of these is NOT 'ignored' — it is applied to
  // every row.
  const consumedNormalized = new Set(
    consumedFields.map((f) => normalizeIdent(f)),
  );

  const matched: PreflightMatch[] = [];
  const suggested: PreflightSuggestion[] = [];
  const unknown: string[] = [];
  const consumed: string[] = [];
  const claimed = new Set<string>();
  const fuzzyColumns: string[] = [];

  // FCA #13 — duplicate headers (the classic Excel artifact): the
  // row parser keeps only the LAST copy's values, so every row rates
  // with silently-wrong data. Detect on the normalized name and BLOCK.
  const seenColumns = new Map<string, number>();
  for (const column of columns) {
    const trimmed = column.trim();
    if (trimmed === "") continue;
    const key = normalizeIdent(trimmed);
    seenColumns.set(key, (seenColumns.get(key) ?? 0) + 1);
  }
  const duplicateKeys = new Set(
    [...seenColumns.entries()].filter(([, n]) => n > 1).map(([k]) => k),
  );
  const duplicates: string[] = [];
  const listedDupKeys = new Set<string>();

  // Pass 1 — exact/normalized (these apply automatically).
  for (const column of columns) {
    const trimmed = column.trim();
    if (trimmed === "") continue;
    const key = normalizeIdent(trimmed);
    if (duplicateKeys.has(key)) {
      // One entry per (normalized) name, first spelling shown.
      if (!listedDupKeys.has(key)) {
        listedDupKeys.add(key);
        duplicates.push(trimmed);
      }
      continue;
    }
    const hit = byNormalized.get(key);
    if (hit && !claimed.has(hit.name)) {
      matched.push({ column: trimmed, input: hit.name });
      claimed.add(hit.name);
    } else {
      fuzzyColumns.push(trimmed);
    }
  }

  // Pass 2 — the structure-consumed vocabulary, then fuzzy
  // suggestions over the unclaimed remainder.
  for (const column of fuzzyColumns) {
    if (consumedNormalized.has(normalizeIdent(column))) {
      consumed.push(column);
      continue;
    }
    let best: { input: PreflightInput; score: number } | null = null;
    for (const input of inputs) {
      if (claimed.has(input.name)) continue;
      const score = Math.max(
        nameSimilarity(column, input.name),
        input.display_name ? nameSimilarity(column, input.display_name) : 0,
      );
      if (score >= SUGGEST_THRESHOLD && (best === null || score > best.score)) {
        best = { input, score };
      }
    }
    if (best) {
      suggested.push({
        column,
        input: best.input.name,
        reason: `looks like ${best.input.name}`,
      });
      claimed.add(best.input.name);
    } else {
      unknown.push(column);
    }
  }

  // A required input is unmatched until a real match claims it. Ones
  // with a pending SUGGESTION aren't listed as "Missing" (the
  // suggestion clause already names them) — but they still block: a
  // suggestion is a question for a person, not a mapping.
  const unmatchedRequired = inputs
    .filter((i) => i.required)
    .map((i) => i.name)
    .filter((name) => !matched.some((m) => m.input === name));
  const missing = unmatchedRequired.filter(
    (name) => !suggested.some((s) => s.input === name),
  );

  const sentence = composePreflightSentence({
    unknown,
    missing,
    suggested,
    note,
    consumed,
    duplicates,
  });
  return {
    matched,
    suggested,
    unknown,
    consumed,
    duplicates,
    missing,
    delimiter,
    note,
    ok:
      unmatchedRequired.length === 0 &&
      note === null &&
      duplicates.length === 0,
    sentence,
  };
}

/** Convenience: sniff the raw text's header and pre-flight it. */
export function preflightBook(
  csvText: string,
  inputs: readonly PreflightInput[],
  consumedFields: readonly string[] = [],
): BookPreflight {
  const headerLine = headerLineOf(csvText);
  const sniffed = sniffDelimiter(headerLine);
  const columns = headerLine
    .split(sniffed.delimiter)
    .map((c) => c.trim().replace(/^"|"$/g, ""));
  return preflightHeader(columns, inputs, sniffed, consumedFields);
}
