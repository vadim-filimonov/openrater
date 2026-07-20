/**
 * platformCopy — Brief 88 §6: the platform's non-technical vocabulary,
 * single-sourced so Home, the doors, and ⌘K can never drift apart.
 *
 * 88.0 ships the attention + status-line strings (consumed by
 * `computePlatformAttention` and HomeRoute's hero). The door one-liners and
 * the first-run welcome move here in 88.2, the phase that consumes them.
 *
 * Law 2 (Brief 88 §1): names are not jargon. Every template keeps its
 * subject — plain language wraps around proper nouns, never replaces them.
 * Law 3: one voice — there is exactly ONE phrasing per state, not a
 * per-audience register.
 */

/** The Home hero's one-line answer to "is everything okay?" (Brief 88 §3.2
 *  Block 1). `warn` only when something substantive needs a person;
 *  connector setup alone keeps the line green with an honest suffix (CT-4). */
export interface StatusLine {
  readonly tone: "ok" | "warn";
  readonly title: string;
}

/** Counts produced by `summarizeAttention` (the selector file) — kept as a
 *  plain shape here so this module depends on nothing at runtime. */
export interface AttentionSummary {
  /** Groups whose kind is an alarm (blocking / drift / incomplete). */
  readonly alarmGroupCount: number;
  /** Setup groups (the connector tier — Brief 88 P4: setup, not risk). */
  readonly setupGroupCount: number;
  /** What the attention block renders: alarm + setup groups. */
  readonly needsYouGroupCount: number;
  /** Member counts inside the two connector groups (for the suffix). */
  readonly keylessConnectorCount: number;
  readonly failedConnectorCount: number;
}

/**  — the plan facts the status line leads with (arrival order:
 *  the line is about PLANS; connector setup is at most a suffix). */
export interface PlansSummary {
  readonly count: number;
  readonly liveCount: number;
  /** Drafts that compile clean (ready to publish). */
  readonly readyCount: number;
}

/** The plans clause of the status line ("1 plan · compiles clean —
 *  ready to publish"). Null when there are no plans (first-run copy
 *  owns that state). */
function plansClause(p: PlansSummary): string | null {
  if (p.count === 0) return null;
  if (p.count === 1) {
    if (p.liveCount === 1) return "1 plan · live.";
    if (p.readyCount === 1)
      return "1 plan · compiles clean — ready to publish.";
    return "1 plan · in progress.";
  }
  const parts = [`${p.count} plans`];
  if (p.liveCount > 0) parts.push(`${p.liveCount} live`);
  if (p.readyCount > 0) parts.push(`${p.readyCount} ready to publish`);
  return `${parts.join(" · ")}.`;
}

/** Brief 88 §6 status rows. The "Checking…" and "Can't reach your services"
 *  states stay with the route — they're query states, not attention states.
 *   — with `plans` supplied, the ok-tone line leads with the
 *  plans clause (the thing the actuary came for); connector setup
 *  demotes to a suffix. Alarms keep the line. */
export function statusLineFor(
  s: AttentionSummary,
  plans?: PlansSummary,
): StatusLine {
  if (plans && s.alarmGroupCount === 0) {
    const clause = plansClause(plans);
    if (clause !== null) {
      const k = s.keylessConnectorCount;
      const f = s.failedConnectorCount;
      const suffix =
        s.setupGroupCount > 0 && k + f > 0
          ? k > 0
            ? ` ${k} API Lab connection${k === 1 ? "" : "s"} could use ${k === 1 ? "a key" : "keys"}.`
            : ` ${f} API Lab connection${f === 1 ? "" : "s"} failed ${f === 1 ? "its" : "their"} last run.`
          : "";
      return { tone: "ok", title: `${clause}${suffix}` };
    }
  }
  if (s.alarmGroupCount > 0) {
    const n = s.needsYouGroupCount;
    return {
      tone: "warn",
      title: n === 1 ? "One thing needs attention." : `${n} things need attention.`,
    };
  }
  if (s.setupGroupCount > 0) {
    //  — "connector" is the API Lab's domain word; the front
    // door speaks the room's name.
    const k = s.keylessConnectorCount;
    const f = s.failedConnectorCount;
    if (k > 0 && f > 0) {
      return {
        tone: "ok",
        title: `Running smoothly — ${k} API Lab connection${k === 1 ? "" : "s"} could use ${
          k === 1 ? "a key" : "keys"
        } and ${f} failed ${f === 1 ? "its" : "their"} last run.`,
      };
    }
    if (k > 0) {
      return {
        tone: "ok",
        title:
          k === 1
            ? "Running smoothly — an API Lab connection could use a key."
            : `Running smoothly — ${k} API Lab connections could use keys.`,
      };
    }
    return {
      tone: "ok",
      title:
        f === 1
          ? "Running smoothly — an API Lab connection failed its last run."
          : `Running smoothly — ${f} API Lab connections failed their last run.`,
    };
  }
  return { tone: "ok", title: "Everything's running smoothly." };
}

/** Lower-case a readiness hint's first letter so it reads mid-sentence
 *  ("Build the algorithm first." → "— build the algorithm first."). */
function midSentence(hint: string): string {
  return hint.charAt(0).toLowerCase() + hint.slice(1);
}

/** Brief 88 §3.2 Block 5 — the supporting-room doors (88.2). The two cores
 *  get no doors: their content blocks ARE the doors. Order mirrors the nav
 *  (P1 — one map of the building). */
export const doorCopy = {
  //  — an eyebrow states the group, it doesn't riff.
  heading: "Supporting",
  integrations: {
    name: "Integrations",
    what: "Platforms that quote your plans and report back",
  },
} as const;

/** Brief 88 §3.2 — the first-run welcome (88.2). The template CTA ships
 *  only when a bundled template actually exists (R4's capability check). */
export const firstRunCopy = {
  title: "Welcome to OpenRater — where rating plans are built, tested, and shipped.",
  sub: "Author a plan section by section, test it against a sample risk, publish it, and watch the book fill as quotes come back. Everything starts with a plan.",
  primaryCta: "Create your first plan",
} as const;

/** Brief 88 §3.2 Block 4 — Your book (88.2). */
// current Exhibits design — the book of record is gone; the second
// core is Exhibits, where plans are drawn and compared.
export const exhibitsCopy = {
  heading: "Exhibits",
  empty: "Codify a plan and Exhibits draws it — no risks needed.",
  line: "Every plan, drawn: what it asks, what moves price, how versions differ.",
  open: "Open Exhibits",
} as const;

/** Facts one Your-plans row needs for its next-step phrase (Brief 88 §6:
 *  the same vocabulary the attention rows speak — plan-Overview parity). */
export interface PlanRowFacts {
  readonly live: boolean;
  readonly diverged: boolean;
  readonly servingCount: number;
  /** From the per-plan readiness fan-out; undefined while still loading. */
  readonly compileReady?: boolean | undefined;
  readonly blockingHint?: string | null | undefined;
  readonly errorCount?: number | undefined;
}

/** The one next-step phrase per plan row (Brief 88 §3.2 Block 3). Returns
 *  "" while readiness facts are still loading — a calm empty cell, never a
 *  guess. */
export function planRowNextStep(f: PlanRowFacts): string {
  if ((f.errorCount ?? 0) > 0) {
    const n = f.errorCount ?? 0;
    return `Can't rate — ${n} blocking error${n === 1 ? "" : "s"}.`;
  }
  if (f.live && f.diverged) return "Draft is ahead of live — review & publish.";
  if (f.live) {
    return f.servingCount > 0
      ? `Serving ${f.servingCount} app${f.servingCount === 1 ? "" : "s"}.`
      : "Live.";
  }
  if (f.compileReady === undefined) return "";
  if (f.compileReady) return "Compiles clean — ready to publish.";
  return f.blockingHint ?? "In progress.";
}

/** One template per attention kind. Subject rows get a `text` that follows
 *  the bolded subject; connector groups get a full lead (names render after,
 *  muted — see AttentionList). */
export const attentionCopy = {
  blocking(errorCount: number): { text: string; actionLabel: string } {
    return {
      text: ` can't rate — ${errorCount} blocking error${errorCount === 1 ? "" : "s"}.`,
      actionLabel: "Open Run",
    };
  },
  drift(): { text: string; actionLabel: string } {
    return {
      text: " is live on an older version than your working draft.",
      actionLabel: "Review & publish",
    };
  },
  incomplete(blockingHint: string | null): { text: string; actionLabel: string } {
    return {
      text: blockingHint
        ? ` isn't ready to rate yet — ${midSentence(blockingHint)}`
        : " isn't ready to rate yet.",
      actionLabel: "Finish it",
    };
  },
  ready(): { text: string; actionLabel: string } {
    return {
      text: " compiles clean — ready to publish.",
      actionLabel: "Open Ship",
    };
  },
  unconnected(): { text: string; actionLabel: string } {
    return {
      text: " is live but no app is connected to it yet.",
      actionLabel: "Open Ship",
    };
  },
  //  — "connector" is the API Lab's domain word and stays
  // inside that room; Home speaks the room's name.
  connectorsKeyless(count: number): { text: string; actionLabel: string } {
    return {
      text:
        count === 1
          ? "An API Lab connection is missing its key"
          : `${count} API Lab connections are missing keys`,
      actionLabel: count === 1 ? "Add key" : "Add keys",
    };
  },
  connectorsFailed(count: number): { text: string; actionLabel: string } {
    return {
      text:
        count === 1
          ? "An API Lab connection failed its last run"
          : `${count} API Lab connections failed their last run`,
      actionLabel: "Open API Lab",
    };
  },
} as const;

/** Label the seeded reference program in every plan list so a fresh
 *  install reads as "sample content, safe to poke", not "someone's
 *  real book". Keyed by the fixture's stable
 *  plan id (seed.py: plan ids are the workbooks' own rating_plan_ids,
 *  identical on every box). One entry today; additional bundled
 *  reference programs add rows here, nowhere else. */
export const REFERENCE_PLAN_NOTES: Readonly<Record<string, string>> = {
  "meridian-shopfront-bop-ne-2026":
    "Reference plan — built from the bundled sample filing",
};

/** The list-row note for a seeded reference plan, or null for every
 *  user-created plan. */
export function referencePlanNote(planId: string): string | null {
  return REFERENCE_PLAN_NOTES[planId] ?? null;
}
