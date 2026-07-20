// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * /integrations/:id — the Hub (Brief 77 §§2–3, L4–L5 + the audit pass).
 *
 * The six-step spine IS the IA (the control-tower lesson): a left rail
 * with completion dots, one pane per step, re-enterable forever — the
 * wizard and the management surface are the same screen.
 *
 * Pairing polls at 2s while a code is outstanding (Brief 77 §9 Q2) so
 * the "Paired ✓" flip needs no refresh. The code renders ONCE — key
 * hygiene — with a live countdown to its 10-minute expiry.
 *
 * Durability (Brief 58's house rule): the mapper's unsaved draft and
 * the Test form's typed values live HERE, keyed by exposed plan — step
 * navigation never discards them; only Save (or a completed run of the
 * journey) does. The rail marks the Map step "unsaved" while a draft
 * is dirty, and leaving the page warns.
 *
 * Vocabulary (Brief 77 §1): everything the operator reads is a label —
 * plan input labels, peer field labels, version display names. Wire
 * values appear only in small mono beside their labels; engine text
 * only behind a "technical detail" disclosure.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type JSX,
  type SetStateAction,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, ChevronLeft, ClipboardCopy, TriangleAlert } from "lucide-react";
import { Button } from "@openrater/design-system";
import { isoDate } from "@openrater/ui";
import { usePlansList } from "@openrater/hooks";
import { getPublishStatus, type PublishStatus } from "@openrater/api-client";
import {
  apiBase,
  autoMatch,
  exampleValueFor,
  exposePlan,
  getCatalog,
  getConsumedInputs,
  getIntegration,
  getPulse,
  listExposedPlans,
  mintPairingCode,
  patchExposedPlan,
  removeExposedPlan,
  runTestQuote,
  type CatalogField,
  type ConsumedInput,
  type ExposedPlan,
  type IntegrationPulse,
  type IntegrationSummary,
  type MatchConfidence,
  type PairingCode,
  type RowIssueDetail,
  type TestQuoteResult,
} from "../api/integrations";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import "./IntegrationDetailRoute.css";

type StepId = "pair" | "plans" | "map" | "policies" | "test" | "live";

const STEPS: ReadonlyArray<{ id: StepId; n: number; label: string }> = [
  { id: "pair", n: 1, label: "Pair" },
  { id: "plans", n: 2, label: "Plans" },
  { id: "map", n: 3, label: "Map" },
  { id: "policies", n: 4, label: "Policies" },
  { id: "test", n: 5, label: "Test" },
  { id: "live", n: 6, label: "Live" },
];

const TRACE_LABELS: Record<ExposedPlan["trace_policy"], string> = {
  summary: "Drivers only",
  full: "Full build-up",
  none: "Premium only",
};

//  — absolute dates are ISO everywhere.
const day = (iso: string | null): string => (iso ? isoDate(iso) : "—");

/** Relative time for the pulse — recency is the signal, the exact
 *  date rides the title. */
const rel = (iso: string | null): string => {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return day(iso);
};

/** Draft state the route holds per exposed plan so step navigation
 *  never loses work (Brief 58). */
interface MapDraft {
  draft: Record<string, string>;
  matched: Record<string, MatchConfidence>;
  dirty: boolean;
}

function useCountdown(expiresAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

export function IntegrationDetailRoute(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [integration, setIntegration] = useState<IntegrationSummary | null>(null);
  useDocumentTitle(integration?.name, "Integrations");
  const [plans, setPlans] = useState<ExposedPlan[] | null>(null);
  const [pulse, setPulse] = useState<IntegrationPulse | null>(null);
  const [code, setCode] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<StepId | null>(null);
  const countdown = useCountdown(code?.expires_at ?? null);
  // Durable work (Brief 58): unsaved mapper drafts + typed test values
  // live at the route, keyed by exposed plan — step nav never wipes them.
  const [catalog, setCatalog] = useState<CatalogField[] | null>(null);
  const [mapDrafts, setMapDrafts] = useState<Record<string, MapDraft>>({});
  const [testValues, setTestValues] = useState<Record<string, Record<string, string>>>({});
  const anyDirty = Object.values(mapDrafts).some((d) => d.dirty);

  const load = useCallback(async () => {
    try {
      const [summary, exposed, feed] = await Promise.all([
        getIntegration(id),
        listExposedPlans(id),
        getPulse(id),
      ]);
      setIntegration(summary);
      setPlans(exposed);
      setPulse(feed);
      setError(null);
      return summary;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
      return null;
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  // Brief 77 §9 Q2 — poll at 2s while a code is outstanding, unpaired.
  useEffect(() => {
    if (!code || integration?.paired) return;
    const t = setInterval(() => {
      void load().then((s) => {
        if (s?.paired) setCode(null);
      });
    }, 2000);
    return () => clearInterval(t);
  }, [code, integration?.paired, load]);

  // One catalog fetch for both per-plan surfaces (Map · Test).
  useEffect(() => {
    if (!integration?.paired) return;
    getCatalog(id)
      .then(setCatalog)
      .catch((e: Error) => setError(e.message));
  }, [id, integration?.paired]);

  // An unsaved mapping is real work — warn before the tab goes.
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const done: Record<StepId, boolean> = useMemo(() => {
    const exposed = plans ?? [];
    return {
      pair: !!integration?.paired,
      plans: exposed.length > 0,
      // Drafts can't be exposed (server-enforced), so every exposed plan
      // has a published version and consumed_missing is honest: 0 means
      // every required input the version declares is covered.
      map: exposed.length > 0 && exposed.every((p) => p.consumed_missing === 0),
      policies: exposed.length > 0,
      // A plan can't reach Live without one green test (Brief 77 step 5) —
      // and a republish since that test (live_version_untested, audit gap #3)
      // re-opens the Test step: the CURRENT version needs re-validating.
      test:
        exposed.length > 0 &&
        exposed.every((p) => p.last_test_at !== null && !p.live_version_untested),
      // Live only counts a plan that's actually SERVING — a drifted live plan
      // is demoted, so it doesn't complete the step.
      live: exposed.some((p) => p.status === "live" && !p.live_version_untested),
    };
  }, [integration, plans]);

  const active: StepId =
    step ??
    (!done.pair
      ? "pair"
      : !done.plans
        ? "plans"
        : !done.map
          ? "map"
          : !done.test
            ? "test"
            : "live");

  const mint = async () => {
    try {
      setCode(await mintPairingCode(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mint a code.");
    }
  };

  const patch = async (
    exposedId: string,
    body: Parameters<typeof patchExposedPlan>[2],
  ) => {
    try {
      await patchExposedPlan(id, exposedId, body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Change failed.");
    }
  };

  if (error && !integration) {
    return (
      <div className="hub">
        <div className="hub__error">{error}</div>
      </div>
    );
  }

  return (
    <div className="hub">
      <header className="hub__head">
        <button type="button" className="hub__back" onClick={() => navigate("/integrations")}>
          <ChevronLeft size={14} aria-hidden />
          Integrations
        </button>
        <h1 className="hub__title">{integration?.name ?? "…"}</h1>
        {integration && (
          <span
            className={`hub__chip ${integration.paired ? "hub__chip--live" : "hub__chip--pending"}`}
          >
            <i />
            {integration.paired
              ? done.live
                ? `Live · ${pulse?.plans_live ?? 0} plan${(pulse?.plans_live ?? 0) === 1 ? "" : "s"}`
                : "Paired"
              : "Awaiting pairing"}
          </span>
        )}
      </header>

      {error && integration && <div className="hub__error">{error}</div>}

      <div className="hub__grid">
        <nav className="hub__spine" aria-label="Setup steps">
          {STEPS.map((s) => {
            const isDone = done[s.id];
            const isActive = active === s.id;
            const showUnsaved = s.id === "map" && anyDirty;
            return (
              <button
                key={s.id}
                type="button"
                className={[
                  "hub__step",
                  isActive && "hub__step--on",
                  isDone && "hub__step--done",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setStep(s.id)}
              >
                <span className="hub__dot">
                  {isDone ? <Check size={12} aria-label="done" /> : s.n}
                </span>
                <span className="hub__step-label">
                  {s.label}
                  {showUnsaved && <em className="hub__unsaved"> · unsaved</em>}
                </span>
              </button>
            );
          })}
        </nav>

        <main className="hub__pane">
          {active === "pair" && (
            <PairPane
              integration={integration}
              code={code}
              countdown={countdown}
              onMint={() => void mint()}
            />
          )}
          {active === "plans" && (
            <PlansPane
              integrationId={id}
              integrationName={integration?.name ?? "this integration"}
              plans={plans ?? []}
              onChanged={() => void load()}
              onError={setError}
            />
          )}
          {active === "map" && (
            <MapPane
              integrationId={id}
              plans={plans ?? []}
              catalog={catalog}
              drafts={mapDrafts}
              setDrafts={setMapDrafts}
              onChanged={() => void load()}
              onError={setError}
            />
          )}
          {active === "policies" && (
            <PoliciesPane plans={plans ?? []} onPatch={patch} />
          )}
          {active === "test" && (
            <TestPane
              integrationId={id}
              plans={plans ?? []}
              catalog={catalog}
              values={testValues}
              setValues={setTestValues}
              onGoToMap={() => setStep("map")}
              onChanged={() => void load()}
              onError={setError}
            />
          )}
          {active === "live" && (
            <LivePane
              plans={plans ?? []}
              integrationName={integration?.name ?? "this integration"}
              pulse={pulse}
              onPatch={patch}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function PairPane({
  integration,
  code,
  countdown,
  onMint,
}: {
  integration: IntegrationSummary | null;
  code: PairingCode | null;
  countdown: string | null;
  onMint: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);
  const copyBoth = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`${code.code}\n${apiBase()}`);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied — the code stays selectable on screen */
    }
  };
  if (integration?.paired && !code) {
    return (
      <section>
        <h2 className="hub__h2">Paired</h2>
        <p className="hub__lead">
          {integration.peer_name ?? "The peer"} paired {day(integration.paired_at)}
          {integration.catalog_field_count > 0
            ? ` — catalog synced, ${integration.catalog_field_count} fields.`
            : "."}{" "}
          Re-pairing rotates the integrator key — the old key dies the moment
          the new code is used.
        </p>
        <div className="hub__card hub__card--pad">
          <Button variant="ghost" onClick={onMint}>
            Generate a re-pair code
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section>
      <h2 className="hub__h2">Pair with the platform</h2>
      <p className="hub__lead">
        One code connects the platforms. It works once and expires in ten
        minutes — generating a new one retires this one.
      </p>
      <div className="hub__card hub__card--center">
        {code ? (
          <>
            <div className="hub__code">{code.code}</div>
            <div className="hub__url">{apiBase()}</div>
            <div className="hub__code-meta">
              <span className="hub__ttl">expires in {countdown ?? "…"}</span>
              <Button variant="primary" onClick={() => void copyBoth()}>
                {copied ? (
                  <>
                    <Check size={14} aria-hidden /> Copied
                  </>
                ) : (
                  <>
                    <ClipboardCopy size={14} aria-hidden /> Copy code + URL
                  </>
                )}
              </Button>
              <Button variant="ghost" onClick={onMint}>
                Generate a new code
              </Button>
            </div>
            <p className="hub__instruction">
              In the peer platform, open <b>Admin → Rating</b> and paste both.
              This page flips by itself the moment the pairing lands.
            </p>
          </>
        ) : (
          <Button variant="primary" onClick={onMint}>
            Generate pairing code
          </Button>
        )}
      </div>
    </section>
  );
}

/** The carrier-label suggestion (Brief 77 step 2) — the peer-facing
 *  name, seeded from the plan's own name, always editable. */
function suggestLabel(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
}

function PlansPane({
  integrationId,
  integrationName,
  plans,
  onChanged,
  onError,
}: {
  integrationId: string;
  /** Brief 84 D-G — liveness copy names the app. */
  integrationName: string;
  plans: ExposedPlan[];
  onChanged: () => void;
  onError: (message: string | null) => void;
}): JSX.Element {
  const allPlans = usePlansList({ status: "all" });
  const [planId, setPlanId] = useState("");
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [publishByPlan, setPublishByPlan] = useState<Record<string, PublishStatus>>({});
  const exposedIds = new Set(plans.map((p) => p.rating_plan_id));
  const candidates = (allPlans.data ?? []).filter(
    (p) => !exposedIds.has(p.rating_plan_id),
  );

  // Publish state per plan — drives the disabled "publish first" rows
  // (Brief 77 §5's teaching moment) and the snapshot-age chip. Fetches
  // each plan once; the functional merge keeps re-runs idempotent.
  const allPlanRows = allPlans.data;
  useEffect(() => {
    const ids = [
      ...(allPlanRows ?? []).map((p) => p.rating_plan_id),
      ...plans.map((p) => p.rating_plan_id),
    ];
    let cancelled = false;
    setPublishByPlan((prev) => {
      const missing = ids.filter((pid) => prev[pid] === undefined);
      if (missing.length > 0) {
        void Promise.all(
          missing.map(async (pid) => {
            try {
              return [pid, await getPublishStatus(pid)] as const;
            } catch {
              return null;
            }
          }),
        ).then((entries) => {
          if (cancelled) return;
          setPublishByPlan((current) => {
            const next = { ...current };
            for (const entry of entries) {
              if (entry) next[entry[0]] = entry[1];
            }
            return next;
          });
        });
      }
      return prev;
    });
    return () => {
      cancelled = true;
    };
  }, [allPlanRows, plans]);

  const pickPlan = (pid: string) => {
    setPlanId(pid);
    if (!labelTouched) {
      const chosen = candidates.find((p) => p.rating_plan_id === pid);
      setLabel(chosen ? suggestLabel(chosen.display_name) : "");
    }
  };

  const add = async () => {
    if (!planId || !label.trim()) return;
    try {
      await exposePlan(integrationId, {
        rating_plan_id: planId,
        carrier_label: label.trim(),
      });
      setPlanId("");
      setLabel("");
      setLabelTouched(false);
      onError(null);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Expose failed.");
    }
  };

  const remove = async (exposedId: string) => {
    try {
      await removeExposedPlan(integrationId, exposedId);
      setConfirmRemove(null);
      onError(null);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Remove failed.");
    }
  };

  return (
    <section>
      <h2 className="hub__h2">What can they quote?</h2>
      <p className="hub__lead">
        Each exposed plan wears a carrier name — the label the peer's users
        see next to the premium. A plan goes live only after its required
        inputs are mapped.
      </p>
      <div className="hub__card">
        {plans.map((p) => {
          const pub = publishByPlan[p.rating_plan_id];
          if (confirmRemove === p.exposed_id) {
            return (
              <div className="hub__row hub__row--confirm" key={p.exposed_id}>
                <span className="hub__row-id">
                  <span className="hub__row-name">
                    Remove {p.carrier_label}?
                  </span>
                  <span className="hub__row-sub">
                    {p.status === "live"
                      ? "It's LIVE — the peer stops getting this premium immediately. "
                      : ""}
                    Its mapping, policies, and test receipt go with it.
                  </span>
                </span>
                <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
                  Keep
                </Button>
                <Button variant="danger" onClick={() => void remove(p.exposed_id)}>
                  Remove
                </Button>
              </div>
            );
          }
          return (
            <div className="hub__row" key={p.exposed_id}>
              <span className="hub__row-id">
                <span className="hub__row-name">
                  {p.plan_display_name ?? p.rating_plan_id}
                </span>
                <span className="hub__row-sub">
                  {[p.product, p.state].filter(Boolean).join(" · ") || "—"}
                  {pub?.published_at ? ` · version published ${day(pub.published_at)}` : ""}
                  {p.published ? "" : " · no published version"} · as{" "}
                  <b>{p.carrier_label}</b>
                </span>
              </span>
              <span className={`hub__journey hub__journey--${p.status}`}>
                {/* Brief 84 D-G — integration liveness always names the
                    app, so it can't be read as the plan's own LIVE. */}
                {p.status === "live" ? `live on ${integrationName}` : p.status}
              </span>
              <button
                type="button"
                className="hub__quiet"
                onClick={() => setConfirmRemove(p.exposed_id)}
              >
                remove
              </button>
            </div>
          );
        })}
        {plans.length === 0 && (
          <div className="hub__row hub__row--empty">Nothing exposed yet.</div>
        )}
        <div className="hub__row hub__row--form">
          <select
            className="hub__select"
            value={planId}
            onChange={(e) => pickPlan(e.target.value)}
            aria-label="Plan to expose"
          >
            <option value="">Choose a plan…</option>
            {candidates.map((p) => {
              const pub = publishByPlan[p.rating_plan_id];
              const unpublished = pub !== undefined && !pub.published;
              return (
                <option
                  key={p.rating_plan_id}
                  value={p.rating_plan_id}
                  disabled={unpublished}
                >
                  {p.display_name}
                  {p.jurisdiction ? ` · ${p.jurisdiction}` : ""}
                  {unpublished ? " — publish first" : ""}
                </option>
              );
            })}
          </select>
          <input
            className="hub__input"
            type="text"
            placeholder="Carrier label — the peer's name for it"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setLabelTouched(true);
            }}
            aria-label="Carrier label"
          />
          <Button variant="primary" onClick={() => void add()} disabled={!planId || !label.trim()}>
            Expose
          </Button>
        </div>
      </div>
      <p className="hub__fence">
        Only plans with a published version can be exposed — drafts stay
        listed so you can see what publishing would unlock.
      </p>
    </section>
  );
}

function PoliciesPane({
  plans,
  onPatch,
}: {
  plans: ExposedPlan[];
  onPatch: (exposedId: string, body: Parameters<typeof patchExposedPlan>[2]) => Promise<void>;
}): JSX.Element {
  return (
    <section>
      <h2 className="hub__h2">Policies</h2>
      <p className="hub__lead">
        Per carrier: how much of the premium math their users see, and how
        long a premium is quotable as shown. Quotes also flag for re-quote
        when you publish a new version.
      </p>
      <div className="hub__card">
        {plans.map((p) => (
          <div className="hub__row" key={p.exposed_id}>
            <span className="hub__row-id">
              <span className="hub__row-name">{p.carrier_label}</span>
              <span className="hub__row-sub">
                {p.plan_display_name ?? p.rating_plan_id}
              </span>
            </span>
            <select
              className="hub__select"
              value={p.trace_policy}
              onChange={(e) =>
                void onPatch(p.exposed_id, {
                  trace_policy: e.target.value as ExposedPlan["trace_policy"],
                })
              }
              aria-label={`Trace policy for ${p.carrier_label}`}
            >
              {(Object.keys(TRACE_LABELS) as ExposedPlan["trace_policy"][]).map(
                (t) => (
                  <option key={t} value={t}>
                    {TRACE_LABELS[t]}
                  </option>
                ),
              )}
            </select>
            <label className="hub__validity">
              quotable
              <input
                className="hub__input hub__input--n"
                type="number"
                min={1}
                max={365}
                defaultValue={p.validity_days}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isInteger(v) && v >= 1 && v <= 365 && v !== p.validity_days) {
                    void onPatch(p.exposed_id, { validity_days: v });
                  }
                }}
                aria-label={`Validity days for ${p.carrier_label}`}
              />
              days
            </label>
          </div>
        ))}
        {plans.length === 0 && (
          <div className="hub__row hub__row--empty">Expose a plan first.</div>
        )}
      </div>
      <p className="hub__fence">
        Their quote and bind events land on this ledger as records only —
        OpenRater never executes a bind.
      </p>
    </section>
  );
}

function LivePane({
  plans,
  integrationName,
  pulse,
  onPatch,
}: {
  plans: ExposedPlan[];
  /** Brief 84 D-G — liveness copy names the app. */
  integrationName: string;
  pulse: IntegrationPulse | null;
  onPatch: (exposedId: string, body: Parameters<typeof patchExposedPlan>[2]) => Promise<void>;
}): JSX.Element {
  const [confirmPauseAll, setConfirmPauseAll] = useState(false);
  const [pausing, setPausing] = useState(false);
  const liveOnes = plans.filter((p) => p.live);
  const pauseAll = async () => {
    setPausing(true);
    try {
      for (const p of liveOnes) {
        await onPatch(p.exposed_id, { live: false });
      }
    } finally {
      setPausing(false);
      setConfirmPauseAll(false);
    }
  };
  return (
    <section>
      <h2 className="hub__h2">Live</h2>
      <p className="hub__lead">
        Switch carriers on and watch their event feed. This strip is health,
        not analytics.
      </p>
      {pulse && (
        <div className="hub__pulse">
          <div className="hub__stat">
            <span className="hub__stat-k">Plans live</span>
            <span className="hub__stat-v">
              {pulse.plans_live}
              <small> of {pulse.plans_exposed}</small>
            </span>
          </div>
          <div className="hub__stat">
            <span className="hub__stat-k">Events applied</span>
            <span className="hub__stat-v">{pulse.events_applied}</span>
          </div>
          <div className="hub__stat">
            <span className="hub__stat-k">Duplicates · errors</span>
            <span className="hub__stat-v">
              {pulse.events_duplicate} · {pulse.events_error}
            </span>
          </div>
          <div className="hub__stat">
            <span className="hub__stat-k">Last event</span>
            <span
              className="hub__stat-v hub__stat-v--sm"
              title={pulse.last_event_at ?? undefined}
            >
              {rel(pulse.last_event_at)}
            </span>
          </div>
          {liveOnes.length > 0 &&
            (confirmPauseAll ? (
              <span className="hub__pause-confirm">
                <span className="hub__row-sub">
                  Pause {liveOnes.length} live plan
                  {liveOnes.length === 1 ? "" : "s"}? Quote requests get a
                  named “plan paused” answer.
                </span>
                <Button variant="ghost" onClick={() => setConfirmPauseAll(false)} disabled={pausing}>
                  Keep live
                </Button>
                <Button variant="danger" onClick={() => void pauseAll()} disabled={pausing}>
                  {pausing ? "Pausing…" : "Pause all"}
                </Button>
              </span>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmPauseAll(true)}>
                Pause all
              </Button>
            ))}
        </div>
      )}
      <div className="hub__card">
        {plans.map((p) => {
          // Republish drift (audit gap #3): the toggle is on but the live
          // version isn't the tested one, so the seam demoted it from serving.
          const drifted = p.live && p.live_version_untested;
          return (
            <div className="hub__row" key={p.exposed_id}>
              <label className="hub__switch">
                <input
                  type="checkbox"
                  checked={p.live}
                  disabled={p.consumed_missing > 0 || p.last_test_at === null}
                  onChange={(e) => void onPatch(p.exposed_id, { live: e.target.checked })}
                  aria-label={`${p.carrier_label} live`}
                />
                <i />
              </label>
              <span className="hub__row-id">
                <span className="hub__row-name">{p.carrier_label}</span>
                <span className="hub__row-sub">
                  {p.plan_display_name ?? p.rating_plan_id} · trace{" "}
                  {TRACE_LABELS[p.trace_policy].toLowerCase()} ·{" "}
                  {drifted
                    ? "live version changed · re-test to resume serving"
                    : p.consumed_missing > 0
                      ? `${p.consumed_missing} required input${p.consumed_missing === 1 ? "" : "s"} unmapped`
                      : p.last_test_at === null
                        ? "run a green test first"
                        : `tested ${day(p.last_test_at)}`}
                </span>
              </span>
              {drifted ? (
                <span
                  className="hub__journey hub__journey--drift"
                  title="This plan's published version changed since its last green test, so the seam demoted it from serving. Re-run the Test step to resume."
                >
                  <TriangleAlert size={11} aria-hidden /> re-test
                </span>
              ) : (
                <span className={`hub__journey hub__journey--${p.status}`}>
                  {p.status === "live" ? `live on ${integrationName}` : p.status}
                </span>
              )}
            </div>
          );
        })}
        {plans.length === 0 && (
          <div className="hub__row hub__row--empty">Expose a plan first.</div>
        )}
      </div>
      <p className="hub__fence">
        Pausing a plan answers quote requests with a named "plan paused" note
        — honesty, not an error.
      </p>
    </section>
  );
}

/** Shared plan-tab strip for the two per-plan surfaces (Map · Test). */
function PlanTabs({
  plans,
  selected,
  onSelect,
  meter,
}: {
  plans: ExposedPlan[];
  selected: string | null;
  onSelect: (exposedId: string) => void;
  meter: (p: ExposedPlan) => string;
}): JSX.Element {
  return (
    <div className="hub__tabs" role="tablist">
      {plans.map((p) => (
        <button
          key={p.exposed_id}
          type="button"
          role="tab"
          aria-selected={selected === p.exposed_id}
          className={`hub__tab ${selected === p.exposed_id ? "hub__tab--on" : ""}`}
          onClick={() => onSelect(p.exposed_id)}
        >
          {p.carrier_label}
          <span className="hub__tab-meter">{meter(p)}</span>
        </button>
      ))}
    </div>
  );
}

function MapPane({
  integrationId,
  plans,
  catalog,
  drafts,
  setDrafts,
  onChanged,
  onError,
}: {
  integrationId: string;
  plans: ExposedPlan[];
  catalog: CatalogField[] | null;
  drafts: Record<string, MapDraft>;
  setDrafts: Dispatch<SetStateAction<Record<string, MapDraft>>>;
  onChanged: () => void;
  onError: (message: string | null) => void;
}): JSX.Element {
  const [selected, setSelected] = useState<string | null>(plans[0]?.exposed_id ?? null);
  const [inputs, setInputs] = useState<ConsumedInput[] | null>(null);
  const [saving, setSaving] = useState(false);
  const plan = plans.find((p) => p.exposed_id === selected) ?? null;
  const entry = selected ? drafts[selected] : undefined;
  const draft = entry?.draft ?? {};
  const matched = entry?.matched ?? {};
  const dirty = entry?.dirty ?? false;
  const byPeerKey = useMemo(
    () => new Map((catalog ?? []).map((f) => [f.key, f])),
    [catalog],
  );

  const setEntry = useCallback(
    (exposedId: string, update: (prev: MapDraft) => MapDraft) => {
      setDrafts((all) => ({
        ...all,
        [exposedId]: update(
          all[exposedId] ?? { draft: {}, matched: {}, dirty: false },
        ),
      }));
    },
    [setDrafts],
  );

  useEffect(() => {
    if (!selected) return;
    setInputs(null);
    getConsumedInputs(integrationId, selected)
      .then((data) => {
        setInputs(data);
        // Seed from the server ONLY when no draft is being held — an
        // unsaved draft survives step navigation (Brief 58).
        setDrafts((all) =>
          all[selected]
            ? all
            : {
                ...all,
                [selected]: {
                  draft: Object.fromEntries(
                    data.map((c) => [c.key, c.mapped_from ?? ""]),
                  ),
                  matched: {},
                  dirty: false,
                },
              },
        );
      })
      .catch((e: Error) => onError(e.message));
  }, [integrationId, selected, onError, setDrafts]);

  const required = (inputs ?? []).filter((c) => c.required);
  const optional = (inputs ?? []).filter((c) => !c.required);
  const coveredRequired = required.filter((c) => draft[c.key]).length;

  const runAutoMatch = () => {
    if (!selected || !inputs || !catalog) return;
    setEntry(selected, (prev) => {
      const nextDraft = { ...prev.draft };
      const nextMatched: Record<string, MatchConfidence> = { ...prev.matched };
      const taken = new Set(Object.values(nextDraft).filter(Boolean));
      for (const input of inputs) {
        if (nextDraft[input.key]) continue;
        const hit = autoMatch(input, catalog);
        if (hit && !taken.has(hit.peerKey)) {
          nextDraft[input.key] = hit.peerKey;
          nextMatched[input.key] = hit.confidence;
          taken.add(hit.peerKey);
        }
      }
      return { draft: nextDraft, matched: nextMatched, dirty: true };
    });
  };

  const save = async () => {
    if (!plan || !inputs || saving || !selected) return;
    setSaving(true);
    try {
      const mapping = inputs
        .filter((c) => draft[c.key])
        .map((c) => ({
          peer_key: draft[c.key]!,
          plan_input_key: c.key,
          dtype: c.dtype,
          required: c.required,
        }));
      await patchExposedPlan(integrationId, plan.exposed_id, { mapping });
      // Saved — the held draft IS the server copy now; keep it, clean.
      setDrafts((all) => ({
        ...all,
        [selected]: { draft: { ...draft }, matched: {}, dirty: false },
      }));
      onError(null);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const row = (input: ConsumedInput): JSX.Element => {
    const value = draft[input.key] ?? "";
    const confidence = matched[input.key];
    const unmappedRequired = input.required && !value;
    // The value-transparency warning (map-time, not test-time): the
    // peer's example is what their wire will realistically carry — if
    // the plan only accepts an enumerated set and the example isn't in
    // it, say so HERE, where the fix is chosen.
    const peer = value ? byPeerKey.get(value) : undefined;
    const example =
      peer?.example === undefined || peer?.example === null
        ? null
        : String(peer.example);
    const valueMismatch =
      value !== "" &&
      example !== null &&
      (input.allowed_values?.length ?? 0) > 0 &&
      !input.allowed_values!.some((a) => a.value === example);
    return (
      <div
        className={`hub__row ${unmappedRequired ? "hub__row--gap" : ""}`}
        key={input.key}
      >
        <span className="hub__row-id">
          <span className="hub__row-name">{input.label ?? input.key}</span>
          <span className="hub__row-sub">
            <code>{input.key}</code>
            {input.dtype ? ` · ${input.dtype}` : ""}
            {input.required ? " · required" : ""}
            {(input.allowed_values?.length ?? 0) > 0
              ? ` · ${input.allowed_values!.length} plan values`
              : ""}
          </span>
        </span>
        <select
          className="hub__select hub__select--map"
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            if (selected) {
              setEntry(selected, (prev) => {
                const { [input.key]: _dropped, ...restMatched } = prev.matched;
                return {
                  draft: { ...prev.draft, [input.key]: next },
                  matched: restMatched,
                  dirty: true,
                };
              });
            }
          }}
          aria-label={`Peer field for ${input.label ?? input.key}`}
        >
          <option value="">— not mapped —</option>
          {(catalog ?? []).map((f) => (
            <option key={f.key} value={f.key}>
              {f.label ? `${f.label} — ${f.key}` : f.key}
            </option>
          ))}
        </select>
        {valueMismatch ? (
          <span
            className="hub__conf hub__conf--warn"
            title={`Their example "${example}" isn't one of this plan's ${input.allowed_values!.length} accepted values — the Test step lists them; sending it live would refuse.`}
          >
            <i />
            values differ
          </span>
        ) : confidence ? (
          <span className={`hub__conf hub__conf--${confidence}`}>
            <i />
            {confidence} — confirm
          </span>
        ) : value ? (
          <span className="hub__conf">
            <i />
            mapped
          </span>
        ) : (
          <span className="hub__conf hub__conf--gap">
            <i />
            {input.required ? "required" : "optional"}
          </span>
        )}
      </div>
    );
  };

  return (
    <section>
      <h2 className="hub__h2">Map their fields to your inputs</h2>
      <p className="hub__lead">
        The peer's catalog was synced at pairing — every dropdown speaks
        their labels. Nothing is sent that isn't mapped.
      </p>
      <PlanTabs
        plans={plans}
        selected={selected}
        onSelect={setSelected}
        meter={(p) => `${p.consumed_required - p.consumed_missing}/${p.consumed_required}`}
      />
      {plan && inputs !== null && (
        <>
          <div className="hub__meter">
            <span className="hub__meter-n">
              Required inputs mapped — {coveredRequired} of {required.length}
              {optional.length > 0 && <small> · {optional.length} optional</small>}
            </span>
            <span className="hub__meter-bar">
              <i
                className={coveredRequired === required.length ? "hub__meter-fill--ok" : ""}
                style={{
                  width: `${required.length ? Math.round((coveredRequired / required.length) * 100) : 100}%`,
                }}
              />
            </span>
            <Button variant="ghost" onClick={runAutoMatch} disabled={!catalog}>
              Auto-match
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save mapping"}
            </Button>
          </div>
          <div className="hub__card">
            {inputs.length === 0 && (
              <div className="hub__row hub__row--empty">
                {plan.published
                  ? "The published plan declares no form inputs."
                  : "This plan has no published version — publish it first."}
              </div>
            )}
            {[...required, ...optional].map(row)}
          </div>
          <p className="hub__fence">
            An unmapped required input blocks this plan's go-live — never the
            whole integration. A “values differ” chip means their example
            value isn't one the plan accepts — the Test step lists the
            accepted values so you can see both vocabularies side by side.
          </p>
        </>
      )}
    </section>
  );
}

/** A refusal re-said for the operator (Brief 77 §1 / §4.2 rule 2 at the
 *  Hub layer): every item names a FIELD by its label and says what to do
 *  next; the engine's own grammar survives only behind the technical
 *  disclosure. */
interface RefusalView {
  items: Array<{ label: string; hint: string }>;
  technical: string[];
  needsMapping: boolean;
}

const MISSING_MARK = /^∅$|\(input missing\)/;

function humanizeRefusal(
  result: TestQuoteResult,
  inputs: readonly ConsumedInput[],
  catalog: readonly CatalogField[],
  sentFacts: Record<string, unknown>,
): RefusalView {
  const byPlanKey = new Map(inputs.map((c) => [c.key, c]));
  const peerLabel = (key: string): string =>
    catalog.find((f) => f.key === key)?.label ?? key;
  // weight: a stronger hint (a value the plan rejected) may replace a
  // weaker one ("wasn't answered"), never the other way around.
  const items = new Map<string, { label: string; hint: string; weight: number }>();
  const technical: string[] = [];
  let needsMapping = false;

  const formLabel = (input: ConsumedInput): string =>
    input.mapped_from ? peerLabel(input.mapped_from) : (input.label ?? input.key);
  const put = (key: string, label: string, hint: string, weight: number) => {
    const prev = items.get(key);
    if (!prev || weight > prev.weight) items.set(key, { label, hint, weight });
  };
  const answered = (input: ConsumedInput | undefined): boolean =>
    !!input?.mapped_from &&
    sentFacts[input.mapped_from] !== undefined &&
    sentFacts[input.mapped_from] !== "";
  const unanswered = (planKey: string) => {
    const input = byPlanKey.get(planKey);
    if (!input) return; // a derived dimension — cascade noise, not actionable
    if (answered(input)) return; // it WAS answered; the cause is upstream
    if (!input.mapped_from) {
      needsMapping = true;
      put(planKey, input.label ?? planKey, "isn't mapped to any of their fields yet — map it, then re-run.", 1);
    } else {
      put(planKey, formLabel(input), "wasn't answered — fill it in the form above.", 1);
    }
  };

  // Everything dedupes on the PLAN key — the composer names gaps in peer
  // vocabulary, the engine in plan vocabulary; one field, one line.
  const planKeyForPeer = (peerKey: string): string =>
    inputs.find((c) => c.mapped_from === peerKey)?.key ?? `peer:${peerKey}`;

  const gaps = result.input_issues ?? {};
  for (const key of gaps["missing"] ?? []) {
    put(planKeyForPeer(key), peerLabel(key), "wasn't answered — fill it in the form above.", 1);
  }
  for (const key of gaps["unknown"] ?? []) {
    put(
      planKeyForPeer(key),
      peerLabel(key),
      "is mapped, but this version's rating never reads it — safe to leave blank.",
      1,
    );
  }
  for (const key of gaps["unmapped_plan_inputs"] ?? []) {
    if (!byPlanKey.has(key)) continue; // derived — nothing to map
    needsMapping = true;
    put(key, byPlanKey.get(key)!.label ?? key, "isn't mapped to any of their fields yet — map it, then re-run.", 1);
  }

  for (const issue of result.row_issues ?? []) {
    if (typeof issue.message === "string") technical.push(issue.message);
    const detail =
      issue.detail && typeof issue.detail === "object"
        ? (issue.detail as RowIssueDetail)
        : null;
    if (!detail?.field) continue;
    const fieldParts = detail.field.split(", ");
    const keyParts = (detail.key ?? "").split("::");

    if (issue.code === "territory_unmapped") {
      const input = byPlanKey.get(detail.field);
      if (input) {
        put(
          detail.field,
          formLabel(input),
          `got “${detail.key}”, which is outside this plan's territory — try one it covers.`,
          2,
        );
      }
      continue;
    }
    if (issue.code === "class_attribute_missing") {
      // detail.table reads "class_code → liab_class_group": the SOURCE
      // input is the actionable one; the derived side is noise.
      const source = (detail.table ?? "").split("→")[0]?.trim();
      const input = source ? byPlanKey.get(source) : undefined;
      if (input) {
        put(
          source!,
          formLabel(input),
          `got “${detail.key}”, which isn't a class this plan's registry knows — check the class code.`,
          2,
        );
      }
      continue;
    }
    if (issue.code === "missing_input") {
      for (const part of fieldParts) unanswered(part);
      continue;
    }
    if (issue.code !== "unknown_key") continue;
    if (fieldParts.length > 1) {
      // A multi-dimension lookup: the ∅ parts of the key align with the
      // field parts — only those are actionable here.
      fieldParts.forEach((part, i) => {
        const sent = keyParts[i] ?? "";
        if (!sent || MISSING_MARK.test(sent)) unanswered(part);
      });
      continue;
    }
    const input = byPlanKey.get(detail.field);
    const sent = detail.key ?? "";
    if (!sent || MISSING_MARK.test(sent)) {
      unanswered(detail.field);
    } else if (input) {
      const n = input.allowed_values?.length ?? 0;
      put(
        detail.field,
        formLabel(input),
        `got “${sent}”, which isn't a value this plan accepts` +
          (n > 0
            ? ` — pick one of its ${n} listed values in the form.`
            : " — check the value."),
        2,
      );
    }
  }

  return {
    items: [...items.values()].map(({ label, hint }) => ({ label, hint })),
    technical,
    needsMapping,
  };
}

function TestPane({
  integrationId,
  plans,
  catalog,
  values,
  setValues,
  onGoToMap,
  onChanged,
  onError,
}: {
  integrationId: string;
  plans: ExposedPlan[];
  catalog: CatalogField[] | null;
  values: Record<string, Record<string, string>>;
  setValues: Dispatch<SetStateAction<Record<string, Record<string, string>>>>;
  onGoToMap: () => void;
  onChanged: () => void;
  onError: (message: string | null) => void;
}): JSX.Element {
  const [selected, setSelected] = useState<string | null>(plans[0]?.exposed_id ?? null);
  const [inputs, setInputs] = useState<ConsumedInput[] | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestQuoteResult | null>(null);
  const [lastFacts, setLastFacts] = useState<Record<string, unknown>>({});
  const plan = plans.find((p) => p.exposed_id === selected) ?? null;
  const held = selected ? values[selected] : undefined;
  const byPeerKey = useMemo(
    () => new Map((catalog ?? []).map((f) => [f.key, f])),
    [catalog],
  );

  useEffect(() => {
    if (!selected) return;
    setInputs(null);
    setResult(null);
    getConsumedInputs(integrationId, selected)
      .then((data) => {
        setInputs(data);
        // Pre-fill REAL values from the catalog's examples — normalized
        // to what the wire accepts, never display formatting, and never
        // a value the plan would refuse. Typed values held at the route
        // survive step navigation; only first entry seeds.
        setValues((all) => {
          if (all[selected]) return all;
          const seeded: Record<string, string> = {};
          for (const c of data) {
            if (!c.mapped_from) continue;
            const v = exampleValueFor(c, byPeerKey.get(c.mapped_from));
            if (v !== null) seeded[c.key] = v;
          }
          return { ...all, [selected]: seeded };
        });
      })
      .catch((e: Error) => onError(e.message));
  }, [integrationId, selected, onError, setValues, byPeerKey]);

  const fields = (inputs ?? []).filter((c) => c.mapped_from);
  const setField = (key: string, value: string) => {
    if (!selected) return;
    setValues((all) => ({
      ...all,
      [selected]: { ...(all[selected] ?? {}), [key]: value },
    }));
  };

  const run = async () => {
    if (!plan || running) return;
    setRunning(true);
    setResult(null);
    try {
      const facts: Record<string, unknown> = {};
      for (const c of fields) {
        const raw = held?.[c.key];
        if (raw === undefined || raw === "") continue;
        facts[c.mapped_from!] =
          c.dtype === "number" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
      }
      setLastFacts(facts);
      const member = await runTestQuote(integrationId, plan.exposed_id, facts);
      setResult(member);
      onError(null);
      if (member.row_status === "ok") onChanged(); // the receipt stamped
    } catch (e) {
      onError(e instanceof Error ? e.message : "Test failed.");
    } finally {
      setRunning(false);
    }
  };

  const refusal =
    result && result.row_status !== "ok"
      ? humanizeRefusal(result, inputs ?? [], catalog ?? [], lastFacts)
      : null;

  return (
    <section>
      <h2 className="hub__h2">Prove it end to end</h2>
      <p className="hub__lead">
        A sample risk in the peer's own fields, answered by the same path
        their quotes run. Nothing is persisted — a green result stamps this
        plan's receipt, and Live opens.
      </p>
      <PlanTabs
        plans={plans}
        selected={selected}
        onSelect={setSelected}
        meter={(p) => (p.last_test_at ? "✓" : "—")}
      />
      {plan && inputs !== null && (
        <>
          <div className="hub__card">
            {fields.length === 0 && (
              <div className="hub__row hub__row--empty">
                Map this plan's inputs first — the form builds itself from the
                mapping.
              </div>
            )}
            {fields.map((c) => {
              const peer = byPeerKey.get(c.mapped_from!);
              const value = held?.[c.key] ?? "";
              const picker = (c.allowed_values?.length ?? 0) > 0;
              const isBool =
                !picker && (c.dtype === "bool" || c.dtype === "boolean");
              return (
                <div className="hub__row" key={c.key}>
                  <span className="hub__row-id">
                    <span className="hub__row-name">
                      {peer?.label ?? c.mapped_from}
                    </span>
                    <span className="hub__row-sub">
                      <code>{c.mapped_from}</code>
                      {c.required ? " · required" : " · optional"}
                      {picker ? " · pick a plan value" : ""}
                    </span>
                  </span>
                  {picker ? (
                    <select
                      className="hub__select"
                      value={value}
                      onChange={(e) => setField(c.key, e.target.value)}
                      aria-label={peer?.label ?? c.mapped_from ?? c.key}
                    >
                      <option value="">— choose —</option>
                      {c.allowed_values!.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label ? `${a.label} — ${a.value}` : a.value}
                        </option>
                      ))}
                    </select>
                  ) : isBool ? (
                    <select
                      className="hub__select"
                      value={value}
                      onChange={(e) => setField(c.key, e.target.value)}
                      aria-label={peer?.label ?? c.mapped_from ?? c.key}
                    >
                      <option value="">— choose —</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      className="hub__input"
                      type="text"
                      value={value}
                      onChange={(e) => setField(c.key, e.target.value)}
                      aria-label={peer?.label ?? c.mapped_from ?? c.key}
                    />
                  )}
                </div>
              );
            })}
            {fields.length > 0 && (
              <div className="hub__row hub__row--form">
                <span className="hub__row-sub">
                  {plan.last_test_at
                    ? `Last green test: ${day(plan.last_test_at)}${
                        plan.last_test_premium_cents !== null
                          ? ` · $${(plan.last_test_premium_cents / 100).toLocaleString()}`
                          : ""
                      }${plan.last_test_version_name ? ` · ${plan.last_test_version_name}` : ""}`
                    : "No green test yet — Live stays closed until one lands."}
                </span>
                <span className="hub__spacer" />
                <Button variant="primary" onClick={() => void run()} disabled={running}>
                  {running ? "Rating…" : "Run the test"}
                </Button>
              </div>
            )}
          </div>
          {result && (
            <div className="hub__card hub__card--pad" aria-live="polite">
              {result.row_status === "ok" && result.premium !== null ? (
                <div className="hub__test-ok">
                  <span className="hub__test-prem">
                    $
                    {result.premium.toLocaleString(undefined, {
                      minimumFractionDigits: result.premium % 1 ? 2 : 0,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="hub__row-sub">
                    {plan.last_test_version_name ?? "current version"}
                    {result.valid_until ? ` · quotable through ${result.valid_until}` : ""}
                    {" · green — receipt stamped"}
                  </span>
                </div>
              ) : (
                refusal && (
                  <div className="hub__refusal">
                    <span className="hub__test-refer">
                      The plan refused this test — here's why
                    </span>
                    {refusal.items.length > 0 ? (
                      <ul className="hub__refusal-list">
                        {refusal.items.map((item) => (
                          <li key={item.label}>
                            <b>{item.label}</b> {item.hint}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="hub__row-sub hub__refusal-sub">
                        {refusal.technical[0] ?? "No premium came back — see the technical detail."}
                      </span>
                    )}
                    {refusal.needsMapping && (
                      <Button variant="ghost" onClick={onGoToMap}>
                        Fix it in Map
                      </Button>
                    )}
                    {refusal.technical.length > 0 && refusal.items.length > 0 && (
                      <details className="hub__refusal-tech">
                        <summary>Technical detail</summary>
                        <ul>
                          {refusal.technical.map((t, i) => (
                            <li key={i}>
                              <code>{t}</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </>
      )}
      <p className="hub__fence">
        <Link to="/integrations">Back to Integrations</Link>
      </p>
    </section>
  );
}
