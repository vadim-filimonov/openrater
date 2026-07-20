// Copyright 2026 Vadim Filimonov and the OpenRater contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
/**
 * Integration Hub API client — the seam's operator surface
 * (ADR-0057 / Brief 77). Thin typed fetch wrappers over
 * `/api/v1/integrations/*`, mirroring `portfolio.ts`'s conventions.
 * Shapes mirror `openrater.integrations.models` — documented substrate,
 * nothing private.
 */

import { getApiBase } from "@openrater/api-client";

// One base-URL resolver for the whole app (api-client owns the
// VITE_API_BASE + same-origin semantics; see connectors.ts).
const API_BASE = getApiBase();

/** The deployment URL the peer pairs against — shown beside the pairing
 *  code so the operator can hand both over in one copy (Brief 77 §3.1). */
export function apiBase(): string {
  return API_BASE;
}

export interface IntegrationSummary {
  readonly integration_id: string;
  readonly name: string;
  readonly peer_name: string | null;
  readonly paired: boolean;
  readonly paired_at: string | null;
  readonly created_at: string;
  readonly plans_exposed: number;
  readonly plans_live: number;
  readonly catalog_field_count: number;
  readonly events_error: number;
  readonly last_event_at: string | null;
}

export interface PairingCode {
  readonly code_id: string;
  readonly code: string; // shown ONCE — key-material hygiene
  readonly expires_at: string;
}

export interface MappingEntry {
  readonly peer_key: string;
  readonly plan_input_key: string;
  readonly dtype?: string | null;
  readonly unit?: string | null;
  readonly required: boolean;
}

export interface ExposedPlan {
  readonly exposed_id: string;
  readonly rating_plan_id: string;
  readonly plan_display_name: string | null;
  readonly product: string | null;
  readonly state: string | null;
  readonly published: boolean;
  /** Which snapshot the wire serves RIGHT NOW (the republish tripwire's
   *  anchor, 2026-07-11 audit). Optional — pre-tripwire servers omit
   *  both; treat absence as unknown, never as "current". */
  readonly published_snapshot_id?: string | null;
  readonly published_version_name?: string | null;
  readonly plan_ref: string;
  readonly carrier_label: string;
  readonly mapping: readonly MappingEntry[];
  readonly required_mapped: number;
  readonly optional_mapped: number;
  readonly consumed_required: number;
  readonly consumed_missing: number;
  readonly trace_policy: "none" | "summary" | "full";
  readonly validity_days: number;
  readonly live: boolean;
  /** The Hub ladder (operator read model): unmapped → mapped → tested →
   *  live. The descriptor wire keeps the spec §3 triad — this is richer. */
  readonly status: "unmapped" | "mapped" | "tested" | "live";
  /** Republish-drift signal (audit gap #3): the live toggle is ON but the
   *  currently-published version isn't the tested one, so the seam has
   *  DEMOTED it from serving until a re-test. `status` still reads `live`
   *  (the toggle); this is why it isn't actually serving. */
  readonly live_version_untested: boolean;
  readonly last_test_at: string | null;
  readonly last_test_premium_cents: number | null;
  readonly last_test_snapshot_id: string | null;
  readonly last_test_version_name: string | null;
  readonly created_at: string;
}

export interface CatalogField {
  readonly key: string;
  readonly label?: string | null;
  readonly dtype?: string | null;
  readonly unit?: string | null;
  readonly example?: unknown;
}

export interface AllowedValue {
  /** What the engine accepts — the exact value the wire sends. */
  readonly value: string;
  /** The human name the Hub shows beside it. */
  readonly label: string | null;
}

export interface ConsumedInput {
  readonly key: string;
  readonly label: string | null;
  readonly dtype: string | null;
  readonly required: boolean;
  readonly mapped_from: string | null;
  /** When the input keys enumerable lookups: the ONLY values the
   *  published version accepts. null = free-form. */
  readonly allowed_values: readonly AllowedValue[] | null;
}

/** The engine's structured issue detail — `unknown_key` carries the
 *  plan input (`field`) + the value that missed (`key`), which is what
 *  the Hub translates into operator vocabulary. */
export interface RowIssueDetail {
  readonly table?: string;
  readonly key?: string;
  readonly field?: string;
  readonly [k: string]: unknown;
}

export interface RowIssue {
  readonly code?: string;
  readonly severity?: string;
  readonly message?: string;
  readonly detail?: string | RowIssueDetail | null;
}

export interface TestQuoteResult {
  readonly carrier: string;
  readonly row_status: "ok" | "error";
  readonly premium: number | null;
  readonly version?: { kind: string; snapshot_id?: string | null } | null;
  readonly valid_until?: string | null;
  readonly input_issues?: Record<string, readonly string[]> | null;
  readonly row_issues?: ReadonlyArray<RowIssue> | null;
  readonly composed?: Record<string, unknown> | null;
}

export interface IntegrationPulse {
  readonly plans_exposed: number;
  readonly plans_live: number;
  readonly events_applied: number;
  readonly events_duplicate: number;
  readonly events_error: number;
  readonly last_event_at: string | null;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new Error(
      detail?.error?.message ?? `${path} failed (${response.status})`,
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export function listIntegrations(): Promise<IntegrationSummary[]> {
  return requestJson("/api/v1/integrations");
}

// ── Brief 84 D-D — the plan-side Connect view (Ship tab) ──

export interface PlanConnection {
  readonly integration_id: string;
  readonly integration_name: string;
  readonly paired: boolean;
  /** The Hub's OWN read model — one ladder, two surfaces, zero drift. */
  readonly exposed: ExposedPlan;
}

export interface PlanConnections {
  readonly any_integration: boolean;
  readonly any_paired: boolean;
  readonly connections: readonly PlanConnection[];
}

/** Every integration exposing this plan + the platform pairing facts
 *  the Connect card's empty states key off. Read-only — expose/map/
 *  test/live stay Hub verbs. */
export function getPlanConnections(planId: string): Promise<PlanConnections> {
  return requestJson(
    `/api/v1/plans/${encodeURIComponent(planId)}/integrations`,
  );
}

export function createIntegration(name: string): Promise<IntegrationSummary> {
  return requestJson("/api/v1/integrations", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getIntegration(id: string): Promise<IntegrationSummary> {
  return requestJson(`/api/v1/integrations/${id}`);
}

export function mintPairingCode(id: string): Promise<PairingCode> {
  return requestJson(`/api/v1/integrations/${id}/pairing-codes`, {
    method: "POST",
  });
}

export function listExposedPlans(id: string): Promise<ExposedPlan[]> {
  return requestJson(`/api/v1/integrations/${id}/plans`);
}

export function exposePlan(
  id: string,
  body: {
    rating_plan_id: string;
    carrier_label: string;
    trace_policy?: string;
    validity_days?: number;
  },
): Promise<ExposedPlan> {
  return requestJson(`/api/v1/integrations/${id}/plans`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchExposedPlan(
  id: string,
  exposedId: string,
  body: Partial<{
    carrier_label: string;
    trace_policy: "none" | "summary" | "full";
    validity_days: number;
    live: boolean;
    mapping: readonly MappingEntry[];
  }>,
): Promise<ExposedPlan> {
  return requestJson(`/api/v1/integrations/${id}/plans/${exposedId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function removeExposedPlan(id: string, exposedId: string): Promise<void> {
  return requestJson(`/api/v1/integrations/${id}/plans/${exposedId}`, {
    method: "DELETE",
  });
}

export function getPulse(id: string): Promise<IntegrationPulse> {
  return requestJson(`/api/v1/integrations/${id}/pulse`);
}

export function getCatalog(id: string): Promise<CatalogField[]> {
  return requestJson(`/api/v1/integrations/${id}/catalog`);
}

export function getConsumedInputs(
  id: string,
  exposedId: string,
): Promise<ConsumedInput[]> {
  return requestJson(`/api/v1/integrations/${id}/plans/${exposedId}/inputs`);
}

export function runTestQuote(
  id: string,
  exposedId: string,
  facts: Record<string, unknown>,
): Promise<TestQuoteResult> {
  return requestJson(`/api/v1/integrations/${id}/plans/${exposedId}/test-quote`, {
    method: "POST",
    body: JSON.stringify({ facts }),
  });
}

/* ── the auto-matcher (Brief 77 step 3) — pure + tested ──
   exact: normalized keys/labels agree (namespaces stripped);
   likely: the input key's tokens all appear in the peer key/label;
   guess: the input LABEL's tokens mostly appear (length-weighted
   coverage, the Brief 57 lesson — one shared short token never
   qualifies). */
const norm = (s: string | null | undefined): string =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const tokensOf = (s: string | null | undefined): string[] =>
  (s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);

export type MatchConfidence = "exact" | "likely" | "guess";

export function autoMatch(
  input: Pick<ConsumedInput, "key" | "label">,
  catalog: readonly CatalogField[],
): { peerKey: string; confidence: MatchConfidence } | null {
  const key = norm(input.key);
  const label = norm(input.label);
  for (const field of catalog) {
    const tail = norm(field.key.split(".").pop());
    if (tail === key || norm(field.key) === key) {
      return { peerKey: field.key, confidence: "exact" };
    }
    if (label && norm(field.label) === label) {
      return { peerKey: field.key, confidence: "exact" };
    }
  }
  const keyTokens = tokensOf(input.key);
  if (keyTokens.length > 0) {
    for (const field of catalog) {
      const hay = `${field.key} ${field.label ?? ""}`.toLowerCase();
      if (keyTokens.every((t) => hay.includes(t))) {
        return { peerKey: field.key, confidence: "likely" };
      }
    }
  }
  // guess — label-similarity, length-weighted so "Public Protection
  // Class" finds "Fire protection class" while a lone short token
  // (the Brief 57 over-inflation) never clears the bar.
  const labelTokens = tokensOf(input.label ?? input.key);
  const totalLen = labelTokens.reduce((n, t) => n + t.length, 0);
  if (totalLen === 0) return null;
  let best: { peerKey: string; coverage: number } | null = null;
  for (const field of catalog) {
    const hay = `${field.key} ${field.label ?? ""}`.toLowerCase();
    const matched = labelTokens.filter((t) => hay.includes(t));
    if (!matched.some((t) => t.length >= 5)) continue;
    const coverage = matched.reduce((n, t) => n + t.length, 0) / totalLen;
    if (coverage >= 0.6 && (best === null || coverage > best.coverage)) {
      best = { peerKey: field.key, coverage };
    }
  }
  return best ? { peerKey: best.peerKey, confidence: "guess" } : null;
}

/* ── example → prefill value (Brief 77 step 5) ──
   The Test form pre-fills REAL values, not placeholders. A catalog
   example is display-shaped ("$850,000"); the wire wants what the
   engine parses — so normalize, and refuse to prefill anything the
   published version wouldn't accept. */
const NUMERIC_DTYPES = new Set(["number", "money", "int", "integer", "float"]);
const BOOL_DTYPES = new Set(["bool", "boolean"]);

export function exampleValueFor(
  input: Pick<ConsumedInput, "dtype" | "allowed_values">,
  peer: Pick<CatalogField, "example" | "dtype"> | undefined,
): string | null {
  const example = peer?.example;
  if (example === undefined || example === null || example === "") return null;
  const raw = String(example);
  if (input.allowed_values && input.allowed_values.length > 0) {
    return input.allowed_values.some((a) => a.value === raw) ? raw : null;
  }
  const dtype = (input.dtype ?? peer?.dtype ?? "").toLowerCase();
  if (NUMERIC_DTYPES.has(dtype)) {
    const cleaned = raw.replace(/[$,\s]/g, "");
    return cleaned !== "" && Number.isFinite(Number(cleaned)) ? cleaned : null;
  }
  if (BOOL_DTYPES.has(dtype)) {
    if (typeof example === "boolean") return example ? "true" : "false";
    const low = raw.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(low)) return "true";
    if (["false", "no", "n", "0"].includes(low)) return "false";
    return null;
  }
  return raw;
}
