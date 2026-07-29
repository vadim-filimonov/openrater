# OpenRater Rating Engine — Integrator Contract

| Field        | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| **Status**   | v1 — normative                                                 |
| **Updated**  | 2026-05-19                                                     |
| **Audience** | Integrators building consumption modes (live HTTP API, queue consumers, embedded libraries, SaaS adapters) against the OpenRater re-rating engine. |
| **Package**  | [`@openrater/contracts`](../../packages/contracts/) — `packages/contracts/src/runtime.ts` + `packages/contracts/src/plan-types.ts` + `packages/contracts/src/block-types.ts` + `packages/contracts/src/kinds/`. Zero runtime UI deps; importable from Node, browsers, Bun, Deno. |
| **Source of truth** | The implementation linked above plus the executable conformance suite at `packages/contracts/src/__tests__/conformance.test.ts` (runs V1–V7 from `./conformance/V*.json`). The CI conformance job (`.github/workflows/ci.yml`) re-runs the suite on every PR. |
| **Related** | Plan Format Spec v1 (the data format this engine consumes). W4 amendment §0.5 (the OSS bet that motivates this contract). |

---

## 0. Why this document exists

OpenRater's re-rating engine is shipped as one bundled product (the
Rate Lab authoring UI + the `runPlan` runtime in `@openrater/contracts`)
plus a documented contract that integrators build against. This
contract describes exactly what the engine guarantees, so any third
party can:

- Build a live HTTP API around `runPlan` and ship a service
- Embed the engine in a Spark/Beam batch pipeline
- Wrap it as a SaaS adapter behind their own UI
- Port the same conformance suite to a non-TypeScript runtime
  (Python, Go, Rust) and verify their port matches

The conformance suite (Section 8 below) is the test surface that
distinguishes "a compatible engine" from "something that runs
plans but might not match." Pass the suite, and your integration
is contract-compatible.

---

## 1. Public API surface (stable)

These exports from `@openrater/contracts` are **stable**. Breaking
changes are a major-version bump:

```ts
import {
  // runtime
  compilePlan,
  runPlan,
  executePlan,
  runPlanBatch,
  executePlanBatch,
  // registry — isolated instances + the default global
  KindRegistry,
  globalRegistry,
  registerBlockKind,
  getBlockKind,
  listBlockKinds,
  // V0 kinds + opt-in registration
  registerBuiltinKinds,
  // Closed vocabulary — Brief 16 (exposure). The Brief-17 LOB vocabulary
  // (LINE_CODES / LINE_LABELS / isLineCode) was deleted in the ADR-0033
  // axis cleanup; products use ProductCode + opaque coverage tags.
  EXPOSURE_BASE_CODES,
  EXPOSURE_BASE_LABELS,
  EXPOSURE_BASE_DEFAULT_UNIT,
  EXPOSURE_BASE_DESCRIPTIONS,
  EXPOSURE_INPUT_KEYS,
  isExposureBaseCode,
  exposureInputKey,
  slugifyCustomLabel,
  pickExposureDeclaration,
  validateExposureDeclarations,
  // Eligibility (Brief 10)
  ELIGIBILITY_TIERS,
  ELIGIBILITY_TIER_LABELS,
  ELIGIBILITY_TIER_DESCRIPTIONS,
  ELIGIBILITY_OPS,
  isEligibilityTier,
  evaluateEligibilityComparator,
  // Schedule rating (Brief 15)
  SCHEDULE_APPLICATION_SOURCES,
  // UW Report (Brief 7)
  isUwReport,
  // Diff library (Brief 12)
  diffPlans,
  diffRuns,
  diffTraces,
  // Issues + collectIssues (Brief 13)
  ISSUE_SEVERITIES,
  ISSUE_SOURCES,
  collectIssues,
  deriveIssueId,
  rankIssues,
  countSeverities,
  filingReadiness,
  defaultFilingBlocking,
  PlanCompileError,
} from "@openrater/contracts";

import type {
  // Closed-vocabulary types
  ExposureBaseCode,
  ExposureBaseDeclaration,
  // Eligibility (Brief 10)
  EligibilityTier,
  EligibilityOp,
  EligibilityRule,
  // Schedule rating (Brief 15)
  Schedule,
  ScheduleCategory,
  ScheduleApplication,
  ScheduleApplicationEntry,
  ScheduleApplicationSource,
  AppliedScheduleCategory,
  // UW Report (Brief 7)
  UwReport,
  UwAdjustment,
  UwReportSource,
  AppliedReportAdjustment,
  // Diff library (Brief 12)
  DiffNode,
  DiffState,
  DiffSummary,
  DiffSide,
  DiffDeeplink,
  RateImpact,
  PlanDiff,
  TraceDiff,
  RunDiff,
  // Issues + collectIssues (Brief 13)
  Issue,
  IssueSeverity,
  IssueSource,
  IssueLocation,
  IssueFixHint,
  IssueSeverityCounts,
  FilingReadiness,
  CollectIssuesInput,
  ConformanceVectorResult,
} from "@openrater/contracts";

export function compilePlan(
  plan: Plan,
  registry?: KindRegistry,                // defaults to globalRegistry
): CompiledPlan
export function runPlan(
  compiled: CompiledPlan,
  externalInputs: Record<string, unknown>,
  options?: RunOptions,                   // { as_of?: string; classLibrary?: ClassLibrary }
): RunResult
export function executePlan(
  plan: Plan,
  externalInputs: Record<string, unknown>,
  options?: RunOptions,
  registry?: KindRegistry,                // forwarded to compilePlan
): RunResult
export function runPlanBatch(
  compiled: CompiledPlan,
  externalInputsArr: readonly Record<string, unknown>[],
  options?: RunOptions,
): readonly RunResult[]
export function executePlanBatch(
  plan: Plan,
  externalInputsArr: readonly Record<string, unknown>[],
  options?: RunOptions,
  registry?: KindRegistry,                // forwarded to compilePlan
): readonly RunResult[]

// Registry — isolated instance API for multi-tenant / sandboxed runs
export class KindRegistry {
  register<P, I, O>(kind: BlockKind<P, I, O>): void
  get(id: string): BlockKind | undefined
  list(): readonly BlockKind[]
  listByCategory(category: BlockCategory): readonly BlockKind[]
  findAcceptingType(typeId: string): readonly BlockKind[]
  clear(): void
}

/** The default, process-shared registry. Operates on the module-level functions below. */
export const globalRegistry: KindRegistry

// Convenience wrappers — operate on globalRegistry, kept for backwards compat
export function registerBlockKind<P, I, O>(kind: BlockKind<P, I, O>): void
export function getBlockKind(id: string): BlockKind | undefined
export function listBlockKinds(): readonly BlockKind[]

// Opt-in: register the V0 kind set bundled with this engine (into globalRegistry)
export function registerBuiltinKinds(): void
```

`registerBuiltinKinds()` is the recommended setup call for any
integrator who wants to use the bundled kinds. It registers all **37**
kind IDs at once into `globalRegistry` and throws on duplicate
registration (the authoritative list is the `registerBlockKind(...)`
calls in `packages/contracts/src/kinds/index.ts` — count the code, not
this prose). The original core set was:

  - 20 V0 kinds (the 18 canonical families from Plan Format Spec v1
    §4.5, plus `model.rating` as the companion to `model.glm`, plus
    `unknown` as the forward-compat placeholder).
  - 2 Phase B M1.2 additions:
    - `input.class_exposure` (Brief 16) — resolves to the bound
      class's declared exposure value at execute time. Requires
      `RunOptions.classLibrary` to be set; the runtime special-cases
      this kind in the same path as `input` + `input.source`.
    - `chain.lob_sum` (Brief 17) — sums all coverage premiums for a
      single line of business via a cardinality-N input port. Pure
      execute; no runtime special-casing.
  - 2 Phase B M1.3 additions:
    - `eligibility.gate` (Brief 10) — produces a tier verdict
      (`preferred` / `standard` / `submit` / `decline`) by walking
      an ordered rule list against `ctx.externalInputs`. First match
      wins; falls back to `default_tier` when nothing matches.
    - `modifier.schedule` (Brief 15) — judgment-driven schedule
      rating evaluator. Accepts a `ScheduleApplication` via its
      input port + an optional tier; computes a cumulative factor
      with per-category cap clamping + filed total cap enforcement
      + per-category reasoning verbatim into the trace.
  - 2 Phase B M1.4 additions:
    - `uw.report` (Brief 7) — sources a structured UwReport
      (AI/API-driven underwriting evidence) from `ctx.externalInputs`.
      Returns `{ report: null }` when missing or malformed; downstream
      kinds handle null gracefully.
    - `chain.from_report` (Brief 7) — expands a UwReport's adjustments
      into a cumulative multiplicative factor. Defaults to
      `require_acceptance: true` (the no-gimmicks line: AI suggestions
      don't apply without explicit underwriter acceptance). Optional
      `category_filter` + `total_cap_pct`.

Integrators who want a CUSTOM kind set instead just call
`registerBlockKind()` themselves and skip `registerBuiltinKinds()`
entirely.

### 1.1 Isolated registries (multi-tenant + sandboxed runs)

By default everything operates on the process-shared `globalRegistry`.
For scopes that need their own kind set — multi-tenant SaaS, sandboxed
plan execution, hermetic tests — construct a `KindRegistry` instance
and pass it to `compilePlan` / `executePlan` / `executePlanBatch`:

```ts
import { KindRegistry, compilePlan, executePlan } from "@openrater/contracts";

const tenantRegistry = new KindRegistry();
tenantRegistry.register(StandardConstantKind);
tenantRegistry.register(StandardOutputKind);
tenantRegistry.register(TenantCustomLookupKind);  // not in globalRegistry

const compiled = compilePlan(tenantPlan, tenantRegistry);
const result  = executePlan(tenantPlan, externalInputs, undefined, tenantRegistry);
```

Three properties the runtime enforces:

1. **Compile-time validation runs against the supplied registry.** If
   the plan references a kind that's only in the global, the compile
   throws `unknown-kind` — there's no silent fallback.
2. **`CompiledPlan.registry` pins the kind set.** Once a plan
   compiles against registry A, subsequent runs use registry A even
   if the global mutates between compile + run. No drift.
3. **Subplans inherit the parent's registry.** A `subplan` node
   compiled inside an isolated scope recursively compiles its inner
   plan against the same isolated registry — no capability leak.

These types from `@openrater/contracts` are **stable**:

- `Plan` — the input format
- `PlanNode`, `PlanEdge`, `PlanTestCase`, `PlanCitation` — sub-shapes of a Plan
- `CompiledPlan` — output of `compilePlan`, input to `runPlan`
- `RunResult` — output of `runPlan` / `executePlan`
- `TraceEntry` — one per-node trace record on `RunResult.trace` (see §4)
- `RunOptions` — `{ as_of?: string; classLibrary?: ClassLibrary }` (see §7 for `as_of`; Brief 16 for `classLibrary`)
- `ClassLibrary`, `ClassLibraryEntry` — runtime handle for class-conditional exposure (Brief 16)
- `makeClassLibrary(entries)` — convenience factory returning a frozen Map-backed `ClassLibrary`
- `EligibilityTier`, `EligibilityOp` — closed vocabularies (Brief 10)
- `Schedule`, `ScheduleCategory`, `ScheduleApplication`, `ScheduleApplicationEntry`, `ScheduleApplicationSource`, `AppliedScheduleCategory` — schedule rating shapes (Brief 15)
- `EligibilityRule` — one rule in an `eligibility.gate` (Brief 10)
- `evaluateEligibilityComparator(op, left, right)` — pure comparator evaluator
- `UwReport`, `UwAdjustment`, `UwReportSource`, `AppliedReportAdjustment` — UW Report shapes (Brief 7)
- `isUwReport(value)` — pure type guard at the runtime boundary
- `DiffNode`, `DiffState`, `DiffSummary`, `DiffSide`, `DiffDeeplink`, `RateImpact` — diff tree types (Brief 12)
- `PlanDiff`, `TraceDiff`, `RunDiff` — top-level diff results (Brief 12)
- `diffPlans(a, b, sides?)` — structural diff of two Plan objects
- `diffTraces(a, b, sides?, options?)` — per-step trace diff with first-divergence detection (optional `topoOrder` for execution-order divergence)
- `diffRuns(a, b, sides?, options?)` — full run comparison including outputs + trace + total premium impact
- `Issue`, `IssueSeverity`, `IssueSource`, `IssueLocation`, `IssueFixHint` — diagnostic shapes (Brief 13)
- `IssueSeverityCounts`, `FilingReadiness` — aggregate verdict shapes
- `CollectIssuesInput`, `ConformanceVectorResult` — collectIssues parameters
- `collectIssues(plan, input?)` — pure aggregator across 5 sources (compile / runtime / authoring / reference / conformance)
- `deriveIssueId(...)` — stable deterministic id (`iss_<8-hex>`)
- `rankIssues(a, b)`, `countSeverities(issues)`, `filingReadiness(issues)`, `defaultFilingBlocking(severity, source)` — helpers
- `PlanCompileError extends Error` — thrown by `compilePlan`; carries `.errors: readonly CompileError[]` for structured extraction
- `CompileError` — error category surfaced by `compilePlan`
- `BlockKind<P, I, O>` — the runtime contract for a kind (no React)
- `PortSpec`, `PrimitiveType`, `TypeRef`, `BlockCategory`, `BlockSize` — port + type vocabulary
- `ExecuteContext` — what the runtime passes to `kind.execute()` as the 3rd arg
- `ValidationIssue`, `ValidationResult` — what `kind.validate()` returns
- `Jacobian` — what `kind.jacobian()` returns (optional)

Everything else (per-kind param shapes — `MathOpParams`, `DirectLookupParams`,
etc. — are re-exported for convenience but their internals can evolve
with semver-minor bumps as kinds add params), the React components,
the entity hooks in rate-lab, are **internal**. Don't depend on them.

---

## 2. Input shape — `Plan`

A `Plan` is a typed DAG of blocks. Minimum-viable structure:

```ts
{
  id: "meridian.bop.ne.2026",  // globally unique
  version: "1.0.0",             // semver
  name: "Meridian Shopfront BOP — NE 2026",
  // (Historical note: a `lines: LineCode[]` multi-LOB field shipped
  // with Brief 17 and was DELETED in the ADR-0033 axis cleanup — the
  // product axis lives on the persisted plan, and the engine never
  // reads it. Plans may carry an optional legacy `line: string`; the
  // runtime ignores it.)
  effective: "2026-07-01",      // optional, ISO 8601
  nodes: [
    { id: "k", kind: "constant",
      params: { value: 1.25, type: "factor" },
      position: { x: 0, y: 0 } },
    { id: "out", kind: "output",
      params: { fieldName: "factor", fieldType: "float" },
      position: { x: 200, y: 0 } },
  ],
  edges: [
    { from: { node: "k", port: "value" },
      to:   { node: "out", port: "value" } },
  ],
}
```

Authoritative type definition: `Plan` in `packages/contracts/src/plan-types.ts`.

**Invariants the integrator must honor** (compile fails otherwise):

- Every `node.id` is unique within the plan
- Every `edge.from.node` and `edge.to.node` refers to a node that
  exists in the plan
- Every `node.kind` is a registered block kind. The bundled V0
  registry (`registerBuiltinKinds()`) carries the 18 canonical
  families documented in Plan Format Spec v1 §4.5 (20 kind IDs:
  the families plus `model.rating` as the convenience companion
  to `model.glm`, plus `unknown` as the forward-compat placeholder).
- The graph is acyclic (the compiler runs Kahn's algorithm; any
  cycle is rejected — including recursive `subplan` references
  caught during compile of the inner plan).
- **Product axis (ADR-0033):** the runtime `Plan` carries NO product/LOB
  axis the engine reads. A plan's product (`product: ProductCode`) lives
  on the persisted plan record for catalog/composition/analytics, never in
  the projected runtime Plan; the engine treats `product` as an opaque tag
  and never branches on it (§0 Genericity invariant). The legacy
  `plan.line` field is an optional free-text shim the engine ignores; the
  multi-LOB `plan.lines: LineCode[]` array + the `getPlanLines` helper were
  removed when multi-product moved to Policy composition (ADR-0034).

Optional fields the engine ignores at runtime but persists
verbatim through the trace:

- `node.position` — visual hint
- `node.size`, `node.label` — visual hints
- `plan.citations` — filing references
- `plan.testBench` — bundled test cases

---

## 3. External inputs shape

The second argument to `runPlan` / `runPlanBatch` is a record
keyed by `input` node `fieldName`:

```ts
const externalInputs = {
  tiv: 500_000,
  construction_class: "frame",
  occupancy_type: "office",
};
```

How resolution works:

- For each node of kind `input` or `input.source`, the runtime
  looks up `externalInputs[params.fieldName]`
- If found, that value is the node's output
- If not found, the runtime uses `params.defaultValue` (when the
  kind carries one — `input.source` does, `input` does not)
- If neither, the output is `undefined` — downstream blocks
  receive `undefined` as the input on that port

Type coercion is **narrow and unambiguous only** (Brief 83.4). At an
input node whose port declares a numeric type (`money`/`number`/
`factor`), a clean numeric string coerces — `"500000"` becomes
`500000` — and a boolean port maps the canonical `true`/`false`
spellings; this is what lets CSV rows, HTML forms, and integrators
whose fact values are `string | number` rate identically to typed
callers. Everything else passes through untouched so the consuming
node names the problem, and a value with no numeric meaning on a
numeric port (`null`, `[]`, `{}`, a boolean, a non-numeric string)
is treated as absent — the arithmetic nodes emit a non-finite result
that the output backstop WITHHOLDS rather than improvising a premium
(ADR-0056; audit A-2026-07-12 P1-01). Broader type-mismatch
validation is still the authoring layer's job (call
`validatePlanReferences()` from `@openrater/contracts` upstream of the
runtime).

---

## 4. Output shape — `RunResult`

```ts
interface RunResult {
  outputs: Record<string, unknown>;     // keyed by output node fieldName
  trace: Record<string, TraceEntry>;    // keyed by node.id
  startedAt: number;                    // epoch ms
  durationMs: number;
  as_of: string;                        // resolved temporal anchor
  eligibility_tier?: EligibilityTier | null;  // resolved appetite verdict;
                                        //   null when the plan has no gate.
                                        //   A `refer`-policy lookup miss
                                        //   escalates to ≥ `submit` (§5.4)
  issues?: readonly RowIssue[];         // structured refusals + qualifications,
                                        //   aggregated from the trace (§5.4).
                                        //   Absent (not empty) on a clean run
  row_status: "ok" | "error";           // "error" ⇔ any severity-"error" issue;
                                        //   an error row has NO trustworthy
                                        //   premium (§5.4)
}

interface TraceEntry {
  kindId: string;                       // echoes node.kind
  inputs: Record<string, unknown>;      // what fed each port
  outputs: Record<string, unknown>;     // what each output port produced
  citation?: string;                    // node.params.citation ?? kind.citation
  explanation?: string;                 // kind.explainStep() output, if any
  error?: { message: string; at: "execute" };  // present when execute() threw
  issues?: readonly RowIssue[];         // this node's structured issues (§5.4)
  skipped?: boolean;                    // node never executed: its reserved
                                        //   `__guard__` port resolved falsy
                                        //   (e.g. coverage not elected).
                                        //   Outputs {}; absent on executed nodes
}
```

`outputs` is the integrator-facing surface — quote the actuary sees.
`trace` is the audit surface — full node-by-node values **plus** the
self-describing metadata an auditor needs to read a single entry
without joining back to the source Plan:

- **`kindId`** echoes `node.kind` so consumers don't have to look up
  the Plan to know what ran. If a Plan referenced an unregistered
  kind, that node is silently skipped and has no trace entry.
- **`citation`** is propagated from `node.params.citation` first,
  falling back to `kind.citation`. A factor whose lookup table cites
  "Meridian BOP Filing 2026, Rate Pages p.12" surfaces that citation
  on every trace entry the table contributes to. Absent when neither
  node nor kind sets one.
- **`explanation`** is the kind's actuary-language one-liner from
  `kind.explainStep(inputs, params, outputs)`. Captured at run time
  with the actual values so the trace remains replayable without
  re-running. Absent when the kind doesn't implement `explainStep`.
- **`error`** is populated when `kind.execute()` threw. The run does
  NOT abort — downstream nodes still execute, seeing the failed
  node's outputs as `{}` (per-port reads resolve to `undefined`).
  Today the only `at` value is `"execute"`; future runtime
  validation may add more.

For batch runs (`runPlanBatch`), the return is `readonly RunResult[]`
in the same order as the input array. One result per input record.

Subplan tracing: a node of kind `subplan` produces a top-level trace
entry under its own id, plus nested entries under
`${parentId}/${innerId}` for every node in the inner plan. This lets
audits drill into composite plans without losing the surface.

### 4.1 Authoring `explainStep`

Implementing `explainStep` on a `BlockKind` is the way to make the
trace panel readable. The signature:

```ts
explainStep?: (inputs: I, params: P, outputs: O) => string
```

Conventions, from the V0 cold-test kinds:

- Actuary-readable prose, not engineer syntax. *"Classified `73912` → 1.32"*
  beats *"table[key]=1.32"*.
- One line. No newlines, no markdown. The trace UI owns layout.
- Cite the operation + the values that drove it. *"1000 × 1.10 (LCM)
  × 0.95 (disc) × 1.32 (load) = 1379.4"* tells the auditor the
  factors AND their names AND the result.
- Flag fallbacks explicitly. *"`exotic` not in table → 1 (default)"*
  beats silently returning the default.
- MUST NOT throw. The runtime wraps the call in a try/catch — a
  throwing `explainStep` is silently dropped from the trace, which
  hides the kind's audit contribution.
- Same inputs + params + outputs → same string. Don't include
  timestamps, random IDs, or other non-deterministic content.

`explainStep` is optional. Kinds that don't implement it produce
trace entries with no `explanation` field; the UI falls back to
showing the raw inputs/outputs.

---

## 5. Error categories

### 5.1 Compile errors

`compilePlan` throws on validation failure. The thrown `Error`
has a message of the form:

```
Plan does not compile:
  · {message 1}
  · {message 2}
  · …
```

Each underlying `CompileError` has a `kind`:

| `kind`                  | When it fires                                                       |
| ----------------------- | ------------------------------------------------------------------- |
| `unknown-kind`          | A `node.kind` is not in the registered block-kind registry          |
| `cycle`                 | The graph has at least one cycle (topo sort failed)                 |
| `missing-edge-target`   | An edge's `from.node` or `to.node` references a non-existent node   |
| `duplicate-node`        | Two nodes share the same `id`                                       |
| `unwired-input`         | Reserved for future use — required input port with no incoming edge |

Each `CompileError` carries the `message` text + optional `nodeId`
(when the error is about a specific node) + optional `port` (when
the error is about a specific port on a node).

### 5.2 Runtime errors

`runPlan` does **not** throw — neither on bad data NOR on a kind
that throws during execute. Every run produces a `RunResult`. The
integrator inspects it for:

- **`row_status` + `issues`** — the primary signal (§5.4).
  `row_status: "error"` means the plan could not rate this input;
  treat the row as having **no premium**, and render the issues.
  Warnings qualify a premium that stands.
- **Withheld numeric outputs**: a numeric-typed output
  (`money`/`number`/`factor`) that failed to resolve is **absent
  from `result.outputs`** — never present as `NaN` — with a paired
  `unresolved_output` error issue naming the field (§5.4). Lenient
  input data (intake samples, mid-quote estimates) still flows
  through as `undefined` on intermediate ports.
- **Per-node failures**: walk `result.trace` for entries with an
  `error` field — those nodes threw during execute (see §5.3 for
  the details + a one-liner detection snippet).
- **Per-node `undefined` / `NaN`**: inspect `result.trace[nodeId].outputs`
  to find which step in the chain produced a bad value.

To prevent broken plans from reaching the runtime in the first
place, call the authoring-time validator
(`validatePlanReferences()` from `@openrater/contracts`) upstream.

The reason the runtime is lenient: a re-rating engine is often
asked to run plans that may have incomplete data. Throwing on every
missing field would make those use cases impossible. Strict
validation is opt-in at the authoring layer where it belongs.

### 5.3 Block-kind execution errors

If a block kind's `execute(inputs, params, ctx)` throws, the runtime
catches the exception and writes it onto the failing node's trace
entry as `{ error: { message, at: "execute" } }`. The run continues:

- `nodeOutputs` for the failing node becomes `{}`.
- Downstream nodes still execute; their inputs read `{}.port` which
  resolves to `undefined`.
- The collected `result.outputs` for any output that depended on the
  failure ends up `undefined`.
- The whole `RunResult` is returned to the caller. The caller is
  responsible for inspecting `result.trace` for `error` entries and
  surfacing them.

This is intentional: the trace is the canonical audit surface, so
a failure with a trace + downstream `undefined`s is more debuggable
than a top-level exception that unwinds the run. To detect failures
programmatically:

```ts
const failures = Object.values(result.trace).filter((e) => e.error);
if (failures.length > 0) { /* surface to the user */ }
```

The block-kind execute contract still states that kinds SHOULD
return values (including `undefined`) rather than throw — throwing
is the right behavior for *bugs* (a clamp called without bounds, a
divide by zero), not for *missing data* (which should propagate as
`undefined` through normal output ports).

### 5.4 Structured issues — refuse or resolve, never improvise

*(Normative. This section records the platform's accepted decision of
2026-07-06 — internally "ADR-0056" — as contract text; the issue
vocabulary lives in `@openrater/contracts` `plan-issues.ts`.)*

The engine's honesty law: **an input the plan can't rate must be a
visible, structured error — never a silent neutral factor, never a
plausible premium.** The contract enforces a three-way distinction
that every consumer (UI, batch ledger, API) must preserve:

| Outcome | Meaning | Premium | Accounting |
| --- | --- | --- | --- |
| **Error** | The plan **cannot rate** this input (unknown key under `error` policy, unresolved output, compile failure). Nobody decided anything. | **None.** Never a number, never $0. | Its own `error` facet — excluded from written AND declined totals. |
| **Decline** | The plan **rated and refused** — an authored eligibility verdict. | Indicative premium may exist. | Declined-indicative. |
| **$0** | The plan **rated to zero** — real arithmetic produced 0. | $0, written. | Written. |

Precedence when facets collide on one row: **error > decline > ok**.

**Two issue species, one severity scale** (`"error"` blocks/would
corrupt a premium; `"warning"` = an authored or structural resolution
was applied and the premium stands, visibly qualified):

- **`ProjectionIssue`** — *plan-shaped*, produced at
  projection/compile time, before any row is scored ("factor table
  `sprinkler_rel` has no cells"). Carries `code`, `message`, and
  structured `ref` pointers (table/dim/field/coverage/stageKind).
- **`RowIssue`** — *row-shaped*, produced at run time, one row
  meeting one node ("class code `62114` not in `prop_rate_number`").
  Lands on the emitting node's `TraceEntry.issues` and aggregates
  onto `RunResult.issues`; any severity-`error` issue makes
  `row_status: "error"`.

**The per-lookup unknown-key policy.** Every authored factor lookup
carries a policy for keys that don't resolve (a missing raw input, an
unmapped territory, a class code absent from the table all arrive
here). Modes, projected onto the lookup node as `onMiss`:

- **`error`** (the authoring default) — the row is refused: code
  `unknown_key`, `row_status: "error"`, no premium. An unknown class
  code is a refusal, not a neutral factor.
- **`default(x)`** — factor = `x`, with a `warning` issue
  (`unknown_key_defaulted`, `detail.appliedValue = x`). This is the
  honest form of the filed table's real "All other classes → 1.00"
  row: authored data, visibly applied — not an accident.
- **`refer`** — factor = 1.0 (indicative), `warning` issue
  (`unknown_key_referred`), and the run's `eligibility_tier`
  escalates most-restrictive-wins to at least `submit` — a referral
  IS an eligibility signal. The premium renders as indicative, never
  as written-without-qualifier.

Structural lookups the projector emits as internal mechanism
(when-match selectors, predicate gates) never carry `onMiss` — a
non-matching row is their normal case. Raw hand-built plans that
omit `onMiss` keep the kinds' historical `defaultValue` behavior
(published conformance vectors pin it); every plan produced through
the authoring boundary gets the `error` default stamped explicitly.

**The unresolved-output backstop.** When collecting a numeric-typed
output (`money`/`number`/`factor`) whose value is `undefined`, `NaN`,
or non-finite, the runtime **withholds the field from `outputs`
entirely** and appends an `unresolved_output` error issue naming it.
Whatever failed upstream, a non-number never leaves the engine
looking like a premium — not even as `NaN` (which JSON serialization
would silently mangle).

**Batch + policy semantics.** `runPlan` never rethrows kind errors,
so one poisoned row can never abort a book. Policy composition
excludes `row_status: "error"` rows from rollup sums and marks the
policy result with an error facet — a policy containing an
unrateable location is itself unrateable, its composed total
withheld.

**The code registries (machine-stable, append-only).** Retiring a
code requires updating the conformance vector that pinned it in the
same change; retired codes stay in the type for old persisted
payloads.

| Species | Codes |
| --- | --- |
| Projection | `factor_table_missing` · `factor_table_empty` · `coverage_slice_empty` · `table_unkeyable_2d` · `range_levels_unusable` · `lookup_unkeyed` · `predicate_dropped` · `stage_not_executed` · `chain_missing_base` · `package_scope_fallback` *(retired from emission 2026-07-10)* · `multi_gate_tier_first_wins` · `orphan_stage` · `plan_compile_failed` · `grouping_missing_rollup` · `round_output_nonstandard` · `grouping_column_missing` · `endorsement_additive_multi_tower` |
| Row | `unknown_key` · `unknown_key_defaulted` · `unknown_key_referred` · `territory_unmapped` · `class_attribute_missing` · `band_out_of_range` · `missing_input` · `unknown_input` · `unresolved_output` · `composition_failed` · `zero_exposure_required` |

Conformance vectors may pin `expectedRowStatus` and `expectedIssues`
(matched on `{nodeId, code, severity}` subsets, so message copy can
evolve without breaking vectors).

---

## 6. Reproducibility guarantee

Per Plan Format Spec v1 §9: **running the same plan against the
same inputs twice produces byte-identical outputs and traces.**

In practice this means:

- The engine is deterministic. No `Math.random()`, no `Date.now()`
  inside the execution path. Wall-clock times (`startedAt`,
  `durationMs`) are the only fields that differ run-to-run, and
  they are explicitly carved out of the "byte-identical" guarantee.
- The topological execution order is stable for a given plan
  (Kahn's algorithm with insertion-order tie-breaking).
- Floating-point math uses standard IEEE-754 doubles. Outputs are
  bit-stable across platforms that honor IEEE-754 (essentially all
  modern hardware).

What this means for integrators:

- Caching: a `(plan.id + plan.version + externalInputs)` cache key
  is safe. Same inputs → same outputs forever (until the plan
  changes).
- Replay: persisted traces can be re-validated against new engine
  versions by re-running and comparing. Any divergence is either
  a bug in the new engine OR an explicit, documented behavior
  change in the changelog.
- Conformance porting: a non-TypeScript port (Python, Go, Rust)
  that passes the conformance suite produces the same outputs as
  the TypeScript bundle, byte-for-byte.

The conformance suite (Section 8) enforces this with explicit
"run twice, compare equality" assertions.

---

## 7. `as_of` — temporal anchoring

For re-rating against historical filed rates, the runtime accepts
an optional `as_of` parameter:

```ts
runPlan(
  compiled,
  externalInputs,
  { as_of: "2024-03-15" },   // ISO 8601 date
)
```

Semantics:

- `as_of` is a **plan-time anchor**: it pins which version of a
  rate table, curve, or other time-varying resource a block kind
  consults during execution. Block kinds that are time-aware
  (factor tables with effective ranges, future per-state filings)
  consume it via `kind.execute(inputs, params, { as_of })`.
- When omitted, `as_of` defaults to "now" (today's date in UTC).
- When the plan is itself dated (`plan.effective` is set),
  `as_of` MUST be on or after `plan.effective`. Runtime does not
  enforce this — integrators MAY add a validation layer.
- `as_of` is part of the reproducibility key: caching layers MUST
  include it. Two runs with the same `(plan, externalInputs)`
  but different `as_of` may legitimately produce different outputs.

Today, no bundled block kind consumes `as_of` (the runtime threads
it through as a no-op via the `ExecuteContext` 3rd argument that
every `kind.execute()` receives). The parameter is **shipped now**
so that when time-aware kinds land (effective-dated factor tables,
state-filing version pinning), no integrator has to change their
call site. This is intentional API forward-compat.

---

## 8. Conformance verification

The canonical proof that an integration is contract-compatible is
the conformance suite. Portable JSON fixtures + the vitest runner
that exercises them ship together inside `@openrater/contracts`:

- Runner: `packages/contracts/src/__tests__/conformance.test.ts`
- Fixtures: `packages/contracts/src/__tests__/conformance/V*.json`
- README: `packages/contracts/src/__tests__/conformance/README.md`
  (schema, encoding rules — notably the `1e308` sentinel for
  open-top range buckets — and how to add a vector)
- CI: the `conformance` job in `.github/workflows/ci.yml` runs the
  suite on every PR. The job runs ONLY the conformance file so a
  third-party port can compare its results against a single CI
  badge without installing or understanding the rest of our test
  infra.

The fixtures encode: plan + externalInputs + expectedOutputs.
Any runtime that consumes a fixture, executes the plan, and
matches the expected outputs (byte-for-byte) is contract-compatible
for that vector. The same JSON schema is documented in the README
for non-TypeScript ports.

The suite ships **49 wired vectors** (V1–V61; some numbers are
unclaimed — names, not numbers, are the stable identifier; the
authoritative count is the manifest's `engine_vectors` length, which
this prose tracks but does not define — audit A-2026-07-12 P5-03
caught it three revisions stale). The
wired set is declared ONCE in
`packages/contracts/src/__tests__/conformance/manifest.json`: the
engine runner asserts its import list matches the manifest exactly,
and the scoring-service parity suite LOADS its list from the same
manifest — one source, zero drift (P2 G20 / ADR-0056). ADR-0056 also
added `expectedRowStatus` / `expectedIssues` /
`expectedEligibilityTier` as optional vector fields — a vector can
now pin that an input REFUSES (structured row issues, withheld
outputs), not just what it computes. The baseline 7 cover the core
engine:

| Vector | File | What it proves |
| ------ | ---- | -------------- |
| V1 | `V1.trivial-constant.json` | Registry resolution, output collection (the smallest possible plan: constant → output) |
| V2 | `V2.input-passthrough.json` | External input substitution (`externalInputs[x]` → `input` node → `output`) |
| V3 | `V3.chain-mult.json` | Multiplicative chain composition (`base × [1.10, 0.95, 1.32]` = 1379.4 — fan-in cardinality 'N') |
| V4 | `V4.lookup-direct-known.json` | Direct factor-table lookup (`class_code` → factor) |
| V5 | `V5.lookup-range-middle-bucket.json` | Bucketed range lookup with boundary case (`TIV=$500k` → middle bucket `1.00`) |
| V6 | `V6.subplan-composition.json` | Composite plan recursion + nested trace (outer plan calls inner doubler: `21 → 42`) |
| V7 | `V7.bop-like-end-to-end.json` | Realistic small BOP-like rating: class lookup × TIV band × LCM = premium 1504.8 |

The **geographic family** (V21–V23, V39–V40) locks the canonical geographic-dimension lookup domain (Plan Format Spec §6.2.1 / ADR-0028 / ADR-0038). `derive.territory` resolves a raw geographic value (a level id OR a territory id — idempotently) onto the dim's lookup key before a territory-keyed `lookup.direct`; an unmapped value surfaces `unmapped: true` and scores at the lookup default (never silently wired to 1.0 without the diagnostic):

| Vector | File | What it proves |
| ------ | ---- | -------------- |
| V21 | `V21.geographic-dim.json` | A geographic dim with no territories rates directly on its levels (`state=WI` → 1.10) |
| V22 | `V22.derive-territory.json` | Territory grouping drives scoring: `state=CA` → `derive.territory` → `T1` → 1.30 |
| V23 | `V23.derive-territory-unmapped.json` | A value in no territory → `unmapped:true`, scores at the 1.0 default |
| V39 | `V39.derive-territory-zip.json` | ZIP-granularity rollup (the Sample BOP shape): `zip=66101` → `701` → 1.20 |
| V40 | `V40.derive-territory-ungrouped-tail.json` | Mixed model: an ungrouped level self-maps and rates on itself (`67999` → 1.05), not the 1.0 default |

The runner asserts three things per vector:

1. **Schema** — every loaded vector has the required `name`,
   `description`, `plan`, `externalInputs`, `expectedOutputs`
   fields; names are globally unique.
2. **Correctness** — `executePlan(v.plan, v.externalInputs).outputs`
   deep-equals `v.expectedOutputs`.
3. **Reproducibility** — running the same `compiled` plan twice
   with the same `externalInputs` + the same `as_of` produces
   byte-identical outputs AND byte-identical trace (modulo the
   wall-clock fields the trace doesn't store).

To add a vector: drop a `V{n}.{slug}.json` file in
`packages/contracts/src/__tests__/conformance/`, add a matching
`import` line in `conformance.test.ts`, push it onto the `VECTORS`
array, AND list its stem in `conformance/manifest.json` — the
lockstep assertion (engine) and the parity suite (scoring service)
both read the manifest, so forgetting it fails loudly. PRs touching
the bundled runtime or any V0 kind MUST keep the suite green.

Vectors don't need to be numbered contiguously — names are the
stable identifier; `V8.X` can ship before `V8.Y` lands.

---

## 9. Versioning policy

The engine package follows **semver**:

- **Major** (X.0.0) — breaking changes to the public API surface
  (Section 1) OR to the reproducibility guarantee (Section 6).
  Outputs may legitimately differ from the prior major.
- **Minor** (1.X.0) — additive changes (new block kinds, new
  optional parameters, new fields on `RunResult`). Old code keeps
  working unchanged.
- **Patch** (1.0.X) — bug fixes that bring runtime behavior closer
  to the documented contract. Outputs SHOULD NOT change for any
  plan that was already passing the conformance suite. If they
  must, the patch notes call it out explicitly.

The conformance suite is the safety net: if an engine release
breaks the suite, it's a bug — either in the release or in the
suite — and one of the two has to change before the release ships.

---

## 10. Out of scope

The engine deliberately does NOT provide:

- **HTTP transport**, queue plumbing, or any I/O. Integrators
  layer those on top.
- **Authentication, authorization, rate limiting**. Same.
- **Persistence of plans or quotes**. The runtime is pure; the
  consuming application owns storage.
- **Plan authoring UI**. That's [Rate Lab](../../rate-lab/), which
  is bundled but is a separate product surface from the engine
  itself. Integrators may embed Rate Lab OR build their own
  authoring UI on top of the `Plan` type.
- **Strict input validation at runtime**. See §5.2.
  `validatePlanReferences()` from `@openrater/contracts` covers
  authoring-time broken-reference detection (dimensions, factor
  tables, curves, coverage chains, input sources) — call it from
  your authoring layer, not from the runtime.

These boundaries are intentional. The engine stays small and
verifiable; the OSS plug-ins above it own the rest.

---

## Changelog

- **2026-07-17** — **Documented the shipped refusal contract.** §4's
  `RunResult`/`TraceEntry` listings now include `eligibility_tier`,
  `issues`, `row_status`, and `skipped` (all shipped earlier as
  additive fields); §5.2's inspection guidance leads with
  `row_status`/`issues` and the withheld-output behavior; new §5.4
  records the structured-issues decision (internally "ADR-0056") as
  normative contract text, with the current append-only code
  registries. No runtime behavior changed — this is the spec
  catching up to the implementation.

- **2026-05-19** (PR 2) — **Isolated registries.** Introduced
  `KindRegistry` class + `globalRegistry` default instance. Added an
  optional `registry?: KindRegistry` parameter to `compilePlan`,
  `executePlan`, and `executePlanBatch`; `CompiledPlan` now carries
  the registry it was compiled against (so `runPlan` can never drift
  from compile-time validation). Subplan recursion inherits the
  parent's registry. The pre-class module-level functions
  (`registerBlockKind` / `getBlockKind` / `listBlockKinds` /
  `listBlockKindsByCategory` / `findKindsAcceptingType` /
  `_clearRegistryForTests`) remain — they now operate on
  `globalRegistry`. Backwards-compatible: every existing call site
  continues to work without change. Added 10 tests verifying global
  vs isolated separation, including a "compiled-against-A, global-
  mutated-to-B, A still wins" test. Closes the multi-tenant footgun
  flagged in the 2026-05-19 architecture audit.

- **2026-05-19** (PR 1) — **Enriched trace contract.** `TraceEntry`
  is now a named exported type carrying `kindId` + `citation?` +
  `explanation?` + `error?` alongside the existing `inputs` / `outputs`
  fields. Added `kind.explainStep(inputs, params, outputs) → string`
  to `BlockKind` (optional). The runtime catches throws from
  `execute()` and writes them onto the trace as `{ error: { message,
  at: "execute" } }` instead of unwinding the run — downstream nodes
  still execute, seeing `undefined` from the failed port. §4 fully
  rewritten with the new shape + the explainStep authoring
  conventions; §5.2 + §5.3 updated to reflect that runs never throw.
  10 of the 20 V0 kinds (the cold-test path) now implement
  `explainStep`. No breaking changes to the `outputs` shape — only
  additive fields on trace entries.

- **2026-05-19** — Re-pointed to `@openrater/contracts` (the substrate
  detached from the original prototype repo). All
  paths under §"Source of truth", §1 (public API), §4 (Plan type
  location), §8 (conformance suite) now reference the new
  `packages/contracts/src/…` layout. Added `RunOptions` to the
  stable signatures (the `as_of` parameter was previously
  underspecified in §1). Added `registerBlockKind` + `getBlockKind`
  + `listBlockKinds` + `registerBuiltinKinds` to the public API
  surface — integrators wanting the bundled V0 set call
  `registerBuiltinKinds()`. Added `BlockKind` + `PortSpec` +
  related types to the stable types list (so integrators can
  author CUSTOM kinds against a documented contract). Replaced
  references to legacy V.22.A5 / V.22.S3 with the canonical names
  for the validators + conformance suite. Activated the conformance
  CI job — the suite runs on every PR now. No behavior changes.

- **2026-05-18** — v1 normative. Documents the V.22.S3 conformance
  suite + adds the `as_of` parameter (no-op today, forward-compat
  for V.23 time-aware kinds).
