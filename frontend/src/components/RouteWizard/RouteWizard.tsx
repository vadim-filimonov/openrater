/**
 * <RouteWizard> — create a Route (Brief 48), no code, in three steps:
 *   1. Connection — pick a reusable connection (or set one up manually/advanced)
 *   2. Inputs     — drag the plan's input variables onto the connection's params
 *                   (gated: no plan inputs → can't continue)
 *   3. Outputs    — run a real sample call, then choose which outputs push back
 *                   to which plan inputs
 *
 * Plan-agnostic: the input variables come from the plan's own INPUT nodes. Drag
 * uses the house native-HTML5 pattern; a per-param dropdown is the always-works
 * fallback.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Drawer } from "@openrater/design-system";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  FlaskConical,
  GripVertical,
  Loader2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { matchConfidence } from "@openrater/ui";
import { hasPlausiblePlanInput } from "./planInputMatch";
import {
  ApiLabError,
  createRoute,
  invokeConnector,
  type ConnectorInfo,
  type InvokeResponse,
  type PlanInputDef,
  type RouteBinding,
  type RoutePush,
} from "../../api/connectors";
import "./RouteWizard.css";

const MIME = "application/x-rater-route-input";
const STEPS = ["Connection", "Inputs", "Outputs"] as const;

export interface RouteWizardProps {
  open: boolean;
  planId: string;
  planInputs: readonly PlanInputDef[];
  connections: readonly ConnectorInfo[];
  onClose: () => void;
  onCreated: () => void;
  onAddConnection: () => void;
}

export function RouteWizard({
  open,
  planId,
  planInputs,
  connections,
  onClose,
  onCreated,
  onAddConnection,
}: RouteWizardProps): JSX.Element | null {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [testResult, setTestResult] = useState<InvokeResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [pushes, setPushes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setName("");
    setConnectionId(null);
    setBindings({});
    setSampleValues({});
    setTestResult(null);
    setTestError(null);
    setPushes({});
    setError(null);
  }, [open]);

  const connection = useMemo(
    () => connections.find((c) => c.connector_id === connectionId) ?? null,
    [connections, connectionId],
  );

  const requiredParams = connection?.inputs.filter((p) => p.required) ?? [];
  const allRequiredBound = requiredParams.every((p) => bindings[p.name]);
  const hasPlanInputs = planInputs.length > 0;

  function bind(param: string, key: string): void {
    setBindings((b) => {
      const next = { ...b };
      if (key) next[param] = key;
      else delete next[param];
      return next;
    });
  }

  async function runSample(): Promise<void> {
    if (!connection || running) return;
    setRunning(true);
    setTestError(null);
    setTestResult(null);
    try {
      const paramValues: Record<string, unknown> = {};
      for (const p of connection.inputs) {
        const boundKey = bindings[p.name];
        const v = sampleValues[p.name] ?? (boundKey ? "" : p.default ?? "");
        if (v.trim() !== "") paramValues[p.name] = v;
      }
      setTestResult(await invokeConnector(connection.connector_id, paramValues));
    } catch (e) {
      setTestError(e instanceof ApiLabError ? e.message : "Couldn't run the sample call.");
    } finally {
      setRunning(false);
    }
  }

  async function create(): Promise<void> {
    if (!connection || saving) return;
    setSaving(true);
    setError(null);
    try {
      const bindingList: RouteBinding[] = Object.entries(bindings).map(([param_name, plan_input_key]) => ({
        param_name,
        plan_input_key,
      }));
      const pushList: RoutePush[] = Object.entries(pushes)
        .filter(([, key]) => key)
        .map(([output_port, plan_input_key]) => ({ output_port, plan_input_key }));
      await createRoute(planId, {
        connection_id: connection.connector_id,
        name: name.trim() || connection.display_name,
        bindings: bindingList,
        pushes: pushList,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof ApiLabError ? e.message : "Couldn't create the route.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const inputLabel = (key: string): string =>
    planInputs.find((i) => i.key === key)?.label || key;

  return (
    <Drawer open={open} onClose={onClose} title="New route" subtitle="Plan inputs → a connection → push outputs back" size="xl">
      <Drawer.Body>
        <div className="rtw__steps">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              className={"rtw__step" + (step === i ? " rtw__step--on" : i < step ? " rtw__step--done" : "")}
              onClick={() => setStep(i)}
            >
              <span className="rtw__num">{i < step ? "✓" : i + 1}</span>
              {label}
            </button>
          ))}
        </div>

        {step === 0 ? (
          <div className="rtw__sec">
            <label className="rtw__field">
              <span className="rtw__label">Route name</span>
              <input
                className="rtw__input"
                value={name}
                placeholder="Wildfire & flood score"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="rtw__subhead">Choose a connection</div>
            <div className="rtw__cards">
              {connections.map((c) => (
                <button
                  key={c.connector_id}
                  type="button"
                  className={"rtw__card" + (c.connector_id === connectionId ? " rtw__card--sel" : "")}
                  onClick={() => setConnectionId(c.connector_id)}
                >
                  <span className="rtw__card-nm">{c.display_name}</span>
                  <span className="rtw__card-ds">
                    {c.vendor} · {c.inputs.length} params → {c.outputs.length} outputs
                  </span>
                  <span className={"rtw__card-key" + (c.configured ? "" : " rtw__card-key--off")}>
                    {c.configured ? "● key set" : "○ no key"}
                  </span>
                </button>
              ))}
              {connections.length === 0 && (
                <div className="rtw__muted">No connections yet — set one up below.</div>
              )}
            </div>
            <button type="button" className="rtw__adv" onClick={onAddConnection}>
              ⚙ Not in the library? Set up a connection manually (advanced)
            </button>
          </div>
        ) : step === 1 ? (
          <div className="rtw__sec">
            {!hasPlanInputs ? (
              <div className="rtw__gate">
                <CircleAlert size={18} />
                <span>
                  This plan has no inputs defined yet —{" "}
                  <Link
                    className="rtw__nudge-link"
                    to={`/rate-lab/${planId}/workspace/inputs`}
                    onClick={onClose}
                  >
                    declare input variables on the Inputs tab
                    <ArrowRight size={11} aria-hidden />
                  </Link>{" "}
                  first. A route can&rsquo;t run without them.
                </span>
              </div>
            ) : !connection ? (
              <div className="rtw__muted">Pick a connection first.</div>
            ) : (
              <>
                <div className="rtw__hint">
                  Drag a plan input onto a parameter — or use its dropdown. Required params must be bound.
                </div>
                <div className="rtw__dd">
                  <div className="rtw__col">
                    <div className="rtw__subhead">Your plan's inputs</div>
                    {planInputs.map((inp) => (
                      <div
                        key={inp.key}
                        className="rtw__var"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(MIME, inp.key);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                      >
                        <GripVertical size={13} className="rtw__grip" />
                        <span className="rtw__var-nm">{inp.label || inp.key}</span>
                        <span className="rtw__var-ty">{inp.data_type}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rtw__col">
                    <div className="rtw__subhead">{connection.display_name} — parameters</div>
                    {connection.inputs.map((p) => {
                      const bound = bindings[p.name] ?? "";
                      // Nudge when there's no declared plan input that could
                      // plausibly satisfy this param — the pilot dead-end (a
                      // connector wanting `address` on a plan with none).
                      const needsInput =
                        !bound && !hasPlausiblePlanInput(p.name, planInputs);
                      return (
                        <div key={p.name} className="rtw__slot-cell">
                          <div
                            className={
                              "rtw__slot" +
                              (bound ? " rtw__slot--filled" : "") +
                              (needsInput ? " rtw__slot--nudge" : "")
                            }
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "copy";
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const key = e.dataTransfer.getData(MIME);
                              if (key) bind(p.name, key);
                            }}
                          >
                            <span className="rtw__pn">
                              {p.name}
                              {p.required && <em className="rtw__req">required</em>}
                            </span>
                            <ArrowRight size={12} className="rtw__ar" />
                            <select
                              className="rtw__select"
                              value={bound}
                              onChange={(e) => bind(p.name, e.target.value)}
                            >
                              <option value="">— bind a plan input —</option>
                              {planInputs.map((i) => (
                                <option key={i.key} value={i.key}>
                                  {i.label || i.key}
                                </option>
                              ))}
                            </select>
                          </div>
                          {needsInput && (
                            <p className="rtw__nudge" role="note">
                              <TriangleAlert size={12} aria-hidden />
                              <span>
                                No <code>{p.name}</code> input on this plan yet —{" "}
                                <Link
                                  className="rtw__nudge-link"
                                  to={`/rate-lab/${planId}/workspace/inputs`}
                                  onClick={onClose}
                                >
                                  declare one on the Inputs tab
                                  <ArrowRight size={11} aria-hidden />
                                </Link>
                              </span>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="rtw__sec">
            {!connection ? (
              <div className="rtw__muted">Pick a connection first.</div>
            ) : (
              <>
                <div className="rtw__subhead">Sample values</div>
                <div className="rtw__samples">
                  {Object.keys(bindings).length === 0 && (
                    <div className="rtw__muted">No inputs bound — go back to Step 2.</div>
                  )}
                  {connection.inputs
                    .filter((p) => bindings[p.name])
                    .map((p) => (
                      <label key={p.name} className="rtw__sample-row">
                        <span className="rtw__pn">{p.name}</span>
                        <span className="rtw__from">← {inputLabel(bindings[p.name] ?? "")}</span>
                        <input
                          className="rtw__input rtw__input--sm"
                          value={sampleValues[p.name] ?? ""}
                          placeholder={p.example ?? "sample value"}
                          onChange={(e) => setSampleValues((s) => ({ ...s, [p.name]: e.target.value }))}
                        />
                      </label>
                    ))}
                </div>
                <button
                  type="button"
                  className="rtw__btn rtw__btn--ghost"
                  onClick={() => void runSample()}
                  disabled={running}
                >
                  {running ? <Loader2 size={14} className="rtw__spin" /> : <FlaskConical size={14} />}
                  {running ? "Testing…" : "Test the call"}
                </button>
                {/* E10 — the test is preview-only. It returns a value so you can
                    choose which outputs to push, but it does NOT fill the plan's
                    inputs. Filling happens when you Run the saved route. Said
                    plainly here so "it returned a value" never reads as "done". */}
                <p className="rtw__muted rtw__test-note">
                  Preview only — this tests the connection so you can pick which
                  outputs to push. It doesn&rsquo;t fill your inputs. Create the
                  route, then <b>Run</b> it to fill values.
                </p>
                {testError && (
                  <div className="rtw__gate" role="alert">
                    <CircleAlert size={15} /> <span>{testError}</span>
                  </div>
                )}

                <div className="rtw__subhead">Push outputs back to the plan's inputs</div>
                <div className="rtw__pushes">
                  {connection.outputs.map((o) => {
                    const sample = testResult ? testResult.outputs[o.name] : undefined;
                    // Brief 50 — match-confidence review gate. When this output
                    // echoes an input (e.g. matched_name ↔ query), compare what
                    // we searched by against what the API returned, so a
                    // wrong-org match is visible BEFORE the user pushes it.
                    const query =
                      o.echo_of !== undefined ? (sampleValues[o.echo_of] ?? "") : "";
                    const conf =
                      o.echo_of !== undefined && testResult && query.trim() !== ""
                        ? matchConfidence(query, sample == null ? "" : String(sample))
                        : null;
                    const matchedEmpty =
                      sample == null || String(sample).trim() === "";
                    return (
                      <div key={o.name} className="rtw__push-cell">
                        <div className="rtw__push-row">
                          <span className="rtw__on">{o.name}</span>
                          <span className="rtw__sample">{formatVal(sample)}</span>
                          <ArrowRight size={12} className="rtw__ar" />
                          <select
                            className="rtw__select"
                            value={pushes[o.name] ?? ""}
                            onChange={(e) => setPushes((s) => ({ ...s, [o.name]: e.target.value }))}
                          >
                            <option value="">— don't push —</option>
                            {planInputs.map((i) => (
                              <option key={i.key} value={i.key}>
                                {i.label || i.key}
                              </option>
                            ))}
                          </select>
                        </div>
                        {conf && (
                          <div
                            className={`rtw__match rtw__match--${conf.level}`}
                            role="status"
                          >
                            {conf.level === "strong" ? (
                              <CircleCheck size={12} aria-hidden />
                            ) : (
                              <TriangleAlert size={12} aria-hidden />
                            )}
                            <span className="rtw__match-label">
                              {conf.level === "strong"
                                ? "Strong match"
                                : conf.level === "partial"
                                  ? "Review — partial match"
                                  : matchedEmpty
                                    ? "No match found"
                                    : "Likely wrong business — review"}
                            </span>
                            {!matchedEmpty && (
                              <span className="rtw__match-pct">
                                {Math.round(conf.similarity * 100)}%
                              </span>
                            )}
                            <span className="rtw__match-q">· searched “{query}”</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </Drawer.Body>

      <Drawer.Footer>
        <div className="rtw__footer">
          {error && (
            <span className="rtw__footer-err">
              <CircleAlert size={14} /> {error}
            </span>
          )}
          <div className="rtw__footer-actions">
            <button type="button" className="rtw__btn rtw__btn--ghost" onClick={onClose}>
              Cancel
            </button>
            {step < 2 ? (
              <button
                type="button"
                className="rtw__btn rtw__btn--primary"
                disabled={(step === 0 && !connectionId) || (step === 1 && (!hasPlanInputs || !allRequiredBound))}
                onClick={() => setStep((s) => s + 1)}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="rtw__btn rtw__btn--primary"
                onClick={() => void create()}
                disabled={saving}
              >
                {saving ? <Loader2 size={14} className="rtw__spin" /> : <Sparkles size={14} />}
                Create route
              </button>
            )}
          </div>
        </div>
      </Drawer.Footer>
    </Drawer>
  );
}

function formatVal(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
