/**
 * Fixture mode — deterministic API responses for development and tests.
 *
 * ## Why this exists
 *
 * Fixture mode lets a caller register local responses without changing
 * production request code. It supports isolated component development,
 * deterministic tests, and mixed local/network development sessions.
 *
 * ## Wire shape
 *
 * Two ways to register a fixture:
 *
 *   1. **Exact path** — `setFixture(method, path, response)`. The
 *      simplest. Matches the request's full path (including any
 *      stage_id / plan_id in the URL).
 *
 *   2. **Pattern** — `setFixturePattern(method, pattern, handler)`.
 *      `{name}` in the pattern matches any non-slash segment;
 *      captures the value in a `params` object the handler reads.
 *      Used when the same response shape covers many concrete IDs
 *      (e.g., `GET /plans/{id}` always returns "the same plan
 *      detail for the requested id").
 *
 * ## Mode flag
 *
 * Fixtures are inert unless `enableFixtureMode()` is called.
 * Production builds never enable fixture mode; dev builds + tests
 * opt in explicitly.
 *
 * When fixture mode is enabled AND the request matches a fixture:
 *  - the registered response is returned (still schema-validated
 *    via the calling function's Zod schema).
 *
 * When fixture mode is enabled AND the request does NOT match a
 * fixture:
 *  - the request throws `RaterApiError(code="fixture_not_found")`.
 *    Loud failure tells the dev they forgot to register one.
 *
 * When fixture mode is disabled (the default):
 *  - fixtures are bypassed; requests go to the real network.
 *
 * ## Example
 *
 *   import {
 *     enableFixtureMode,
 *     setFixture,
 *     clearFixtures,
 *     listPlans,
 *   } from "@openrater/api-client";
 *
 *   beforeAll(() => {
 *     enableFixtureMode();
 *     setFixture("GET", "/api/v1/plans", []);
 *   });
 *
 *   afterAll(() => {
 *     clearFixtures();
 *     disableFixtureMode();
 *   });
 *
 *   it("renders an empty list", async () => {
 *     const plans = await listPlans();
 *     expect(plans).toEqual([]);
 *   });
 */

import type { HttpMethod } from "./fetcher-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Either a static response object OR a function that builds one from
 * the captured path params + querystring.
 */
export type FixtureValue =
  | unknown
  | ((params: Record<string, string>, query: URLSearchParams) => unknown);

interface ExactFixture {
  kind: "exact";
  method: HttpMethod;
  path: string;
  value: FixtureValue;
}

interface PatternFixture {
  kind: "pattern";
  method: HttpMethod;
  pattern: string;
  /** Compiled regex for matching the request path. */
  regex: RegExp;
  /** Ordered list of param names captured by the pattern (e.g. ["id"]). */
  paramNames: string[];
  value: FixtureValue;
}

type Fixture = ExactFixture | PatternFixture;

interface ResolvedFixture {
  fixture: Fixture;
  params: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _enabled = false;
let _onMiss: "error" | "network" = "error";
const _fixtures: Fixture[] = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Turn fixture mode on. All subsequent `request()` calls consult the
 * registry; matches return the fixture.
 *
 * The `onMiss` option controls what happens when no fixture matches:
 *
 *   · `"error"` (default) — request throws `fixture_not_found`.
 *     Right for TESTS where a missing fixture means the test forgot
 *     to register one + you want loud failure.
 *
 *   · `"network"` — fall through to the real HTTP fetch. Right for
 *     development sessions where some endpoints use fixtures while
 *     others continue against the real backend.
 *
 * Intended for dev builds + tests only. Production builds should
 * never call this.
 */
export function enableFixtureMode(
  options: { onMiss?: "error" | "network" } = {},
): void {
  _enabled = true;
  _onMiss = options.onMiss ?? "error";
}

/**
 * @internal — for the fetcher to read.
 */
export function fixtureMissBehavior(): "error" | "network" {
  return _onMiss;
}

/**
 * Turn fixture mode off. Registered fixtures are NOT cleared — call
 * `clearFixtures()` separately for that. Splitting the two lets a
 * test suite warm up fixtures once + flip the mode flag per-test.
 */
export function disableFixtureMode(): void {
  _enabled = false;
}

/**
 * Whether fixture mode is currently active. The fetcher consults this
 * before deciding whether to look at the registry.
 */
export function isFixtureModeEnabled(): boolean {
  return _enabled;
}

/**
 * Register an EXACT-path fixture. The request's `(method, path)` must
 * match exactly (querystring doesn't participate — pass `value` as a
 * function if you need query-driven branching).
 *
 * Later registrations REPLACE earlier ones for the same `(method, path)`.
 */
export function setFixture(
  method: HttpMethod,
  path: string,
  value: FixtureValue,
): void {
  // Drop any existing exact fixture for the same (method, path).
  const existingIndex = _fixtures.findIndex(
    (f) => f.kind === "exact" && f.method === method && f.path === path,
  );
  const entry: ExactFixture = { kind: "exact", method, path, value };
  if (existingIndex >= 0) {
    _fixtures[existingIndex] = entry;
  } else {
    _fixtures.push(entry);
  }
}

/**
 * Register a PATTERN fixture. `{name}` placeholders in `pattern` match
 * any non-slash segment; the captured values are passed to a function
 * `value` as the `params` arg (or are simply unused if `value` is a
 * static object).
 *
 * Patterns match AFTER exact fixtures, in registration order.
 */
export function setFixturePattern(
  method: HttpMethod,
  pattern: string,
  value: FixtureValue,
): void {
  const { regex, paramNames } = compilePattern(pattern);
  const existingIndex = _fixtures.findIndex(
    (f) => f.kind === "pattern" && f.method === method && f.pattern === pattern,
  );
  const entry: PatternFixture = {
    kind: "pattern",
    method,
    pattern,
    regex,
    paramNames,
    value,
  };
  if (existingIndex >= 0) {
    _fixtures[existingIndex] = entry;
  } else {
    _fixtures.push(entry);
  }
}

/**
 * Drop every registered fixture. Mode flag is unchanged.
 */
export function clearFixtures(): void {
  _fixtures.length = 0;
}

/**
 * Look up a fixture for `(method, path)`. Tries exact matches first,
 * then patterns in registration order. Returns the resolved fixture
 * plus any path-params, or `null` if no fixture matches.
 *
 * Used by the fetcher; exposed for tests.
 */
export function resolveFixture(
  method: HttpMethod,
  path: string,
): ResolvedFixture | null {
  // Exact matches win.
  for (const f of _fixtures) {
    if (f.kind === "exact" && f.method === method && f.path === path) {
      return { fixture: f, params: {} };
    }
  }
  // Then patterns, in registration order.
  for (const f of _fixtures) {
    if (f.kind !== "pattern" || f.method !== method) continue;
    const match = f.regex.exec(path);
    if (match) {
      const params: Record<string, string> = {};
      f.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1] ?? "");
      });
      return { fixture: f, params };
    }
  }
  return null;
}

/**
 * Materialize the fixture's value into a concrete response. Functions
 * get called with the path params + querystring; static values are
 * returned as-is.
 */
export function materializeFixture(
  fixture: Fixture,
  params: Record<string, string>,
  query: URLSearchParams,
): unknown {
  if (typeof fixture.value === "function") {
    return (fixture.value as (
      p: Record<string, string>,
      q: URLSearchParams,
    ) => unknown)(params, query);
  }
  return fixture.value;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compilePattern(pattern: string): {
  regex: RegExp;
  paramNames: string[];
} {
  const paramNames: string[] = [];
  // Step 1: replace `{name}` placeholders with unique sentinels and
  // capture the param names in order. Sentinels survive Step 2's
  // regex-char escape without being touched.
  const sentinels: string[] = [];
  const withSentinels = pattern.replace(
    /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
    (_match, name: string) => {
      paramNames.push(name);
      const sentinel = `__RATER_FIXTURE_PARAM_${sentinels.length}__`;
      sentinels.push(sentinel);
      return sentinel;
    },
  );
  // Step 2: escape EVERY regex metacharacter in the remaining string,
  // including `{` and `}` (so accidental quantifier-looking sequences
  // in pattern text become literal).
  const escaped = withSentinels.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  // Step 3: substitute each sentinel back with a capture group that
  // matches one path segment.
  let finalPattern = escaped;
  for (const sentinel of sentinels) {
    finalPattern = finalPattern.replace(sentinel, "([^/]+)");
  }
  return { regex: new RegExp(`^${finalPattern}$`), paramNames };
}

// ---------------------------------------------------------------------------
// Test-only exports — used internally by fetcher tests
// ---------------------------------------------------------------------------

/** @internal — for tests; not part of the public API. */
export function _fixtureCount(): number {
  return _fixtures.length;
}
