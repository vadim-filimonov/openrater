/**
 * /api-lab — API Lab: Connections & Routes (Brief 48).
 *
 * Plan-scoped, plan-agnostic. Pick a plan, then:
 *   · Routes      — wire the plan's OWN input variables into a Connection and
 *                   push chosen outputs back onto the plan's Inputs. Run a route
 *                   to fill values (with provenance).
 *   · Connections — a reusable library of APIs + credentials (add via the library
 *                   or the advanced studio).
 * No product schema is baked in — a plan's input variables come from its Building /
 * Inputs section (the same `deriveRequiredInputs` union the Inputs workspace shows).
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useDimensionsList,
  useFactorTablesList,
  usePlanDetail,
  usePlansList,
} from "@openrater/hooks";
import { deriveRequiredInputs } from "@openrater/ui";
import {
  CircleAlert,
  CircleCheck,
  Copy,
  Database,
  Loader2,
  Pencil,
  Play,
  Plug,
  Plus,
  Trash2,
} from "lucide-react";
import {
  ApiLabError,
  applyRoute,
  deleteConnector,
  deleteRoute,
  listConnectors,
  listInputValues,
  listRoutes,
  type ConnectorInfo,
  type PlanInputDef,
  type PlanInputValue,
  type Route,
} from "../api/connectors";
import { ConnectorStudio } from "../components/ConnectorStudio/ConnectorStudio";
import { RouteWizard } from "../components/RouteWizard/RouteWizard";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import "./ApiLabRoute.css";

interface PlanRow {
  readonly rating_plan_id: string;
  readonly display_name: string;
  readonly line_of_business?: string;
}

export function ApiLabRoute(): JSX.Element {
  useDocumentTitle("API Lab");
  const plansQuery = usePlansList({ status: "all" });
  const plans = (plansQuery.data ?? []) as readonly PlanRow[];

  // E09 — a provenance chip on the plan's Inputs workspace deep-links here with
  // `?plan=<id>` so this surface opens on the right plan (D1: plan-scoped jump).
  const [searchParams] = useSearchParams();
  const [planId, setPlanId] = useState<string | null>(
    searchParams.get("plan"),
  );
  const [connections, setConnections] = useState<readonly ConnectorInfo[]>([]);
  const [routes, setRoutes] = useState<readonly Route[]>([]);
  const [inputValues, setInputValues] = useState<readonly PlanInputValue[]>([]);

  // A plan's input variables come from its Building/Inputs section — the SAME
  // `deriveRequiredInputs` union the Inputs workspace shows (input_node stages +
  // chain dim-refs + chain base/exposure/lcm + flat-factor paths + factor-table
  // keys + the dimension catalog). Plan-agnostic; works for any product.
  const planDetail = usePlanDetail(planId ?? undefined);
  const dimensionsList = useDimensionsList(planId ?? undefined);
  const factorTablesList = useFactorTablesList(planId ?? undefined);
  const planInputs: readonly PlanInputDef[] = useMemo(() => {
    const stages = planDetail.data?.stages ?? [];
    const dims = dimensionsList.data?.dimensions ?? [];
    // The deriver's FactorTableLike keys on `id`; the list API returns `table_id`.
    const factorTables = (factorTablesList.data?.factor_tables ?? []).map((t) => ({
      ...t,
      id: t.table_id,
    }));
    const derived = deriveRequiredInputs(
      stages,
      dims as unknown as Parameters<typeof deriveRequiredInputs>[1],
      { factorTables },
    );
    return derived.map((d) => ({
      key: d.id,
      label: d.name,
      data_type: d.dtype === "date" ? "string" : d.dtype,
      required: false,
      description: d.origin,
    }));
  }, [planDetail.data, dimensionsList.data, factorTablesList.data]);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioEditId, setStudioEditId] = useState<string | null>(null);
  const [studioPrefillFrom, setStudioPrefillFrom] = useState<string | null>(null);
  // E06 — whether the server can store in-product API keys (for the studio).
  const [vaultAvailable, setVaultAvailable] = useState(false);

  const [runId, setRunId] = useState<string | null>(null);
  const [runValues, setRunValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  // E10 — after a "Run & push back" succeeds, surface an inline "filled k of N"
  // delta on the route card so the write is unmistakable (the wizard's preview
  // explicitly does NOT fill; only this action does).
  const [runResult, setRunResult] = useState<{
    readonly routeId: string;
    readonly filled: number;
  } | null>(null);

  // default-select the first plan once plans load
  useEffect(() => {
    if (planId === null && plans.length > 0) setPlanId(plans[0]!.rating_plan_id);
  }, [plans, planId]);

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (planId) loadPlanData(planId);
  }, [planId]);

  function loadConnections(): void {
    listConnectors()
      .then((r) => {
        setConnections(r.connectors);
        setVaultAvailable(r.vault_available);
      })
      .catch(() => setConnections([]));
  }

  function loadPlanData(id: string): void {
    listRoutes(id)
      .then((r) => setRoutes(r.routes))
      .catch(() => setRoutes([]));
    listInputValues(id)
      .then((r) => setInputValues(r.values))
      .catch(() => setInputValues([]));
  }

  function openNewConnection(): void {
    setStudioEditId(null);
    setStudioPrefillFrom(null);
    setStudioOpen(true);
  }

  async function removeRoute(id: string): Promise<void> {
    if (!planId) return;
    if (!window.confirm("Delete this route?")) return;
    await deleteRoute(planId, id).catch(() => undefined);
    loadPlanData(planId);
  }

  function startRun(route: Route): void {
    setRunId(route.route_id);
    setRunError(null);
    setRunResult(null);
    const seed: Record<string, string> = {};
    for (const b of route.bindings) seed[b.plan_input_key] = runValues[b.plan_input_key] ?? "";
    setRunValues(seed);
  }

  async function doRun(route: Route): Promise<void> {
    if (!planId || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(runValues)) if (v.trim() !== "") values[k] = v;
      const res = await applyRoute(planId, route.route_id, { values, persist: true });
      if (!res.ok) {
        setRunError(res.error ?? "The route call failed.");
      } else {
        // E10 — count pushes that resolved to a real (finite/non-empty) value;
        // that's how many plan inputs this run actually filled.
        const filled = res.resolved.filter(
          (r) => r.value !== null && String(r.value).trim() !== "",
        ).length;
        setRunResult({ routeId: route.route_id, filled });
        setRunId(null);
        loadPlanData(planId);
      }
    } catch (e) {
      setRunError(e instanceof ApiLabError ? e.message : "Couldn't run the route.");
    } finally {
      setRunning(false);
    }
  }

  const valueByKey = useMemo(() => {
    const m = new Map<string, PlanInputValue>();
    for (const v of inputValues) m.set(v.input_key, v);
    return m;
  }, [inputValues]);

  const connById = useMemo(() => {
    const m = new Map<string, ConnectorInfo>();
    for (const c of connections) m.set(c.connector_id, c);
    return m;
  }, [connections]);

  const filledCount = planInputs.filter((i) => valueByKey.has(i.key)).length;

  return (
    <div className="apilab">
      <header className="apilab__header">
        <div>
          <h1 className="apilab__title">API Lab</h1>
          <p className="apilab__subtitle">
            Wire a plan&apos;s own input variables into an external Connection and push the outputs
            back onto its Inputs. Connections fetch facts; the plan interprets them. No product schema
            baked in.
          </p>
        </div>
        <label className="apilab__plan-pick">
          <Database size={13} />
          <select
            className="apilab__plan-select"
            value={planId ?? ""}
            onChange={(e) => setPlanId(e.target.value || null)}
          >
            <option value="">Select a plan…</option>
            {plans.map((p) => (
              <option key={p.rating_plan_id} value={p.rating_plan_id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {!planId ? (
        <section className="apilab__card apilab__empty-card">
          <Database size={20} />
          <span>Pick a plan to manage its routes and see its inputs.</span>
        </section>
      ) : (
        <>
          {/* 1 — routes */}
          <section className="apilab__card">
            <div className="apilab__sec-head">
              <span className="apilab__sec-num">1</span> Routes
              <span className="apilab__sec-meta">{routes.length} for this plan</span>
              <button
                className="apilab__btn apilab__btn--primary apilab__head-btn"
                onClick={() => setWizardOpen(true)}
              >
                <Plus size={14} /> New route
              </button>
            </div>

            {routes.length === 0 ? (
              <p className="apilab__hint">
                No routes yet. A route binds this plan&apos;s inputs to a connection and pushes outputs
                back. Click <b>New route</b>.
              </p>
            ) : (
              <ul className="apilab__routes">
                {routes.map((rt) => {
                  const conn = connById.get(rt.connection_id);
                  return (
                    <li key={rt.route_id} className="apilab__route">
                      <div className="apilab__route-main">
                        <div className="apilab__route-name">{rt.name}</div>
                        <div className="apilab__route-io">
                          <span className="apilab__route-conn">
                            <Plug size={11} /> {conn?.display_name ?? rt.connection_id}
                          </span>
                          <span className="apilab__route-flow">
                            {rt.bindings.map((b) => b.plan_input_key).join(", ") || "—"}
                            {" → "}
                            {rt.pushes.map((p) => p.plan_input_key).join(", ") || "—"}
                          </span>
                        </div>
                      </div>
                      <div className="apilab__route-actions">
                        <button className="apilab__mini" title="Run route" onClick={() => startRun(rt)}>
                          <Play size={12} />
                        </button>
                        <button
                          className="apilab__mini apilab__mini--danger"
                          title="Delete route"
                          onClick={() => void removeRoute(rt.route_id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {runId === rt.route_id && (
                        <div className="apilab__run">
                          <div className="apilab__run-head">Values for this run</div>
                          <div className="apilab__run-fields">
                            {[...new Set(rt.bindings.map((b) => b.plan_input_key))].map((key) => (
                              <label key={key} className="apilab__run-field">
                                <span className="apilab__flabel">{key}</span>
                                <input
                                  className="apilab__input"
                                  value={runValues[key] ?? ""}
                                  onChange={(e) =>
                                    setRunValues((s) => ({ ...s, [key]: e.target.value }))
                                  }
                                />
                              </label>
                            ))}
                          </div>
                          <div className="apilab__run-actions">
                            <button
                              className="apilab__btn apilab__btn--primary"
                              onClick={() => void doRun(rt)}
                              disabled={running}
                            >
                              {running ? (
                                <Loader2 size={13} className="apilab__spin" />
                              ) : (
                                <Play size={13} />
                              )}
                              Run &amp; push back
                            </button>
                            <button
                              className="apilab__btn apilab__btn--ghost"
                              onClick={() => setRunId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                          {runError && (
                            <div className="apilab__banner" role="alert">
                              <CircleAlert size={15} /> <span>{runError}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {/* E10 — inline "it worked" delta (banner-not-toast). Persists
                          on the card the user acted on, naming exactly what was
                          written: k pushes filled, and the new plan-wide count. */}
                      {runResult?.routeId === rt.route_id && (
                        <div className="apilab__filled" role="status">
                          <CircleCheck size={14} />
                          <span>
                            Filled <b>{runResult.filled}</b>{" "}
                            {runResult.filled === 1 ? "input" : "inputs"} ·{" "}
                            {filledCount} of {planInputs.length} now filled.
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 2 — plan inputs (the payoff) */}
          <section className="apilab__card">
            <div className="apilab__sec-head">
              <span className="apilab__sec-num">2</span> Plan inputs
              <span className="apilab__sec-meta">
                {filledCount} of {planInputs.length} filled
              </span>
            </div>
            {planInputs.length === 0 ? (
              <p className="apilab__hint">
                This plan has no input variables yet — define them in the plan&apos;s Building / Inputs
                section, then routes can fill them.
              </p>
            ) : (
              <ul className="apilab__inputs-list">
                {planInputs.map((inp) => {
                  const filled = valueByKey.get(inp.key);
                  return (
                    <li
                      key={inp.key}
                      className={"apilab__irow" + (filled ? " apilab__irow--filled" : "")}
                    >
                      <span className={"apilab__istate" + (filled ? " apilab__istate--ok" : "")}>
                        {filled ? <CircleCheck size={14} /> : <span className="apilab__idot" />}
                      </span>
                      <span className="apilab__ikey">
                        {inp.label || inp.key}
                        {inp.required && <em className="apilab__ireq">required</em>}
                      </span>
                      <span className="apilab__ivalue">
                        {filled ? String(filled.value ?? "—") : "—"}
                      </span>
                      <span className="apilab__isource">{filled?.source ?? ""}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 3 — connections */}
          <section className="apilab__card">
            <div className="apilab__sec-head">
              <span className="apilab__sec-num">3</span> Connections
              <span className="apilab__sec-meta">reusable across routes &amp; plans</span>
            </div>
            <div className="apilab__lib">
              {connections.map((c) => (
                <div key={c.connector_id} className="apilab__lib-item">
                  <div className="apilab__lib-chip">
                    <span className="apilab__lib-icon">
                      <Plug size={13} />
                    </span>
                    <span className="apilab__lib-name">{c.display_name}</span>
                    {c.source === "user" && <span className="apilab__lib-tag">custom</span>}
                    <span
                      className={
                        "apilab__lib-state" +
                        (c.configured ? " apilab__lib-state--ok" : " apilab__lib-state--off")
                      }
                    >
                      {c.configured ? "key set" : "no key"}
                    </span>
                  </div>
                  <div className="apilab__lib-actions">
                    {c.source === "user" ? (
                      <>
                        <button
                          className="apilab__mini"
                          title="Edit connection"
                          onClick={() => {
                            setStudioEditId(c.connector_id);
                            setStudioPrefillFrom(null);
                            setStudioOpen(true);
                          }}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="apilab__mini apilab__mini--danger"
                          title="Delete connection"
                          onClick={() =>
                            void deleteConnector(c.connector_id).then(loadConnections).catch(() => undefined)
                          }
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="apilab__mini"
                        title="Duplicate to customize"
                        onClick={() => {
                          setStudioEditId(null);
                          setStudioPrefillFrom(c.connector_id);
                          setStudioOpen(true);
                        }}
                      >
                        <Copy size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button className="apilab__new-connector" onClick={openNewConnection}>
                <Plus size={13} /> Add connection
              </button>
            </div>
          </section>
        </>
      )}

      {planId && (
        <RouteWizard
          open={wizardOpen}
          planId={planId}
          planInputs={planInputs}
          connections={connections}
          onClose={() => setWizardOpen(false)}
          onCreated={() => loadPlanData(planId)}
          onAddConnection={() => {
            setWizardOpen(false);
            openNewConnection();
          }}
        />
      )}

      <ConnectorStudio
        open={studioOpen}
        editId={studioEditId}
        prefillFrom={studioPrefillFrom}
        existingConnectorIds={connections.map((c) => c.connector_id)}
        vaultAvailable={vaultAvailable}
        secretAlreadySet={
          studioEditId
            ? (connections.find((c) => c.connector_id === studioEditId)?.configured ??
              false)
            : false
        }
        onClose={() => setStudioOpen(false)}
        onSaved={loadConnections}
      />
    </div>
  );
}
