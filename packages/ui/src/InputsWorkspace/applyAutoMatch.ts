/**
 * applyAutoMatchToMapping — Brief 38 PR 38.3 helper.
 *
 * Translates auto-match candidates into a draft column mapping. Pure
 * function. Two policies:
 *
 *   1. AUTO ONLY (default) — apply only candidates whose top score
 *      buckets as "auto" (≥ 0.8). Yellow suggestions stay unmapped
 *      until the user confirms.
 *
 *   2. AUTO + SUGGESTED — apply both, pre-filling the picker with
 *      yellow suggestions. Useful for "fill in everything tentatively
 *      and let me reject" power-user flows.
 *
 * The function also resolves the Brief 38 §7 multi-claim case: if
 * the same source column is the top-1 for multiple required inputs,
 * the FIRST input in iteration order wins; subsequent claims fall
 * back to their NEXT highest candidate (or stay empty if there is
 * none). Returns both the resulting mapping AND a list of conflicts
 * that the UI surfaces as a banner.
 *
 * Existing mappings in `current` are NEVER overwritten — they pass
 * through. Auto-apply only fills in keys not already set. The user
 * is the source of truth.
 */

import type {
  MatchCandidate,
  RequiredInput,
} from "./autoMatch";
import { normalizeIdent } from "./autoMatch";
import { isRatioMapping } from "./ratioMapping";
import { isTimesMapping } from "./timesMapping";

export interface ApplyAutoMatchResult {
  /** The next mapping — input.id → source column name. */
  readonly mapping: Readonly<Record<string, string>>;
  /**
   * Source columns that were claimed by more than one required input
   * (and therefore had to be resolved by ordering). Each entry has
   * the winning input.id + a list of losers (inputs that wanted the
   * same column but didn't get it). The UI surfaces this as a banner.
   *
   * Empty when no conflicts arose.
   */
  readonly conflicts: readonly {
    readonly columnName: string;
    readonly winnerInputId: string;
    readonly loserInputIds: readonly string[];
  }[];
}

export interface ApplyAutoMatchOptions {
  /**
   * Which candidates to apply.
   *   - "auto"          — only top candidates with bucket "auto" (default)
   *   - "auto+suggested" — apply top candidates with bucket "auto" or "suggested"
   *   - "exact"         — ONLY the exact-identity pass (book-intake §2:
   *     upload auto-applies normalized name-equality; fuzzy stays a
   *     suggestion for a person to confirm)
   */
  readonly mode?: "auto" | "auto+suggested" | "exact";
}

/**
 * Apply auto-match candidates to a draft mapping.
 *
 * @param requiredInputs Inputs in iteration order (first-wins).
 * @param candidates Per-input candidate lists from `autoMatchColumns`.
 * @param current Existing mapping — entries here are preserved.
 * @param options Apply policy.
 */
export function applyAutoMatchToMapping(
  requiredInputs: readonly RequiredInput[],
  candidates: Readonly<Record<string, readonly MatchCandidate[]>>,
  current: Readonly<Record<string, string>>,
  options: ApplyAutoMatchOptions = {},
): ApplyAutoMatchResult {
  const mode = options.mode ?? "auto";

  // Track which columns have been claimed (by which input id) so a
  // later input can't trample an earlier auto-applied mapping.
  const claimedBy = new Map<string, string>();

  // Seed claimedBy with existing mappings so they're respected.
  // Derived-ratio / scaled-column sentinels (Brief 45 K8 / FCA #23)
  // are user assertions, not real source columns — don't seed them
  // into claimedBy (they'd be phantom claims on a column name no
  // candidate can ever match). The input itself is still preserved
  // via the `result[input.id]` guard in the loop below, so its
  // sentinel is never overwritten.
  for (const [inputId, columnName] of Object.entries(current)) {
    if (
      columnName &&
      !isRatioMapping(columnName) &&
      !isTimesMapping(columnName)
    ) {
      claimedBy.set(columnName, inputId);
    }
  }

  const result: Record<string, string> = { ...current };
  const conflicts = new Map<
    string,
    { winnerInputId: string; loserInputIds: string[] }
  >();

  // ── Brief 55 item 5 — EXACT-IDENTITY PRIORITY PASS ──────────────────
  //
  // Before the greedy first-wins pass, let an input whose own identity
  // (id / name / displayName) normalize-equals a candidate column's name
  // CLAIM that column. Without this, a column like "class_code" — which
  // name-collides at confidence 1.0 with every input that merely shares a
  // token (`construction_class`/`liab_class_group`/`ppc` via "class",
  // `bceg_grade` via "code"), because `tokenPrefixSimilarity` returns 1.0
  // for a single shared token and value-match is skipped when the dim has
  // no levels — is grabbed by whichever such input iterates FIRST,
  // starving the input the column actually names. The exact match is the
  // definitional owner, so it must win regardless of iteration order. This
  // mirrors `nameSimilarity`'s normalize-equal short-circuit (na === nb →
  // 1.0). Assignment-layer only — the scoring heuristic is untouched.
  const identityForms = (input: RequiredInput): readonly string[] => {
    const forms = [input.id, input.name];
    if (input.displayName) forms.push(input.displayName);
    return forms.map(normalizeIdent).filter((s) => s.length > 0);
  };
  for (const input of requiredInputs) {
    if (result[input.id]) continue; // existing/claimed mapping wins
    const forms = identityForms(input);
    const exact = (candidates[input.id] ?? []).find(
      (cand) =>
        cand.bucket !== "empty" &&
        // respect the apply mode: in "auto" the column still has to clear
        // the auto bar; "auto+suggested" accepts suggested too. "exact"
        // accepts any scored bucket — normalized name-equality is
        // definitional ownership regardless of a dtype penalty.
        !(mode === "auto" && cand.bucket !== "auto") &&
        // only claim a free column — contested columns fall through to the
        // greedy pass below so the conflict is recorded uniformly.
        claimedBy.get(cand.columnName) === undefined &&
        forms.includes(normalizeIdent(cand.columnName)),
    );
    if (exact) {
      result[input.id] = exact.columnName;
      claimedBy.set(exact.columnName, input.id);
    }
  }

  for (const input of requiredInputs) {
    // "exact" applies the identity pass alone — fuzzy candidates stay
    // suggestions for a person to confirm (book-intake §2).
    if (mode === "exact") break;
    // Existing mapping wins — don't overwrite (incl. exact-pass claims).
    if (result[input.id]) continue;

    const cands = candidates[input.id] ?? [];
    if (cands.length === 0) continue;

    // Find the first candidate whose bucket qualifies under the mode
    // AND whose column isn't already claimed.
    for (const cand of cands) {
      if (cand.bucket === "empty") continue;
      if (mode === "auto" && cand.bucket !== "auto") {
        // Even the top candidate doesn't meet the bar — skip.
        break;
      }
      // mode === "auto+suggested" accepts both "auto" and "suggested".

      const claimer = claimedBy.get(cand.columnName);
      if (claimer === undefined) {
        // Column is free — claim it.
        result[input.id] = cand.columnName;
        claimedBy.set(cand.columnName, input.id);
        break;
      }
      // Column already claimed — record the conflict and try the next
      // candidate for this input.
      const entry = conflicts.get(cand.columnName) ?? {
        winnerInputId: claimer,
        loserInputIds: [],
      };
      if (!entry.loserInputIds.includes(input.id)) {
        entry.loserInputIds.push(input.id);
      }
      conflicts.set(cand.columnName, entry);
    }
  }

  return {
    mapping: result,
    conflicts: Array.from(conflicts.entries()).map(
      ([columnName, { winnerInputId, loserInputIds }]) => ({
        columnName,
        winnerInputId,
        loserInputIds,
      }),
    ),
  };
}

/**
 * Determine the status of a single input's mapping, given the auto-
 * match candidates + the current value. Used by `<MappingRow>` to
 * pick the right status pill + row background.
 *
 *   - "auto"       — current value equals the top candidate (auto bucket)
 *   - "suggested"  — current value equals the top candidate (suggested bucket)
 *   - "manual"     — current value is set but doesn't match the top
 *                    candidate (user overrode the recommendation)
 *   - "empty"      — no value set
 *   - "mismatched" — input is in the `mismatchedInputs` set (passed by
 *                    a coordinator that detected value-level mismatches
 *                    via Brief 38 PR 38.4's `detectMismatches`)
 */
export type MappingStatus =
  | "auto"
  | "suggested"
  | "manual"
  | "empty"
  | "mismatched";

export function deriveMappingStatus(
  currentValue: string | undefined,
  candidates: readonly MatchCandidate[],
  isMismatched: boolean,
): MappingStatus {
  if (isMismatched) return "mismatched";
  if (!currentValue) return "empty";
  const top = candidates[0];
  if (!top) return "manual";
  if (top.columnName === currentValue) {
    return top.bucket === "auto" ? "auto" : "suggested";
  }
  return "manual";
}
