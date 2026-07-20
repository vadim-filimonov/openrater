/**
 * <ConnectorStudio> — the no-code "add any API" authoring studio (Brief 47, Phase B).
 *
 * An actuary defines a new REST connector with zero code, in four steps:
 *   1. Describe   — name, vendor, category, method, endpoint
 *   2. Request    — query params / JSON body with {{variables}} (auto-detected
 *                   into the inputs list) + auth (the env-var NAME, never the key)
 *   3. Test       — fill example values, run a real test call
 *   4. Outputs    — click fields in the response to make output ports
 *
 * Plus an "Edit as JSON" escape hatch for advanced users. The result is a
 * ConnectorManifest the generic engine runs — a form, not a deploy.
 *
 * Keys never enter the UI: only the env-var name is captured; the secret stays
 * in the server's .env and is injected at call time.
 */

import { useEffect, useMemo, useState } from "react";
import { Checkbox, Drawer, Switch } from "@openrater/design-system";
import {
  Braces,
  CircleAlert,
  FlaskConical,
  KeyRound,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  ApiLabError,
  createConnector,
  getConnector,
  setConnectorSecret,
  testConnector,
  updateConnector,
  type ConnectorManifest,
  type DataType,
  type HttpMethod,
  type InputParam,
  type OutputPort,
  type TestConnectorResponse,
} from "../../api/connectors";
import { JsonTreePicker } from "./JsonTreePicker";
import { slugify, uniqueConnectorId } from "./connectorId";
import "./ConnectorStudio.css";

export interface ConnectorStudioProps {
  open: boolean;
  /** When set, edit this user-authored connector (PUT). */
  editId: string | null;
  /** When set (and editId null), prefill a new draft from this connector (clone). */
  prefillFrom: string | null;
  /** Existing connector ids (bundled + user) for the auto-derive collision
   *  guard. When the actuary hasn't hand-edited the id, deriving it from the
   *  display name suffixes `-2`, `-3`, … past any of these so a new connector
   *  never 409s `connector_id_reserved` against a bundled id. */
  existingConnectorIds?: readonly string[];
  /** E06 — whether the server can store in-product API keys (RATER_SECRETS_KEY is
   *  set). When false, the key field is disabled with operator guidance. */
  vaultAvailable?: boolean;
  /** E06 — whether an encrypted key is already stored for the connector being
   *  edited (so the field reads "set — type to replace" instead of empty). */
  secretAlreadySet?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "address_geo", label: "Address / geo" },
  { value: "property_peril", label: "Property / peril" },
  { value: "identity", label: "Identity / firmographics" },
  { value: "iso_verisk", label: "ISO / Verisk" },
  { value: "wages", label: "Wages / payroll" },
  { value: "llm", label: "LLM / model" },
  { value: "custom", label: "Custom" },
];

const STEPS = ["Describe", "Request", "Test", "Outputs"] as const;
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

interface QueryRow {
  key: string;
  val: string;
}
interface InputOverride {
  required: boolean;
  example: string;
  default: string;
}

function detectPlaceholders(sources: readonly string[]): string[] {
  const found = new Set<string>();
  for (const s of sources) {
    for (const m of s.matchAll(PLACEHOLDER)) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found];
}

function inferType(value: unknown): DataType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value !== null && typeof value === "object") return "object";
  return "string";
}

export function ConnectorStudio({
  open,
  editId,
  prefillFrom,
  existingConnectorIds = [],
  vaultAvailable,
  secretAlreadySet,
  onClose,
  onSaved,
}: ConnectorStudioProps): JSX.Element | null {
  const [step, setStep] = useState(0);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");

  // Step 1 — describe
  const [displayName, setDisplayName] = useState("");
  const [connectorId, setConnectorId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("custom");
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [endpoint, setEndpoint] = useState("");

  // Step 2 — request + auth
  const [queryRows, setQueryRows] = useState<QueryRow[]>([{ key: "", val: "" }]);
  const [bodyText, setBodyText] = useState("");
  const [authEnabled, setAuthEnabled] = useState(false);
  const [secretEnv, setSecretEnv] = useState("");
  const [secretParam, setSecretParam] = useState("key");
  const [secretIn, setSecretIn] = useState<"query" | "header">("query");
  const [secretPrefix, setSecretPrefix] = useState("");
  // E06 — the actual key the actuary types (write-only; PUT to the vault on save).
  const [secretValue, setSecretValue] = useState("");
  const [overrides, setOverrides] = useState<Record<string, InputOverride>>({});

  // Step 3 — test
  const [testInputs, setTestInputs] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectorResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Step 4 — outputs
  const [outputs, setOutputs] = useState<OutputPort[]>([]);

  // meta
  const [cost, setCost] = useState("0");
  const [docsUrl, setDocsUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function resetBlank(): void {
    setStep(0);
    setJsonMode(false);
    setJsonText("");
    setDisplayName("");
    setConnectorId("");
    setIdEdited(false);
    setVendor("");
    setCategory("custom");
    setMethod("GET");
    setEndpoint("");
    setQueryRows([{ key: "", val: "" }]);
    setBodyText("");
    setAuthEnabled(false);
    setSecretEnv("");
    setSecretParam("key");
    setSecretIn("query");
    setSecretPrefix("");
    setSecretValue("");
    setOverrides({});
    setTestInputs({});
    setTestResult(null);
    setTestError(null);
    setOutputs([]);
    setCost("0");
    setDocsUrl("");
    setSaveError(null);
  }

  function populateFrom(m: ConnectorManifest, clone: boolean): void {
    setStep(0);
    setJsonMode(false);
    setVendor(m.vendor);
    setCategory(m.category);
    setMethod(m.method);
    setEndpoint(m.endpoint);
    setQueryRows(
      Object.keys(m.request_query).length > 0
        ? Object.entries(m.request_query).map(([key, val]) => ({ key, val }))
        : [{ key: "", val: "" }],
    );
    setBodyText(m.request_json ? JSON.stringify(m.request_json, null, 2) : "");
    setAuthEnabled(!!m.secret_param || !!m.secret_env);
    setSecretEnv(m.secret_env ?? "");
    setSecretParam(m.secret_param ?? "key");
    setSecretIn(m.secret_in ?? "query");
    setSecretPrefix(m.secret_prefix ?? "");
    setSecretValue(""); // write-only — never loaded back; blank means "keep existing"
    const nextOverrides: Record<string, InputOverride> = {};
    for (const inp of m.inputs) {
      nextOverrides[inp.name] = {
        required: inp.required,
        example: inp.example ?? "",
        default: inp.default ?? "",
      };
    }
    setOverrides(nextOverrides);
    setOutputs(m.outputs.map((o) => ({ ...o })));
    setCost(String(m.cost_per_call_usd));
    setDocsUrl(m.docs_url ?? "");
    setTestInputs({});
    setTestResult(null);
    setTestError(null);
    setSaveError(null);
    if (clone) {
      const name = `${m.display_name} copy`;
      setDisplayName(name);
      setConnectorId(uniqueConnectorId(slugify(name), existingConnectorIds));
      setIdEdited(false);
    } else {
      setDisplayName(m.display_name);
      setConnectorId(m.connector_id);
      setIdEdited(true);
    }
  }

  // Load on open.
  useEffect(() => {
    if (!open) return;
    const idToLoad = editId ?? prefillFrom;
    if (!idToLoad) {
      resetBlank();
      return;
    }
    getConnector(idToLoad)
      .then((m) => populateFrom(m, editId === null))
      .catch(() => {
        resetBlank();
        setSaveError("Couldn't load that connector to edit.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editId, prefillFrom]);

  // Derived inputs — the {{variables}} found in the request, seeded with overrides.
  const inputs: InputParam[] = useMemo(() => {
    const detected = detectPlaceholders([
      endpoint,
      ...queryRows.map((r) => r.val),
      bodyText,
    ]);
    return detected.map((name): InputParam => {
      const o = overrides[name];
      return {
        name,
        data_type: "string",
        required: o?.required ?? true,
        default: o?.default ? o.default : null,
        example: o?.example ? o.example : null,
        description: "",
      };
    });
  }, [endpoint, queryRows, bodyText, overrides]);

  const inputNamesKey = inputs.map((i) => i.name).join("|");

  // Seed test inputs for any newly-detected variable (keep user edits).
  useEffect(() => {
    setTestInputs((prev) => {
      const next: Record<string, string> = {};
      for (const inp of inputs) {
        next[inp.name] = prev[inp.name] ?? inp.example ?? inp.default ?? "";
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputNamesKey]);

  function buildManifest(): ConnectorManifest {
    const query: Record<string, string> = {};
    for (const row of queryRows) {
      const k = row.key.trim();
      if (k) query[k] = row.val;
    }
    let requestJson: Record<string, unknown> | null = null;
    if (method === "POST" && bodyText.trim() !== "") {
      requestJson = JSON.parse(bodyText) as Record<string, unknown>; // may throw → caught by caller
    }
    return {
      connector_id: connectorId.trim(),
      display_name: displayName.trim(),
      vendor: vendor.trim() || "custom",
      category,
      kind: "rest",
      version: "v1",
      method,
      endpoint: endpoint.trim(),
      secret_env: authEnabled ? secretEnv.trim() || null : null,
      secret_param: authEnabled ? secretParam.trim() || null : null,
      secret_in: secretIn,
      // Prefix is concatenated verbatim onto the key, so a trailing space is
      // intentional ("Bearer "). Don't trim it.
      secret_prefix: authEnabled && secretPrefix !== "" ? secretPrefix : null,
      request_json: requestJson,
      request_query: query,
      inputs,
      outputs,
      cost_per_call_usd: Number(cost) || 0,
      ttl_seconds: 0,
      docs_url: docsUrl.trim() || null,
    };
  }

  function currentManifest(): ConnectorManifest {
    return jsonMode ? (JSON.parse(jsonText) as ConnectorManifest) : buildManifest();
  }

  function setOverride(name: string, patch: Partial<InputOverride>): void {
    setOverrides((prev) => {
      const base = prev[name] ?? { required: true, example: "", default: "" };
      return { ...prev, [name]: { ...base, ...patch } };
    });
  }

  function toggleJsonMode(): void {
    if (!jsonMode) {
      try {
        setJsonText(JSON.stringify(buildManifest(), null, 2));
      } catch {
        setJsonText(JSON.stringify({ error: "Fix the JSON body before switching." }, null, 2));
      }
      setJsonMode(true);
    } else {
      setJsonMode(false);
    }
  }

  async function runTest(): Promise<void> {
    if (testing) return;
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const manifest = currentManifest();
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(testInputs)) if (v.trim() !== "") payload[k] = v;
      const r = await testConnector(manifest, payload, secretValue || undefined);
      setTestResult(r);
      if (!r.ok) setTestError(r.error ?? "The test call failed.");
    } catch (e) {
      setTestError(
        e instanceof ApiLabError
          ? e.message
          : e instanceof SyntaxError
            ? "The request body isn't valid JSON."
            : "Couldn't run the test call.",
      );
    } finally {
      setTesting(false);
    }
  }

  function pickOutput(path: string, value: unknown): void {
    if (outputs.some((o) => o.json_path === path)) return;
    const seg = path.split(".").pop() ?? "field";
    const base = seg.replace(/[^a-zA-Z0-9_]/g, "_") || "field";
    const taken = new Set(outputs.map((o) => o.name));
    let name = base;
    let i = 2;
    while (taken.has(name)) name = `${base}_${i++}`;
    setOutputs([
      ...outputs,
      { name, data_type: inferType(value), json_path: path, description: "" },
    ]);
  }

  function renameOutput(idx: number, name: string): void {
    setOutputs((prev) => prev.map((o, i) => (i === idx ? { ...o, name } : o)));
  }
  function retypeOutput(idx: number, data_type: DataType): void {
    setOutputs((prev) => prev.map((o, i) => (i === idx ? { ...o, data_type } : o)));
  }
  function removeOutput(idx: number): void {
    setOutputs((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const manifest = currentManifest();
      if (!manifest.connector_id) {
        setSaveError("Give the connector an id (it's derived from the name).");
        return;
      }
      if (!manifest.endpoint) {
        setSaveError("An endpoint URL is required.");
        return;
      }
      if (editId) await updateConnector(editId, manifest);
      else await createConnector(manifest);
      // E06 — persist a just-typed key to the encrypted vault (a separate call,
      // so the value never rides in the manifest). Blank ⇒ keep any existing key.
      if (authEnabled && secretValue.trim() !== "") {
        await setConnectorSecret(manifest.connector_id, secretValue);
      }
      onSaved();
      onClose();
    } catch (e) {
      setSaveError(
        e instanceof ApiLabError
          ? e.message
          : e instanceof SyntaxError
            ? "The request body / JSON isn't valid JSON."
            : "Couldn't save the connector.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const pickedPaths = new Set(outputs.map((o) => o.json_path));
  const title = editId ? "Edit connector" : "New connector";
  const subtitle = "Define any API as a connector — no code.";

  return (
    <Drawer open={open} onClose={onClose} title={title} subtitle={subtitle} size="xl">
      <Drawer.Body>
        {/* stepper / json toggle */}
        <div className="cstudio__bar">
          <div className="cstudio__steps" role="tablist">
            {STEPS.map((label, i) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={!jsonMode && step === i}
                className={
                  "cstudio__step" +
                  (!jsonMode && step === i ? " cstudio__step--active" : "") +
                  (jsonMode ? " cstudio__step--muted" : "")
                }
                onClick={() => {
                  setJsonMode(false);
                  setStep(i);
                }}
              >
                <span className="cstudio__step-num">{i + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={"cstudio__json-toggle" + (jsonMode ? " cstudio__json-toggle--on" : "")}
            onClick={toggleJsonMode}
            title="Advanced: edit the raw manifest as JSON"
          >
            <Braces size={13} /> {jsonMode ? "Form" : "Edit as JSON"}
          </button>
        </div>

        {jsonMode ? (
          <div className="cstudio__section">
            <p className="cstudio__hint">
              The raw manifest. Advanced users can edit it directly — it's validated on save.
            </p>
            <textarea
              className="cstudio__code"
              value={jsonText}
              spellCheck={false}
              onChange={(e) => setJsonText(e.target.value)}
              rows={22}
            />
          </div>
        ) : step === 0 ? (
          <div className="cstudio__section">
            <div className="cstudio__grid">
              <label className="cstudio__field">
                <span className="cstudio__label">Display name</span>
                <input
                  className="cstudio__input"
                  value={displayName}
                  placeholder="Acme Hazard Score"
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    // Only auto-derive while the actuary hasn't hand-edited the
                    // id; suffix past any bundled/user id so Create never 409s.
                    if (!idEdited)
                      setConnectorId(
                        uniqueConnectorId(
                          slugify(e.target.value),
                          existingConnectorIds,
                        ),
                      );
                  }}
                />
              </label>
              <label className="cstudio__field">
                <span className="cstudio__label">Connector id</span>
                <input
                  className="cstudio__input cstudio__input--mono"
                  value={connectorId}
                  placeholder="acme-hazard"
                  disabled={editId !== null}
                  onChange={(e) => {
                    setIdEdited(true);
                    setConnectorId(slugify(e.target.value));
                  }}
                />
              </label>
              <label className="cstudio__field">
                <span className="cstudio__label">Vendor</span>
                <input
                  className="cstudio__input"
                  value={vendor}
                  placeholder="acme"
                  onChange={(e) => setVendor(e.target.value)}
                />
              </label>
              <label className="cstudio__field">
                <span className="cstudio__label">Category</span>
                <select
                  className="cstudio__input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cstudio__field">
                <span className="cstudio__label">Cost per call (USD)</span>
                <input
                  className="cstudio__input cstudio__input--mono"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={cost}
                  placeholder="0.00"
                  onChange={(e) => setCost(e.target.value)}
                />
              </label>
              <p className="cstudio__hint cstudio__hint--span">
                Used for the cost estimate when you enrich a book. Leave at{" "}
                <code>0</code> for a free API.
              </p>
            </div>
            <div className="cstudio__method-row">
              <div className="cstudio__seg">
                {(["GET", "POST"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={"cstudio__seg-btn" + (method === m ? " cstudio__seg-btn--on" : "")}
                    onClick={() => setMethod(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <label className="cstudio__field cstudio__field--grow">
                <span className="cstudio__label">Endpoint URL</span>
                <input
                  className="cstudio__input cstudio__input--mono"
                  value={endpoint}
                  placeholder="https://api.acme.com/v1/hazard"
                  spellCheck={false}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </label>
            </div>
            <p className="cstudio__hint">
              Tip: put <code>{"{{variables}}"}</code> anywhere in the URL, query, or body —
              they become this connector's inputs automatically.
            </p>
          </div>
        ) : step === 1 ? (
          <div className="cstudio__section">
            <div className="cstudio__subhead">Query parameters</div>
            <div className="cstudio__rows">
              {queryRows.map((row, i) => (
                <div key={i} className="cstudio__kv">
                  <input
                    className="cstudio__input cstudio__input--mono"
                    value={row.key}
                    placeholder="zip"
                    onChange={(e) =>
                      setQueryRows((prev) =>
                        prev.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)),
                      )
                    }
                  />
                  <span className="cstudio__kv-eq">=</span>
                  <input
                    className="cstudio__input cstudio__input--mono"
                    value={row.val}
                    placeholder="{{zip}}"
                    spellCheck={false}
                    onChange={(e) =>
                      setQueryRows((prev) =>
                        prev.map((r, j) => (j === i ? { ...r, val: e.target.value } : r)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="cstudio__icon-btn"
                    aria-label="Remove parameter"
                    onClick={() =>
                      setQueryRows((prev) =>
                        prev.length > 1 ? prev.filter((_, j) => j !== i) : [{ key: "", val: "" }],
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="cstudio__add"
                onClick={() => setQueryRows((prev) => [...prev, { key: "", val: "" }])}
              >
                <Plus size={13} /> Add parameter
              </button>
            </div>

            {method === "POST" && (
              <>
                <div className="cstudio__subhead">Request body (JSON)</div>
                <textarea
                  className="cstudio__code"
                  value={bodyText}
                  spellCheck={false}
                  placeholder={'{\n  "address": "{{address}}"\n}'}
                  rows={7}
                  onChange={(e) => setBodyText(e.target.value)}
                />
              </>
            )}

            <div className="cstudio__subhead">
              <KeyRound size={13} /> Authentication
            </div>
            <Switch
              className="cstudio__check"
              size="sm"
              checked={authEnabled}
              onChange={setAuthEnabled}
              label="This API needs a key"
            />
            {authEnabled && (
              <div className="cstudio__grid">
                {/* E06 — the actual key, encrypted at rest in the server vault.
                    No more ".env edit + restart": the actuary pastes it here. */}
                <label className="cstudio__field cstudio__field--grow">
                  <span className="cstudio__label">API key</span>
                  <input
                    type="password"
                    className="cstudio__input cstudio__input--mono"
                    value={secretValue}
                    placeholder={
                      vaultAvailable === false
                        ? "Server key vault not configured"
                        : secretAlreadySet
                          ? "•••••••••• — set; type to replace"
                          : "Paste the API key"
                    }
                    autoComplete="off"
                    spellCheck={false}
                    disabled={vaultAvailable === false}
                    onChange={(e) => setSecretValue(e.target.value)}
                  />
                </label>
                <label className="cstudio__field">
                  <span className="cstudio__label">Send the key in</span>
                  <select
                    className="cstudio__input"
                    value={secretIn}
                    onChange={(e) => setSecretIn(e.target.value as "query" | "header")}
                  >
                    <option value="query">Query parameter</option>
                    <option value="header">Request header</option>
                  </select>
                </label>
                <label className="cstudio__field">
                  <span className="cstudio__label">
                    {secretIn === "header" ? "Header name" : "Query param name"}
                  </span>
                  <input
                    className="cstudio__input cstudio__input--mono"
                    value={secretParam}
                    placeholder={secretIn === "header" ? "Authorization" : "key"}
                    spellCheck={false}
                    onChange={(e) => setSecretParam(e.target.value)}
                  />
                </label>
                {secretIn === "header" && (
                  <label className="cstudio__field">
                    <span className="cstudio__label">Value prefix (optional)</span>
                    <input
                      className="cstudio__input cstudio__input--mono"
                      value={secretPrefix}
                      placeholder="Bearer "
                      spellCheck={false}
                      onChange={(e) => setSecretPrefix(e.target.value)}
                    />
                  </label>
                )}
                {vaultAvailable === false ? (
                  <p className="cstudio__hint cstudio__hint--span cstudio__hint--warn">
                    <CircleAlert size={12} /> This server can't store keys yet —
                    set <code>RATER_SECRETS_KEY</code> on the API Lab backend to
                    enable the in-product key vault. You can still point this
                    connector at an environment variable under Advanced.
                  </p>
                ) : (
                  <p className="cstudio__hint cstudio__hint--span">
                    Stored <strong>encrypted</strong> on the server and decrypted
                    only when this connector runs — it's never shown again or
                    written to a trace.
                    {secretIn === "header" && (
                      <>
                        {" "}
                        The prefix is prepended verbatim, so a Bearer scheme is{" "}
                        <code>Authorization</code> + <code>Bearer&nbsp;</code> (with
                        the trailing space).
                      </>
                    )}
                  </p>
                )}
                <details className="cstudio__advanced cstudio__hint--span">
                  <summary className="cstudio__advanced-summary">
                    Advanced: read from an environment variable instead
                  </summary>
                  <label className="cstudio__field cstudio__advanced-field">
                    <span className="cstudio__label">Key env-var name</span>
                    <input
                      className="cstudio__input cstudio__input--mono"
                      value={secretEnv}
                      placeholder="RATER_ACME_API_KEY"
                      spellCheck={false}
                      onChange={(e) => setSecretEnv(e.target.value)}
                    />
                  </label>
                  <p className="cstudio__hint">
                    Used only when no in-product key is stored — for ops-managed
                    secrets set in the server environment.
                  </p>
                </details>
              </div>
            )}

            <div className="cstudio__subhead">
              Inputs <span className="cstudio__count">{inputs.length}</span>
            </div>
            {inputs.length === 0 ? (
              <p className="cstudio__hint">
                No variables yet. Add <code>{"{{like_this}}"}</code> to the URL, a query value, or
                the body and they'll appear here.
              </p>
            ) : (
              <div className="cstudio__inputs">
                {inputs.map((inp) => (
                  <div key={inp.name} className="cstudio__input-row">
                    <code className="cstudio__var">{inp.name}</code>
                    <Checkbox
                      className="cstudio__req"
                      checked={inp.required}
                      onChange={(next) => setOverride(inp.name, { required: next })}
                      label="required"
                    />
                    <input
                      className="cstudio__input cstudio__input--sm"
                      value={overrides[inp.name]?.example ?? ""}
                      placeholder="example value"
                      onChange={(e) => setOverride(inp.name, { example: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : step === 2 ? (
          <div className="cstudio__section">
            <p className="cstudio__hint">
              Fill example values and run a real call. Nothing is saved — this just shows you the
              response so you can pick outputs.
            </p>
            {inputs.length > 0 && (
              <div className="cstudio__inputs">
                {inputs.map((inp) => (
                  <label key={inp.name} className="cstudio__test-row">
                    <code className="cstudio__var">{inp.name}</code>
                    <input
                      className="cstudio__input cstudio__input--mono"
                      value={testInputs[inp.name] ?? ""}
                      placeholder={inp.example ?? ""}
                      spellCheck={false}
                      onChange={(e) =>
                        setTestInputs((s) => ({ ...s, [inp.name]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            <button
              type="button"
              className="cstudio__btn cstudio__btn--primary"
              onClick={() => void runTest()}
              disabled={testing}
            >
              {testing ? <Loader2 size={14} className="cstudio__spin" /> : <FlaskConical size={14} />}
              {testing ? "Testing…" : "Run test call"}
            </button>
            {testError && (
              <div className="cstudio__banner" role="alert">
                <CircleAlert size={15} /> <span>{testError}</span>
              </div>
            )}
            {testResult?.ok && (
              <div className="cstudio__ok">
                <span className="cstudio__ok-dot" /> {testResult.status_code} · response captured —
                go to <button type="button" className="cstudio__link" onClick={() => setStep(3)}>Outputs</button> to pick fields.
              </div>
            )}
          </div>
        ) : (
          <div className="cstudio__section">
            <div className="cstudio__two-col">
              <div className="cstudio__col">
                <div className="cstudio__subhead">Response — click a field to use it</div>
                {testResult?.ok ? (
                  <JsonTreePicker
                    data={testResult.response_json}
                    pickedPaths={pickedPaths}
                    onPick={pickOutput}
                  />
                ) : (
                  <div className="cstudio__empty-tree">
                    Run a test call (step 3) to see the response here.
                  </div>
                )}
              </div>
              <div className="cstudio__col">
                <div className="cstudio__subhead">
                  Outputs <span className="cstudio__count">{outputs.length}</span>
                </div>
                {outputs.length === 0 ? (
                  <p className="cstudio__hint">No outputs yet — click fields on the left.</p>
                ) : (
                  <div className="cstudio__outputs">
                    {outputs.map((o, idx) => (
                      <div key={o.json_path} className="cstudio__output-row">
                        <input
                          className="cstudio__input cstudio__input--sm"
                          value={o.name}
                          onChange={(e) => renameOutput(idx, e.target.value)}
                        />
                        <select
                          className="cstudio__input cstudio__input--sm"
                          value={o.data_type}
                          onChange={(e) => retypeOutput(idx, e.target.value as DataType)}
                        >
                          {(["string", "number", "boolean", "object", "array"] as const).map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <code className="cstudio__path" title={o.json_path}>
                          {o.json_path}
                        </code>
                        <button
                          type="button"
                          className="cstudio__icon-btn"
                          aria-label="Remove output"
                          onClick={() => removeOutput(idx)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer.Body>

      <Drawer.Footer>
        <div className="cstudio__footer">
          {saveError && (
            <span className="cstudio__footer-err">
              <CircleAlert size={14} /> {saveError}
            </span>
          )}
          <div className="cstudio__footer-actions">
            <button type="button" className="cstudio__btn cstudio__btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="cstudio__btn cstudio__btn--primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? <Loader2 size={14} className="cstudio__spin" /> : <Sparkles size={14} />}
              {editId ? "Save changes" : "Create connector"}
            </button>
          </div>
        </div>
      </Drawer.Footer>
    </Drawer>
  );
}
