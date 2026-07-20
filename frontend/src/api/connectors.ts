/**
 * API Lab — typed client for the generic connector endpoints (Brief 47).
 *
 * Vendor-agnostic: a connector is described by its manifest (inputs + outputs);
 * `invokeConnector` runs any of them and returns RAW outputs; mappings bind an
 * output port → a Plan input key (config). Reuses the backend base-URL
 * convention and decodes the central RaterError envelope.
 */

import { getApiBase } from "@openrater/api-client";

// One base-URL resolver for the whole app (api-client owns the
// VITE_API_BASE + same-origin semantics) — a duplicated reader here
// silently missed the desktop bundle's runtime-resolved origin.
const API_BASE = getApiBase();

export type DataType = "string" | "number" | "boolean" | "object" | "array";
export type ConnectorSource = "bundled" | "user";
export type HttpMethod = "GET" | "POST";

export interface InputParam {
  readonly name: string;
  readonly data_type: DataType;
  readonly required: boolean;
  readonly default: string | null;
  readonly example: string | null;
  readonly description: string;
}

export interface OutputPort {
  readonly name: string;
  readonly data_type: DataType;
  readonly json_path: string;
  readonly description: string;
  /**
   * Brief 50 — name of an INPUT param this output echoes back (e.g. a
   * `matched_name` that should resemble the `query` searched). When set, the
   * Route test-run step shows a name-similarity confidence badge so a wrong
   * external match is caught before the value is pushed.
   */
  readonly echo_of?: string;
}

export interface ConnectorInfo {
  readonly connector_id: string;
  readonly display_name: string;
  readonly vendor: string;
  readonly category: string;
  readonly version: string;
  readonly inputs: readonly InputParam[];
  readonly outputs: readonly OutputPort[];
  readonly cost_per_call_usd: number;
  readonly requires_secret: string | null;
  /** E06 — whether this connector requires an API key at all (declares
   *  `secret_param`/`secret_env`). With `configured`, drives "Add key" vs
   *  "Key set ✓". */
  readonly needs_secret: boolean;
  readonly configured: boolean;
  readonly docs_url: string | null;
  readonly source: ConnectorSource;
}

/** The full connector spec — what the studio authors + the engine runs. */
export interface ConnectorManifest {
  readonly connector_id: string;
  readonly display_name: string;
  readonly vendor: string;
  readonly category: string;
  readonly kind: "rest";
  readonly version: string;
  readonly method: HttpMethod;
  readonly endpoint: string;
  readonly secret_env: string | null;
  readonly secret_param: string | null;
  /** Where the secret is injected: query param (default) or request header (E05). */
  readonly secret_in: "query" | "header";
  /** Optional value prefix, e.g. "Bearer " for `Authorization: Bearer <key>`. */
  readonly secret_prefix: string | null;
  readonly request_json: Record<string, unknown> | null;
  readonly request_query: Record<string, string>;
  readonly inputs: readonly InputParam[];
  readonly outputs: readonly OutputPort[];
  readonly cost_per_call_usd: number;
  readonly ttl_seconds: number;
  readonly docs_url: string | null;
}

export interface TestConnectorResponse {
  readonly ok: boolean;
  readonly status_code: number | null;
  readonly response_json: Record<string, unknown>;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly error: string | null;
}

export interface InvokeResponse {
  readonly connector_id: string;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly snapshot_id: string;
  readonly status_code: number;
  readonly cost_usd: number;
  readonly vendor_request_id: string | null;
}

/** The outbound request kept in a snapshot (secrets are NEVER captured). */
export interface SnapshotRequest {
  readonly method: string;
  readonly url: string;
  readonly params: Readonly<Record<string, string>>;
  readonly json_body: Record<string, unknown> | null;
}

export interface SnapshotResponse {
  readonly status_code: number;
  readonly json_body: Readonly<Record<string, unknown>>;
}

/**
 * Brief 47 §4.4 / 62.6 — the immutable capture of ONE connector call: the
 * frozen request + response that a filed premium's IRPM step replays from.
 * Re-scores read THIS, never the live API.
 */
export interface ConnectorSnapshot {
  readonly snapshot_id: string;
  readonly connector_id: string;
  readonly connector_version: string;
  readonly request: SnapshotRequest;
  readonly response: SnapshotResponse;
  readonly status_code: number;
  readonly vendor_request_id: string | null;
  readonly fetched_at: string;
  readonly content_hash: string;
  readonly cost_usd: number;
}

export class ApiLabError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiLabError";
    this.status = status;
    this.code = code;
  }
}

async function decodeError(res: Response): Promise<ApiLabError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new ApiLabError(
      res.status,
      body.error?.code ?? "error",
      body.error?.message ?? res.statusText,
    );
  } catch {
    return new ApiLabError(res.status, "error", res.statusText);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (e) {
    throw new ApiLabError(
      0,
      "network_error",
      e instanceof Error
        ? `Cannot reach the API Lab backend at ${API_BASE}. Is it running? (${e.message})`
        : "Network request failed",
    );
  }
  if (!res.ok) throw await decodeError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function listConnectors(): Promise<{
  connectors: ConnectorInfo[];
  /** E06 — whether the server can store in-product API keys (RATER_SECRETS_KEY
   *  is set). When false, the studio guides the operator to configure it. */
  vault_available: boolean;
}> {
  return request("GET", "/api/v1/connectors");
}

export function invokeConnector(
  connectorId: string,
  inputs: Record<string, unknown>,
): Promise<InvokeResponse> {
  return request("POST", `/api/v1/connectors/${connectorId}/invoke`, { inputs });
}

/** Fetch one frozen replay snapshot — the "why did this IRPM resolve?"
 *  provenance behind a connector-sourced step (Brief 62.6 §4). */
export function getConnectorSnapshot(snapshotId: string): Promise<ConnectorSnapshot> {
  return request("GET", `/api/v1/connectors/snapshots/${snapshotId}`);
}

// --- a plan's input variables ------------------------------------------------
// Derived on the CLIENT via `deriveRequiredInputs` (@openrater/ui) — the same
// union the Inputs workspace shows (input nodes + chain dim-refs + chain
// base/exposure/lcm + flat-factor paths + factor-table keys + dim catalog).

export interface PlanInputDef {
  readonly key: string;
  readonly label: string;
  readonly data_type: DataType;
  readonly required: boolean;
  readonly description: string;
}

// --- Phase B: the no-code connector authoring studio -------------------------

/** Full manifest (bundled or user) — what the studio loads to edit / clone. */
export function getConnector(connectorId: string): Promise<ConnectorManifest> {
  return request("GET", `/api/v1/connectors/${connectorId}`);
}

/** Persist a brand-new user-authored connector. */
export function createConnector(manifest: ConnectorManifest): Promise<ConnectorInfo> {
  return request("POST", "/api/v1/connectors", manifest);
}

/** Update an existing user-authored connector. */
export function updateConnector(
  connectorId: string,
  manifest: ConnectorManifest,
): Promise<ConnectorInfo> {
  return request("PUT", `/api/v1/connectors/${connectorId}`, manifest);
}

/** Delete a user-authored connector (built-ins are read-only). */
export function deleteConnector(connectorId: string): Promise<void> {
  return request("DELETE", `/api/v1/connectors/${connectorId}`);
}

/** Run a DRAFT (unsaved) manifest against example inputs — for the Test step.
 *  `secretValue` (E06) lets the studio authenticate with a just-typed key before
 *  the connector is saved + the key persisted. Write-only; never echoed back. */
export function testConnector(
  manifest: ConnectorManifest,
  inputs: Record<string, unknown>,
  secretValue?: string,
): Promise<TestConnectorResponse> {
  return request("POST", "/api/v1/connectors/test", {
    manifest,
    inputs,
    ...(secretValue ? { secret_value: secretValue } : {}),
  });
}

/**
 * Store an API key for a connector in the encrypted vault (E06). Write-only —
 * the value is never returned. Works for bundled + user connectors. Throws
 * `ApiLabError` (503) if the server's secret vault isn't configured.
 */
export function setConnectorSecret(
  connectorId: string,
  value: string,
): Promise<ConnectorInfo> {
  return request("PUT", `/api/v1/connectors/${connectorId}/secret`, { value });
}

/** Remove a connector's stored API key (idempotent). */
export function clearConnectorSecret(connectorId: string): Promise<void> {
  return request("DELETE", `/api/v1/connectors/${connectorId}/secret`);
}

// --- Routes (Brief 48): plan inputs → a Connection → push outputs back --------

export interface RouteBinding {
  readonly param_name: string;
  readonly plan_input_key: string;
}
export interface RoutePush {
  readonly output_port: string;
  readonly plan_input_key: string;
}
export interface Route {
  readonly route_id: string;
  readonly plan_id: string;
  readonly connection_id: string;
  readonly name: string;
  readonly bindings: readonly RouteBinding[];
  readonly pushes: readonly RoutePush[];
  readonly created_at: string;
  readonly created_by: string;
  readonly updated_at: string;
}
export interface ResolvedPush {
  readonly plan_input_key: string;
  readonly output_port: string;
  readonly value: string | number | boolean | null;
}
export interface ApplyRouteResponse {
  readonly ok: boolean;
  readonly route_id: string;
  readonly status_code: number | null;
  readonly resolved: readonly ResolvedPush[];
  readonly snapshot_id: string | null;
  readonly cost_usd: number;
  readonly error: string | null;
}
export interface PlanInputValue {
  readonly plan_id: string;
  readonly input_key: string;
  readonly value: string | number | boolean | null;
  readonly source: string;
  readonly snapshot_id: string | null;
  readonly updated_at: string;
}

export function listRoutes(planId: string): Promise<{ routes: Route[] }> {
  return request("GET", `/api/v1/plans/${planId}/routes`);
}

export function createRoute(
  planId: string,
  body: {
    connection_id: string;
    name: string;
    bindings: RouteBinding[];
    pushes: RoutePush[];
  },
): Promise<Route> {
  return request("POST", `/api/v1/plans/${planId}/routes`, body);
}

export function deleteRoute(planId: string, routeId: string): Promise<void> {
  return request("DELETE", `/api/v1/plans/${planId}/routes/${routeId}`);
}

export function applyRoute(
  planId: string,
  routeId: string,
  body: { values: Record<string, unknown>; persist?: boolean },
): Promise<ApplyRouteResponse> {
  return request("POST", `/api/v1/plans/${planId}/routes/${routeId}/apply`, body);
}

export function listInputValues(planId: string): Promise<{ values: PlanInputValue[] }> {
  return request("GET", `/api/v1/plans/${planId}/input-values`);
}
