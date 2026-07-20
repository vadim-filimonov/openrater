/**
 * Pure parser for the "Paste bands" affordance on the banded
 * <DimensionEditor> body. Cold-test L12.
 *
 * The categorical body already has "Paste levels" (see
 * `parseLevelPaste.ts`); banded dims had only Equal-width / Log-scale
 * Generate, which can't express an IRREGULAR edge set (e.g. revenue
 * 25k / 50k / 100k / 250k / 500k / 1M / 5M). This parser is the banded
 * mirror of that bulk-entry path — it accepts one band per line and
 * produces lo/hi/label tuples that slot straight into the existing
 * banded `LevelRow` shape (`{ kind: "banded", id, label, lo, hi }`).
 *
 * Grammar (one band per line):
 *   `LO, HI`             → band [LO, HI), label auto-derived
 *   `LO, HI, LABEL`      → band [LO, HI) with an explicit label
 *                          (LABEL may contain commas — only the first
 *                          TWO commas split off lo + hi)
 *
 * Open-ended edges:
 *   empty LO  → -Infinity   (e.g. `, 25000` = "< 25,000")
 *   empty HI  → +Infinity   (e.g. `1000000,` = "≥ 1,000,000")
 *
 * Numbers tolerate the conventions an actuary pastes from a sheet:
 * thousands separators (`1,000` only when it's unambiguous — see the
 * note below), a `$` prefix, `k`/`m` magnitude suffixes (`25k`,
 * `1.5m`), and surrounding whitespace.
 *
 * IMPORTANT — comma vs. thousands separator. Because the column
 * delimiter is a comma, a value like `25,000` is ambiguous (one field
 * `25000`, or two fields `25` and `000`?). We resolve this the only
 * way that keeps the grammar simple: commas are ALWAYS field
 * delimiters. To paste 25,000 the user writes `25000` or `25k`. The
 * inline hint states this explicitly so there's no surprise.
 *
 * If the first non-blank line matches a recognised header pattern
 * (case-insensitive `{lo|low|from|min},{hi|high|to|max}[,{label|...}]`),
 * it's skipped as a column header.
 *
 * A line is skipped (with a reason) when it's blank, can't be parsed
 * into two finite-or-open numbers, or has lo >= hi (an inverted /
 * empty band). Callers can surface skip reasons via `skipped[]`.
 */

import { defaultBandId, defaultBandLabel } from "./banded-utils";

const HEADER_LO = new Set(["lo", "low", "from", "min", "start", "lower"]);
const HEADER_HI = new Set(["hi", "high", "to", "max", "end", "upper"]);

export interface ParsedBand {
  readonly id: string;
  readonly label: string;
  readonly lo: number;
  readonly hi: number;
}

export type BandSkipReason =
  | "blank"
  | "header"
  | "unparseable"
  | "inverted"
  | "duplicate";

export interface SkippedBandLine {
  readonly line: string;
  readonly reason: BandSkipReason;
}

export interface ParseBandPasteResult {
  readonly added: readonly ParsedBand[];
  readonly skipped: readonly SkippedBandLine[];
  /** True when the first non-blank line was consumed as a CSV header. */
  readonly hadHeader: boolean;
}

export interface ParseBandPasteOptions {
  /**
   * Existing band ids in the dim. A pasted band whose derived id
   * collides with one of these (or with an earlier pasted band) is
   * skipped (reason: "duplicate").
   */
  readonly existingIds?: readonly string[];
}

/**
 * Parse one numeric field. Returns `null` when the trimmed token is
 * neither empty (open edge — handled by the caller) nor a number.
 * Tolerates a leading `$`, and trailing `k`/`m` magnitude suffixes.
 */
function parseEdge(token: string): number | null | "open" {
  const t = token.trim();
  if (t === "") return "open";
  // Strip a leading currency marker + surrounding whitespace.
  let body = t.replace(/^\$/, "").trim();
  // Magnitude suffix (case-insensitive): 25k → 25000, 1.5m → 1500000.
  let mult = 1;
  const suffix = body.slice(-1).toLowerCase();
  if (suffix === "k") {
    mult = 1_000;
    body = body.slice(0, -1).trim();
  } else if (suffix === "m") {
    mult = 1_000_000;
    body = body.slice(0, -1).trim();
  }
  if (body === "") return null;
  const n = Number(body);
  if (!Number.isFinite(n)) return null;
  return n * mult;
}

/**
 * Split a row into `[loToken, hiToken, labelToken?]`. Splits on the
 * FIRST TWO commas only, so a label like `"Mid, large"` survives.
 */
function splitRow(
  line: string,
): { lo: string; hi: string; label: string | null } | null {
  const firstComma = line.indexOf(",");
  if (firstComma < 0) return null; // need at least lo,hi
  const lo = line.slice(0, firstComma);
  const rest = line.slice(firstComma + 1);
  const secondComma = rest.indexOf(",");
  if (secondComma < 0) {
    return { lo, hi: rest, label: null };
  }
  const hi = rest.slice(0, secondComma);
  const label = rest.slice(secondComma + 1).trim();
  return { lo, hi, label: label === "" ? null : label };
}

function looksLikeHeader(line: string): boolean {
  const parts = line.split(",");
  if (parts.length < 2) return false;
  const lo = (parts[0] ?? "").trim().toLowerCase();
  const hi = (parts[1] ?? "").trim().toLowerCase();
  return HEADER_LO.has(lo) && HEADER_HI.has(hi);
}

export function parseBandPaste(
  input: string,
  options: ParseBandPasteOptions = {},
): ParseBandPasteResult {
  const added: ParsedBand[] = [];
  const skipped: SkippedBandLine[] = [];
  const seenIds = new Set<string>(options.existingIds ?? []);
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

    const parts = splitRow(line);
    if (parts === null) {
      skipped.push({ line: raw, reason: "unparseable" });
      continue;
    }
    const loParsed = parseEdge(parts.lo);
    const hiParsed = parseEdge(parts.hi);
    if (loParsed === null || hiParsed === null) {
      skipped.push({ line: raw, reason: "unparseable" });
      continue;
    }
    const lo = loParsed === "open" ? Number.NEGATIVE_INFINITY : loParsed;
    const hi = hiParsed === "open" ? Number.POSITIVE_INFINITY : hiParsed;
    // A band must be a non-empty, forward range.
    if (!(lo < hi)) {
      skipped.push({ line: raw, reason: "inverted" });
      continue;
    }

    const id = defaultBandId(lo, hi);
    if (seenIds.has(id)) {
      // Dedupe by id — the [lo, hi) range already exists.
      skipped.push({ line: raw, reason: "duplicate" });
      continue;
    }
    seenIds.add(id);
    const label = parts.label ?? defaultBandLabel(lo, hi);
    added.push({ id, label, lo, hi });
  }

  return { added, skipped, hadHeader };
}
