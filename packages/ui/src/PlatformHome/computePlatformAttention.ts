/**
 * computePlatformAttention — the OpenRater Home triage brain (Brief 74,
 * re-ranked + grouped by Brief 88 §3.2 / P4).
 *
 * THE deterministic, no-model selector that turns the fanned-out platform
 * state into a ranked list of "what needs you next" GROUPS. One honest
 * phrasing per group (Brief 88 Laws 2–3 — the outcome/specifics two-register
 * split retired with the lens model, P2): identity always, plain language
 * around the names, strings single-sourced in `platformCopy`.
 *
 * NOTE this is genuinely net-new logic. It is NOT `insights.ts` (a
 * factor-table *cell* DSL that emits nothing about plan lifecycle or
 * connectors). It consumes the lifted `computePlanReadiness` (PR 74.0) +
 * the per-plan facts the route fans out.
 *
 * Ranking (Brief 88 §3.2), highest first — never an opaque score, and
 * setup never outranks substance:
 *   blocking → drift → incomplete → ready → unconnected → connector
 *
 * Repetitive connector facts collapse into ONE group per problem
 * (keyless / failed-run) carrying the member names — so three keyless
 * connectors spend one attention slot, not three (the Home cap counts
 * groups).
 */

import type { PlanReadiness } from "../PlanReadiness/planReadiness";
import { attentionCopy } from "./platformCopy";
import type { AttentionSummary } from "./platformCopy";

export type AttentionKind =
  | "blocking"
  | "drift"
  | "incomplete"
  | "connector"
  | "ready"
  | "unconnected";

/** `setup` is the connector tier's tone (Brief 88 P4: setup, not risk) —
 *  rendered as a neutral dot, never a warning color. */
export type AttentionSeverity = "error" | "warn" | "info" | "setup";

export interface AttentionGroup {
  /** Stable React key ("drift:p1", "connector:keyless", …). */
  readonly id: string;
  readonly kind: AttentionKind;
  readonly severity: AttentionSeverity;
  /** The named thing this row concerns (bolded lead) — absent on grouped
   *  connector rows, whose members ride `names` instead. */
  readonly subject?: string;
  /** The sentence: the remainder after `subject`, or the full lead when
   *  there is no subject. From `platformCopy` — never composed inline. */
  readonly text: string;
  /** Grouped members, rendered muted after the text (Law 2 — the names ARE
   *  the information). */
  readonly names?: readonly string[];
  /** Facts inside this group (1 for single-subject rows). */
  readonly count: number;
  /** The single advancing action's label. */
  readonly actionLabel: string;
  /** Deep-link to the surface that resolves it. */
  readonly href: string;
}

export interface PlanFacts {
  readonly id: string;
  readonly name: string;
  /** draft / proposed / active / archived. */
  readonly status: string;
  readonly readiness: PlanReadiness;
  /** Error-severity validation issues (PR 74.3 feeds this). */
  readonly errorCount?: number;
  /** @deprecated Brief 84 — use `published` + `diverged` (kept as a
   *  fallback alias in the drift branch). */
  readonly hasUnfiledDrift?: boolean;
  /** Brief 84 D-F — a published version exists (the plan is LIVE). */
  readonly published?: boolean;
  /** Brief 84 D-F — the working draft has moved off the live version. */
  readonly diverged?: boolean;
  /** Brief 84 D-D — integrations serving this plan live. */
  readonly liveIntegrationCount?: number;
}

export interface ConnectorFacts {
  readonly id: string;
  readonly name: string;
  readonly hasKey: boolean;
  readonly lastRunFailed?: boolean;
}

/** Brief 88 §3.2 — setup (connector) ranks BELOW every plan signal,
 *  including the positive nudges. */
const RANK: Record<AttentionKind, number> = {
  blocking: 0,
  drift: 1,
  incomplete: 2,
  ready: 3,
  unconnected: 4,
  connector: 5,
};

/** Kinds that are an ALARM (something substantive needs a person). The
 *  connector tier stopped being one in Brief 88 P4 — a keyless optional
 *  connector is setup, not risk, and must never turn the front door amber
 *  by itself (CT-4). `ready` / `unconnected` stay nudges (Brief 84 D-D). */
export function isAlarm(kind: AttentionKind): boolean {
  return kind === "blocking" || kind === "drift" || kind === "incomplete";
}

/** The setup tier — listed in the attention block (below alarms), but
 *  spoken in the status line's green suffix, never its warn count. */
export function isSetup(kind: AttentionKind): boolean {
  return kind === "connector";
}

export interface AttentionOpts {
  /** Brief 84 D-D — at least one integration completed pairing. The
   *  `unconnected` nudge only fires when this is true: an API-only shop
   *  with no integrations must never be nagged to connect one. */
  readonly anyIntegrationPaired?: boolean;
  /**  — an API Lab route exists somewhere. Connector setup rows
   *  fire only when true: a configured route is the opt-in to that
   *  room, so a fresh install never opens on a key nag. Defaults true
   *  (legacy callers keep their behavior); Home passes the real
   *  value. */
  readonly hasApiLabRoutes?: boolean;
}

export function computePlatformAttention(
  plans: readonly PlanFacts[],
  connectors: readonly ConnectorFacts[] = [],
  opts: AttentionOpts = {},
): readonly AttentionGroup[] {
  const groups: AttentionGroup[] = [];

  for (const p of plans) {
    const planHref = `/rate-lab/${p.id}`;
    // Brief 84 — the derived headline grammar: LIVE = a published version
    // exists; archived plans raise nothing; everything else is a draft.
    const isArchived = p.status === "archived";
    const isLive = (p.published ?? false) && !isArchived;
    const isDraft = !isLive && !isArchived;

    // 1 — blocking: validation errors mean the plan can't rate.
    if ((p.errorCount ?? 0) > 0) {
      const c = attentionCopy.blocking(p.errorCount ?? 0);
      groups.push({
        id: `blocking:${p.id}`,
        kind: "blocking",
        severity: "error",
        subject: p.name,
        text: c.text,
        count: 1,
        actionLabel: c.actionLabel,
        href: `${planHref}/workspace/verify`,
      });
      continue;
    }

    // 2 — drift: LIVE, but the working draft has moved off the version
    // callers get (Brief 76 P4.4 divergence, surfaced platform-wide).
    if (isLive && (p.diverged ?? p.hasUnfiledDrift ?? false)) {
      const c = attentionCopy.drift();
      groups.push({
        id: `drift:${p.id}`,
        kind: "drift",
        severity: "warn",
        subject: p.name,
        text: c.text,
        count: 1,
        actionLabel: c.actionLabel,
        href: `${planHref}/workspace/ship`,
      });
      continue;
    }

    // 2b — unconnected (Brief 84 D-D, a NUDGE not an alarm): live and
    // healthy, but no app consumes it — only raised when an integration
    // is actually paired platform-wide (never nag an API-only shop).
    if (
      isLive &&
      (p.liveIntegrationCount ?? 0) === 0 &&
      opts.anyIntegrationPaired
    ) {
      const c = attentionCopy.unconnected();
      groups.push({
        id: `unconnected:${p.id}`,
        kind: "unconnected",
        severity: "info",
        subject: p.name,
        text: c.text,
        count: 1,
        actionLabel: c.actionLabel,
        href: `${planHref}/workspace/ship`,
      });
      continue;
    }

    // 3 — incomplete: a draft that can't rate yet (names the missing checkpoint).
    if (isDraft && !p.readiness.compileReady) {
      const c = attentionCopy.incomplete(p.readiness.blockingHint ?? null);
      groups.push({
        id: `incomplete:${p.id}`,
        kind: "incomplete",
        severity: "warn",
        subject: p.name,
        text: c.text,
        count: 1,
        actionLabel: c.actionLabel,
        href: `${planHref}/workspace/inputs`,
      });
      continue;
    }

    // 4 — ready: a draft that passes readiness and hasn't gone live.
    // Deep-links to Ship — going live IS the advancing action (Brief 84).
    if (isDraft && p.readiness.compileReady) {
      const c = attentionCopy.ready();
      groups.push({
        id: `ready:${p.id}`,
        kind: "ready",
        severity: "info",
        subject: p.name,
        text: c.text,
        count: 1,
        actionLabel: c.actionLabel,
        href: `${planHref}/workspace/ship`,
      });
    }
  }

  // 5 — connector setup, GROUPED per problem (Brief 88 P4): repetitive
  // facts collapse into one row carrying the member names.  —
  // only once an API Lab route exists: the route is the opt-in.
  if (opts.hasApiLabRoutes === false) {
    return groups.slice().sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  }
  const keyless = connectors.filter((c) => !c.hasKey);
  if (keyless.length > 0) {
    const c = attentionCopy.connectorsKeyless(keyless.length);
    groups.push({
      id: "connector:keyless",
      kind: "connector",
      severity: "setup",
      text: c.text,
      names: keyless.map((k) => k.name),
      count: keyless.length,
      actionLabel: c.actionLabel,
      href: "/api-lab",
    });
  }
  const failed = connectors.filter((c) => c.hasKey && c.lastRunFailed);
  if (failed.length > 0) {
    const c = attentionCopy.connectorsFailed(failed.length);
    groups.push({
      id: "connector:failed",
      kind: "connector",
      severity: "setup",
      text: c.text,
      names: failed.map((f) => f.name),
      count: failed.length,
      actionLabel: c.actionLabel,
      href: "/api-lab",
    });
  }

  return groups.slice().sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

/** Reduce ranked groups to the counts `statusLineFor` speaks (Brief 88 §6).
 *  Pure + deterministic, like everything else in this file. */
export function summarizeAttention(
  groups: readonly AttentionGroup[],
): AttentionSummary {
  let alarmGroupCount = 0;
  let setupGroupCount = 0;
  let keylessConnectorCount = 0;
  let failedConnectorCount = 0;
  for (const g of groups) {
    if (isAlarm(g.kind)) alarmGroupCount += 1;
    else if (isSetup(g.kind)) {
      setupGroupCount += 1;
      if (g.id === "connector:keyless") keylessConnectorCount = g.count;
      if (g.id === "connector:failed") failedConnectorCount = g.count;
    }
  }
  return {
    alarmGroupCount,
    setupGroupCount,
    needsYouGroupCount: alarmGroupCount + setupGroupCount,
    keylessConnectorCount,
    failedConnectorCount,
  };
}
