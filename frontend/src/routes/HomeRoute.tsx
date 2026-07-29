/**
 * HomeRoute — OpenRater Home (Brief 74, reshaped by Brief 88 §3.2 / 88.2).
 *
 * ONE page, one voice (P2 — the Overview⇄Operations lens toggle is
 * retired; post-ship evidence in Brief 88 §5). The blocks appear in the
 * order the value flows, so a first-time reader is told what the product
 * does by the layout itself (Law 4):
 *
 *   1 · the status line — the five-second "is everything okay?"
 *   2 · needs attention — named, ranked, grouped (only when items exist)
 *   3 · Your plans — the core the actuary came for
 *   4 · Your book — the second core
 *   5 · the other rooms — doors to the supporting Labs
 *
 * It orchestrates and deep-links; it never re-authors. Copy is
 * single-sourced in @openrater/ui platformCopy (Brief 88 §6).
 */

import { useMemo, type JSX, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Button } from "@openrater/design-system";
import {
  StateHero,
  NavLabs,
  AttentionList,
  PlanStatusChip,
  computePlanReadiness,
  computePlatformAttention,
  summarizeAttention,
  isAlarm,
  isSetup,
  statusLineFor,
  doorCopy,
  firstRunCopy,
  exhibitsCopy,
  planRowNextStep,
  referencePlanNote,
  type NavLabItem,
  type PlanFacts,
  type ConnectorFacts,
} from "@openrater/ui";
// Brief 84 — THE one derived headline status (Draft / Live / Archived).
import { derivePlanStatus } from "@openrater/contracts";
import { usePlansList } from "@openrater/hooks";
import { getApiBase, getPlan, type PlanSummary } from "@openrater/api-client";
import { listConnectors, listRoutes } from "../api/connectors";
// Brief 84 D-D — the don't-nag gate for the "unconnected" nudge.
import { listIntegrations } from "../api/integrations";
import {
  Plus,
  FileText,
  RefreshCw,
  ArrowRight,
  PlugZap,
} from "lucide-react";
import "./HomeRoute.css";

// D6 — the triage shows the top N groups; overflow is stated, never silent.
const ATTENTION_CAP = 6;
// Brief 88 §3.2 Block 3 — the working set, not an archive browser.
const PLAN_ROWS_CAP = 5;

// api-client owns the VITE_API_BASE + same-origin semantics — a raw
// reader here pointed the health probe at a dead absolute default in
// the desktop bundle (see connectors.ts).
const API_BASE = getApiBase();

// Brief 88 P1 — the doors are the SUPPORTING rooms, in nav order (one map
// of the building). The cores get no doors: Blocks 3–4 are their doors.
// Detachment Brief 1 S2 — Model Lab + Data Lab doors removed with the
// cut; Integrations is the one supporting room. TODO(S2): two-core
// Home layout pass.
const DOORS: readonly NavLabItem[] = [
  {
    name: doorCopy.integrations.name,
    what: doorCopy.integrations.what,
    href: "/integrations",
    icon: <PlugZap aria-hidden />,
  },
];

interface PlanFanResult {
  readonly facts: PlanFacts;
  /** MVP-005 — an API Lab route on this plan (opting into that room). */
  readonly hasRoutes: boolean;
}

export function HomeRoute(): JSX.Element {
  const navigate = useNavigate();
  // Modifier-aware client-side navigation for anchor rows (middle-click /
  // new-tab keep working; same pattern as AttentionList).
  const go = (href: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };

  const plansQuery = usePlansList({ status: "all" });
  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);

  // Service health — the honest System signal (GET /health) and the FAST,
  // reliable backend-down trigger (retry 0 + a short timeout). Drives the
  // error state; the ok state speaks through the status line's dot.
  const healthQuery = useQuery({
    queryKey: ["home", "health"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/health`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(`health ${res.status}`);
      return (await res.json()) as { status?: string; db?: string };
    },
    retry: 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const serviceDown = healthQuery.isError;

  // Per-plan readiness fan-out (hybrid, Brief 74 Q3): one detail fetch per
  // plan feeds the shared computePlanReadiness. Publish + drift facts ride
  // the list rows (Brief 84 D-F).
  const planFactQueries = useQueries({
    queries: plans.map((p) => ({
      queryKey: ["home", "plan-facts", p.rating_plan_id],
      queryFn: async (): Promise<PlanFanResult> => {
        const detail = await getPlan(p.rating_plan_id);
        // MVP-005 — routes ride the same fan-out: connector attention
        // engages only when some plan actually wired the API Lab.
        const routes = await listRoutes(p.rating_plan_id).catch(() => ({
          routes: [],
        }));
        const facts: PlanFacts = {
          id: p.rating_plan_id,
          name: p.display_name,
          status: p.status,
          published: p.published_version != null,
          diverged: p.diverged ?? false,
          liveIntegrationCount: p.live_integration_count ?? 0,
          readiness: computePlanReadiness({
            declaredInputCount: detail.stages.filter(
              (st) => st.stage_kind === "input_node",
            ).length,
            chainStageCount: detail.stages.filter(
              (st) => st.stage_kind === "multiplicative_chain",
            ).length,
          }),
        };
        return { facts, hasRoutes: routes.routes.length > 0 };
      },
      staleTime: 60_000,
      retry: false,
    })),
  });
  const hasApiLabRoutes = useMemo(
    () => planFactQueries.some((q) => q.data?.hasRoutes === true),
    [planFactQueries],
  );
  const planFacts = useMemo(
    () =>
      planFactQueries
        .map((q) => q.data?.facts)
        .filter((d): d is PlanFacts => d != null),
    [planFactQueries],
  );
  const factsById = useMemo(
    () => new Map(planFacts.map((f) => [f.id, f])),
    [planFacts],
  );

  // Connectors — keyless / failed-run connections group into setup rows.
  const connectorsQuery = useQuery({
    queryKey: ["home", "connectors"],
    queryFn: () => listConnectors(),
    staleTime: 60_000,
    retry: false,
  });
  const integrationsQuery = useQuery({
    queryKey: ["home", "integrations"],
    queryFn: () => listIntegrations(),
    staleTime: 60_000,
    retry: false,
  });
  const anyIntegrationPaired = useMemo(
    () => (integrationsQuery.data ?? []).some((i) => i.paired),
    [integrationsQuery.data],
  );
  const connectorFacts: readonly ConnectorFacts[] = useMemo(
    () =>
      (connectorsQuery.data?.connectors ?? []).map((c) => ({
        id: c.connector_id,
        name: c.display_name,
        hasKey: !c.needs_secret,
      })),
    [connectorsQuery.data],
  );

  // §6.4 neutral-hold: never flash a verdict before the data lands.
  const plansLoading = plansQuery.isPending;
  const factsSettled =
    plansQuery.isSuccess &&
    (plans.length === 0 || planFactQueries.every((q) => !q.isLoading));
  const attention = useMemo(
    () =>
      computePlatformAttention(planFacts, connectorFacts, {
        anyIntegrationPaired,
        // MVP-005 — a fresh install never opens on a key nag: the
        // connector rows engage once a route exists somewhere.
        hasApiLabRoutes,
      }),
    [planFacts, connectorFacts, anyIntegrationPaired, hasApiLabRoutes],
  );
  // Brief 88 §3.2 — the attention block renders alarms + setup (grouped
  // connectors); positive nudges live in the Your-plans next-step column.
  const needsYou = useMemo(
    () => attention.filter((g) => isAlarm(g.kind) || isSetup(g.kind)),
    [attention],
  );
  // MVP-005 — the status line leads with PLANS (the thing the actuary
  // came for); connector setup demotes to a suffix behind the route
  // gate above.
  const statusLine = useMemo(
    () =>
      statusLineFor(summarizeAttention(attention), {
        count: planFacts.length,
        liveCount: planFacts.filter((f) => f.published && f.status !== "archived")
          .length,
        readyCount: planFacts.filter(
          (f) =>
            !f.published &&
            f.status !== "archived" &&
            f.readiness.compileReady,
        ).length,
      }),
    [attention, planFacts],
  );

  // Block 3 rows — the working set: archived out, most recently edited
  // first, capped (the footer states the rest).
  const activePlans = useMemo(
    () => plans.filter((p) => derivePlanStatus(p).kind !== "archived"),
    [plans],
  );
  const planRows = useMemo(
    () =>
      activePlans
        .slice()
        .sort((a, b) =>
          (b.last_edited_at ?? b.created_at ?? "").localeCompare(
            a.last_edited_at ?? a.created_at ?? "",
          ),
        )
        .slice(0, PLAN_ROWS_CAP),
    [activePlans],
  );
  const rowPhrase = (p: PlanSummary): string => {
    const facts = factsById.get(p.rating_plan_id);
    return planRowNextStep({
      live: p.published_version != null,
      diverged: p.diverged ?? false,
      servingCount: p.live_integration_count ?? 0,
      compileReady: facts?.readiness.compileReady,
      blockingHint: facts?.readiness.blockingHint ?? null,
      errorCount: facts?.errorCount,
    });
  };

  // Backend-down = the health probe failed (fast) — or, as a fallback, the
  // plans query errored. The health probe makes this immediate + honest.
  const isBackendDown = serviceDown || plansQuery.isError;
  const isFirstRun = plansQuery.isSuccess && plans.length === 0;

  if (isBackendDown) {
    return (
      <div className="rater-home">
        <StateHero
          tone="error"
          title="Can't reach your services right now"
          sub="Home reads live status from the backend, and it isn't responding. It may just need to be started."
        />
        <div className="rater-home__actions">
          <Button
            variant="primary"
            onClick={() => plansQuery.refetch()}
            icon={<RefreshCw aria-hidden />}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (isFirstRun) {
    return (
      <div className="rater-home">
        <StateHero
          tone="neutral"
          icon={<FileText aria-hidden />}
          title={firstRunCopy.title}
          sub={firstRunCopy.sub}
        />
        <div className="rater-home__actions">
          <Button
            variant="primary"
            onClick={() => navigate("/rate-lab/new")}
            icon={<Plus aria-hidden />}
          >
            {firstRunCopy.primaryCta}
          </Button>
          {/* Brief 88 R4 — the "Start from the ISO BOP template" secondary
              ships only when a bundled template exists; recipes/ is empty
              today, so it hides. */}
        </div>
        <p className="rater-home__workbook-line">
          Have a filing?{" "}
          <Link to="/rate-lab/new?mode=workbook">Build from a workbook.</Link>
        </p>
        <NavLabs heading={doorCopy.heading} items={DOORS} onNavigate={navigate} />
      </div>
    );
  }

  return (
    <div className="rater-home">
      {/* 1 · the status line — one line, five seconds, zero jargon. */}
      <StateHero
        compact
        tone={factsSettled ? statusLine.tone : "neutral"}
        title={factsSettled ? statusLine.title : "Checking your platform…"}
      />

      {/* 2 · needs attention — its expansion, only when items exist. */}
      {needsYou.length > 0 ? (
        <div className="rater-home__attn">
          <AttentionList
            groups={needsYou.slice(0, ATTENTION_CAP)}
            onNavigate={navigate}
          />
          {needsYou.length > ATTENTION_CAP ? (
            <div className="rater-home__more">
              +{needsYou.length - ATTENTION_CAP} more
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 3 · Your plans — the core the actuary came for. */}
      <section className="rater-home-blk" aria-label="Your plans">
        <div className="rater-home-blk__head">
          <h2 className="rater-home-blk__label">Your plans</h2>
          {!plansLoading ? (
            <span className="rater-home-blk__count">{activePlans.length}</span>
          ) : null}
          <span className="rater-home-blk__spacer" />
          <Button
            variant="ghost"
            onClick={() => navigate("/rate-lab/new")}
            icon={<Plus aria-hidden />}
          >
            New plan
          </Button>
        </div>
        <div className="rater-home-plans">
          {plansLoading ? (
            <>
              <div className="rater-home-plans__ghost" aria-hidden />
              <div className="rater-home-plans__ghost" aria-hidden />
            </>
          ) : (
            planRows.map((p) => (
              <a
                key={p.rating_plan_id}
                className="rater-home-plans__row"
                href={`/rate-lab/${p.rating_plan_id}`}
                onClick={go(`/rate-lab/${p.rating_plan_id}`)}
              >
                <span className="rater-home-plans__name">
                  {p.display_name}
                  {referencePlanNote(p.rating_plan_id) ? (
                    <span className="rater-home-plans__ref-note">
                      {referencePlanNote(p.rating_plan_id)}
                    </span>
                  ) : null}
                </span>
                <span className="rater-home-plans__chip">
                  <PlanStatusChip status={derivePlanStatus(p)} />
                </span>
                <span className="rater-home-plans__next">{rowPhrase(p)}</span>
                <span className="rater-home-plans__open">
                  Open <ArrowRight aria-hidden />
                </span>
              </a>
            ))
          )}
          {!plansLoading && activePlans.length > PLAN_ROWS_CAP ? (
            <a
              className="rater-home-plans__foot"
              href="/rate-lab"
              onClick={go("/rate-lab")}
            >
              All {activePlans.length} plans in Rate Lab →
            </a>
          ) : null}
        </div>
      </section>

      {/* 4 · Exhibits — the second core: plans drawn, compared, priced. */}
      <section className="rater-home-blk" aria-label="Exhibits">
        <div className="rater-home-blk__head">
          <h2 className="rater-home-blk__label">{exhibitsCopy.heading}</h2>
        </div>
        <div className="rater-home-book">
          {plans.length > 0 ? (
            <span className="rater-home-book__stat">
              {exhibitsCopy.line}
            </span>
          ) : (
            <span className="rater-home-book__empty">{exhibitsCopy.empty}</span>
          )}
          <span className="rater-home-book__spacer" />
          <a
            className="rater-home-book__open"
            href="/exhibits"
            onClick={go("/exhibits")}
          >
            {exhibitsCopy.open} <ArrowRight aria-hidden />
          </a>
        </div>
      </section>

      {/* 5 · the other rooms — the supporting Labs, in nav order. */}
      <NavLabs heading={doorCopy.heading} items={DOORS} onNavigate={navigate} />
    </div>
  );
}
