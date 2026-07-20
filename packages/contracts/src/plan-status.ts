/**
 * derivePlanStatus — THE one headline status (Brief 84 §1, D-A).
 *
 * The platform answers "is this plan live?" with one word, the same word,
 * everywhere the plan appears — and the word describes what a CALLER
 * experiences:
 *
 *   archived                       → ARCHIVED  (read-only, API off)
 *   a published version exists     → LIVE      (the quote API serves vN)
 *   otherwise                      → DRAFT     (being built, API off)
 *
 * Everything else is a FACT about the plan, not a status: versions,
 * drift ("draft has changes since vN" — Brief 76 P4.4), connections
 * ("live on {integration}" — the Hub ladder). `active` / `proposed` /
 * `frozen` never appear in UI vocabulary (D-A: the backend enum stays,
 * as writability/governance substrate — publish deliberately does NOT
 * write plan.status=active, because the unique-active-per-(LOB, state)
 * index and WRITABLE_STATES={DRAFT} both forbid it).
 *
 * Edge ruled by the brief's derivation table: a backend-`active` plan
 * with nothing published reads as DRAFT — honest, because nothing is
 * served ("live" must never overpromise). No UI path produces that
 * state today (promote has no frontend caller).
 */

/** The minimal shape the derivation reads — structurally satisfied by
 *  @openrater/api-client's PlanSummary / PlanDetail (Brief 84 D-F fields). */
export interface PlanStatusSource {
  /** Backend lifecycle: draft | proposed | active | archived. */
  readonly status: string;
  /** The CURRENT published version — presence is what makes a plan LIVE.
   *  (`| undefined` spelled out for exactOptionalPropertyTypes callers.) */
  readonly published_version?:
    | {
        readonly snapshot_id: string;
        readonly display_name: string;
        readonly published_at: string;
      }
    | null
    | undefined;
  /** Draft content hash ≠ the hash captured on the published version. */
  readonly diverged?: boolean | undefined;
  /** ADR-0057 exposed plans with live=1 serving this plan. */
  readonly live_integration_count?: number | undefined;
}

export type DerivedPlanStatus =
  | { readonly kind: "draft" }
  | {
      readonly kind: "live";
      /** The published version's display name (auto "v1"/"v2" post-84.2;
       *  arbitrary filing tags like "filed_2026_q3" render truncated). */
      readonly versionName: string;
      /** True when the working draft has moved off the live version. */
      readonly diverged: boolean;
      /** How many integrations serve this plan live. */
      readonly liveIntegrationCount: number;
    }
  | { readonly kind: "archived" };

export function derivePlanStatus(plan: PlanStatusSource): DerivedPlanStatus {
  if (plan.status === "archived") {
    return { kind: "archived" };
  }
  const pv = plan.published_version;
  if (pv != null) {
    return {
      kind: "live",
      versionName: pv.display_name,
      diverged: plan.diverged ?? false,
      liveIntegrationCount: plan.live_integration_count ?? 0,
    };
  }
  return { kind: "draft" };
}
