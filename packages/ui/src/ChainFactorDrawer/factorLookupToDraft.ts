/**
 * factorLookupToDraft — pure reverse adapter from backend FactorLookup
 * to UI FactorDraft.
 *
 * Inverse of `factorDraftToMutation` for the "chain_row" target. Used
 * by M4.3.9 edit-factor flow: the route loads an existing FactorLookup
 * from the chain stage's config_json, runs this adapter, and feeds
 * the result into <ChainFactorDrawer> as the initial draft.
 *
 * ## Mapping (mirror of forward adapter per ADR-0016)
 *
 *   FactorLookup.lookup_method     → FactorDraft.kind
 *   ────────────────────────────────────────────────────────────
 *   "direct"                       → "lookup.direct"
 *     · dimension_id    = first key of FactorLookup.dimensions
 *     · factor_table_id = FactorLookup.factor_kind (per scoping
 *                         doc §7 — factor_table_id is encoded
 *                         in factor_kind until the API Lab slice
 *                         adds an explicit factor_table_ref field)
 *
 *   "interpolated"                 → "lookup.range" (deferred —
 *                                    Brief 34 PR 34.7 removed
 *                                    `curve.evaluate`; "interpolated"
 *                                    is the legacy wire shape for
 *                                    curves and now maps to the
 *                                    banded-lookup placeholder)
 *
 *   "binned" / "bracketed"         → "lookup.range" (no payload —
 *                                    the UI's range-bins inline
 *                                    primitive isn't built yet)
 *
 * ## Why we don't reverse to "lookup.classification"
 *
 * The forward adapter maps `lookup.classification` to a FactorLookup
 * with `lookup_method="direct"` + a `class_code` dim, throwing away
 * the user's picked class_code (the wire format doesn't store it —
 * the runtime reads the class_code value from the rated risk's form
 * input, not from plan-author state).
 *
 * On reverse, we *could* detect the class_code dim and emit a
 * `lookup.classification` draft with `class_code=""`, but that'd
 * misleadingly re-prompt the user to pick a class (which then
 * gets discarded again on save). Mapping to `lookup.direct` is
 * the honest round-trip: same wire shape, no fake re-pick.
 *
 * ## Why constants / flat_factor aren't here
 *
 * Per ADR-0016, those are sibling stages, not FactorLookup rows.
 * The route never calls this adapter on a sibling stage; it uses
 * the stage's `config_json` directly (a separate edit flow).
 */

import type { FactorLookup } from "@openrater/contracts";
import type { FactorDraft } from "../FactorEditor";

/**
 * Inverse of `factorDraftToMutation` for chain-row factors. Pure
 * function — no I/O, no state. The caller (the route's edit-factor
 * handler) feeds the result straight into `<ChainFactorDrawer>` as
 * the initial draft.
 *
 * Throws if the lookup_method is unknown — defensive against drift.
 */
export function factorLookupToDraft(lookup: FactorLookup): FactorDraft {
  switch (lookup.lookup_method) {
    case "direct":
      return {
        kind: "lookup.direct",
        dimension_id: firstDimensionKey(lookup) ?? "",
        factor_table_id: lookup.factor_kind,
        // ADR-0056 — round-trip the authored unknown-key policy so an
        // edit doesn't silently reset it to the error default.
        ...(lookup.unknown_key_policy
          ? {
              unknown_key_policy:
                lookup.unknown_key_policy.mode === "default"
                  ? {
                      mode: "default" as const,
                      value: lookup.unknown_key_policy.value,
                    }
                  : { mode: lookup.unknown_key_policy.mode },
            }
          : {}),
      };
    case "interpolated":
    case "binned":
    case "bracketed":
      // No UI primitive for range bins yet — return the deferred
      // draft so the drawer renders the placeholder + the Save
      // button stays disabled. The user can't edit the bin
      // structure here today; they'd remove + re-add when the
      // M4.3.x range primitive lands.
      return { kind: "lookup.range" };
    default:
      // Exhaustiveness check via never. If a new lookup_method
      // ever lands on the wire side without updating this file,
      // the compile fails here.
      return assertNever(lookup.lookup_method);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstDimensionKey(lookup: FactorLookup): string | null {
  const keys = Object.keys(lookup.dimensions);
  return keys[0] ?? null;
}

function assertNever(value: never): never {
  throw new Error(
    `factorLookupToDraft: unhandled lookup_method "${value as unknown as string}". This is a contract drift — check FactorLookupMethod in @openrater/contracts.`,
  );
}
