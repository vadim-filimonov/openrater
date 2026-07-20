/**
 * WebhookSource (P2.1) — the v2 webhook data-source config.
 *
 * The v2-elegant rebuild of v1's WebhookConfigDrawer: progressive, not a
 * wall of fields. The common case (a public JSON GET) is one line — a URL +
 * "Fetch sample" — and method / headers / auth hide behind "Advanced".
 *
 * Fetch runs the mount's onInfer (testWebhookRequest + inferPayloadSchema);
 * the inferred `payload_schema.fields` become the source columns, so the
 * mapping table + Score-all work exactly like the CSV path. Auth is
 * env-var-NAME based — no secrets are ever stored in the plan.
 */

import { useState, useCallback } from "react";
import { Globe, Plus, X } from "lucide-react";
import { Button, IconButton } from "@openrater/design-system";
import type { WebhookConfig, AuthSpec, PayloadSchemaField } from "../InputsWorkspace";

export interface WebhookInferResult {
  readonly ok: boolean;
  readonly fields?: readonly PayloadSchemaField[];
  readonly error?: string;
}

export interface WebhookSourceProps {
  readonly value: WebhookConfig;
  readonly onChange: (next: WebhookConfig) => void;
  /** Fetch a sample + infer the field schema (mount: test request + infer). */
  readonly onInfer?:
    | ((config: WebhookConfig) => Promise<WebhookInferResult>)
    | undefined;
  readonly editable: boolean;
  /** Switch the source back to a CSV upload. */
  readonly onUseCsv?: (() => void) | undefined;
}

const AUTH_MODES: ReadonlyArray<{ kind: AuthSpec["kind"]; label: string }> = [
  { kind: "none", label: "None" },
  { kind: "bearer", label: "Bearer token" },
  { kind: "api-key", label: "API key header" },
  { kind: "basic", label: "Basic auth" },
];

/** A fresh auth spec for the chosen mode (env-var NAMES, never secrets). */
function defaultAuth(kind: AuthSpec["kind"]): AuthSpec {
  switch (kind) {
    case "bearer":
      return { kind: "bearer", token_env: "" };
    case "api-key":
      return { kind: "api-key", header_name: "X-API-Key", value_env: "" };
    case "basic":
      return { kind: "basic", username_env: "", password_env: "" };
    default:
      return { kind: "none" };
  }
}

export function WebhookSource({
  value,
  onChange,
  onInfer,
  editable,
  onUseCsv,
}: WebhookSourceProps): JSX.Element {
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<
    { ok: true; count: number } | { ok: false; error: string } | null
  >(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fields = value.payload_schema.fields;
  const auth: AuthSpec = value.auth ?? { kind: "none" };
  const headers = value.headers ?? {};
  const headerEntries = Object.entries(headers);
  const urlValid = /^https?:\/\/.+/.test(value.url.trim());

  const patch = useCallback(
    (next: Partial<WebhookConfig>) => onChange({ ...value, ...next }),
    [onChange, value],
  );

  const fetchSample = useCallback(async () => {
    if (!onInfer || !urlValid) return;
    setFetching(true);
    setResult(null);
    const r = await onInfer(value);
    setFetching(false);
    if (r.ok && r.fields) {
      onChange({
        ...value,
        payload_schema: { ...value.payload_schema, fields: r.fields },
      });
      setResult({ ok: true, count: r.fields.length });
    } else {
      setResult({ ok: false, error: r.error ?? "Couldn't fetch a sample." });
    }
  }, [onInfer, urlValid, value, onChange]);

  const setHeader = (oldKey: string, key: string, val: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of headerEntries) next[k === oldKey ? key : k] = k === oldKey ? val : v;
    patch({ headers: next });
  };
  const addHeader = () => patch({ headers: { ...headers, "": "" } });
  const removeHeader = (key: string) => {
    const next = { ...headers };
    delete next[key];
    patch({ headers: next });
  };

  return (
    <div className="rater-inputs2__webhook">
      <div className="rater-inputs2__webhook-head">
        <span className="rater-inputs2__webhook-icon" aria-hidden>
          <Globe size={18} />
        </span>
        <div className="rater-inputs2__webhook-headcopy">
          <span className="rater-inputs2__webhook-title">Fetch from an API</span>
          <span className="rater-inputs2__webhook-sub">
            {fields.length > 0
              ? `${fields.length} field${fields.length === 1 ? "" : "s"} detected — match them to inputs below`
              : "A JSON endpoint — its fields become your source columns"}
          </span>
        </div>
        {editable && onUseCsv ? (
          <button
            type="button"
            className="rater-inputs2__webhook-altlink"
            onClick={onUseCsv}
          >
            Use a CSV instead
          </button>
        ) : null}
      </div>

      <div className="rater-inputs2__webhook-row">
        <input
          type="url"
          className="rater-inputs2__webhook-url"
          value={value.url}
          disabled={!editable}
          placeholder="https://api.example.com/book"
          onChange={(e) => patch({ url: e.target.value })}
          aria-label="Webhook URL"
        />
        {editable ? (
          <Button
            variant="primary"
            size="sm"
            disabled={!urlValid || !onInfer}
            loading={fetching}
            onClick={fetchSample}
          >
            Fetch sample
          </Button>
        ) : null}
      </div>

      {result ? (
        <div
          className={`rater-inputs2__webhook-result${
            result.ok ? "" : " is-error"
          }`}
          role="status"
        >
          {result.ok
            ? `Connected — ${result.count} field${result.count === 1 ? "" : "s"} detected.`
            : result.error}
        </div>
      ) : null}

      {editable ? (
        <button
          type="button"
          className="rater-inputs2__webhook-advtoggle"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? "Hide advanced" : "Advanced — method, auth, headers"}
        </button>
      ) : null}

      {showAdvanced && editable ? (
        <div className="rater-inputs2__webhook-adv">
          {/* Method */}
          <label className="rater-inputs2__webhook-field">
            <span className="rater-inputs2__webhook-label">Method</span>
            <select
              className="rater-inputs2__select"
              value={value.method ?? "GET"}
              onChange={(e) =>
                patch({ method: e.target.value as "GET" | "POST" })
              }
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
          </label>

          {/* Auth — env-var names, never secrets */}
          <label className="rater-inputs2__webhook-field">
            <span className="rater-inputs2__webhook-label">Auth</span>
            <select
              className="rater-inputs2__select"
              value={auth.kind}
              onChange={(e) =>
                patch({ auth: defaultAuth(e.target.value as AuthSpec["kind"]) })
              }
            >
              {AUTH_MODES.map((m) => (
                <option key={m.kind} value={m.kind}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          {auth.kind !== "none" ? (
            <div className="rater-inputs2__webhook-auth">
              {auth.kind === "bearer" ? (
                <EnvField
                  label="Token env var"
                  value={auth.token_env}
                  onChange={(v) => patch({ auth: { ...auth, token_env: v } })}
                />
              ) : null}
              {auth.kind === "api-key" ? (
                <>
                  <EnvField
                    label="Header name"
                    value={auth.header_name}
                    placeholder="X-API-Key"
                    onChange={(v) =>
                      patch({ auth: { ...auth, header_name: v } })
                    }
                  />
                  <EnvField
                    label="Value env var"
                    value={auth.value_env}
                    onChange={(v) => patch({ auth: { ...auth, value_env: v } })}
                  />
                </>
              ) : null}
              {auth.kind === "basic" ? (
                <>
                  <EnvField
                    label="Username env var"
                    value={auth.username_env}
                    onChange={(v) =>
                      patch({ auth: { ...auth, username_env: v } })
                    }
                  />
                  <EnvField
                    label="Password env var"
                    value={auth.password_env}
                    onChange={(v) =>
                      patch({ auth: { ...auth, password_env: v } })
                    }
                  />
                </>
              ) : null}
              <p className="rater-inputs2__webhook-authnote">
                Values are read from environment variables at request time — no
                secret is ever stored in the plan.
              </p>
            </div>
          ) : null}

          {/* Headers */}
          <div className="rater-inputs2__webhook-field">
            <span className="rater-inputs2__webhook-label">Headers</span>
            <div className="rater-inputs2__webhook-headers">
              {headerEntries.map(([k, v], i) => (
                <div key={i} className="rater-inputs2__webhook-hrow">
                  <input
                    className="rater-inputs2__webhook-hkey"
                    value={k}
                    placeholder="Header"
                    onChange={(e) => setHeader(k, e.target.value, v)}
                    aria-label={`Header ${i + 1} name`}
                  />
                  <input
                    className="rater-inputs2__webhook-hval"
                    value={v}
                    placeholder="Value"
                    onChange={(e) => setHeader(k, k, e.target.value)}
                    aria-label={`Header ${i + 1} value`}
                  />
                  <IconButton
                    variant="ghost"
                    size="xs"
                    icon={<X />}
                    aria-label={`Remove header ${k || i + 1}`}
                    onClick={() => removeHeader(k)}
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus />}
                onClick={addHeader}
              >
                Add header
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A labelled single-line input for an env-var name. */
function EnvField({
  label,
  value,
  placeholder,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="rater-inputs2__webhook-field rater-inputs2__webhook-field--env">
      <span className="rater-inputs2__webhook-label">{label}</span>
      <input
        className="rater-inputs2__webhook-envinput"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
