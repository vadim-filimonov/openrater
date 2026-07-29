# Engine conformance fixtures — portable JSON

Each `V*.json` file is a self-contained conformance vector that any
compatible implementation of the OpenRater re-rating engine MUST satisfy.
The schema is intentionally minimal so a non-TypeScript port (Python,
Go, Rust, …) can consume these files with a stock JSON parser.

This is the OSS proof — third-party engines verify themselves by
running these vectors and asserting the outputs match.

## Schema

```jsonc
{
  "name": "V1.trivial-constant",       // unique vector id
  "description": "…",                   // one-line summary
  "plan": { /* Plan */ },               // see plan-types.ts
  "externalInputs": { /* record */ },   // keyed by input fieldName
  "expectedOutputs": { /* record */ },  // keyed by output fieldName
  "classLibraryEntries": [ /* … */ ],   // (optional, M1.7+) class
                                         // library for vectors using
                                         // input.class_exposure
  "asOf": "2024-01-01"                  // (optional) as_of pin;
                                         // defaults to "2024-01-01"
}
```

A run is **conformance-passing** for a vector when:

1. The engine compiles the `plan` without error.
2. The engine executes the plan with `externalInputs` and returns
   outputs that deep-equal `expectedOutputs`.
3. Running the engine twice on the same vector produces byte-identical
   outputs (per the reproducibility guarantee in
   `docs/specs/engine-contract.md` §6).

## Encoding notes

- **Infinity**: JSON doesn't have a native Infinity. Vectors that need
  an open-top range bucket use the sentinel `1e308` (effectively
  `Number.MAX_VALUE` for any realistic input). Any conformant engine
  MUST treat `1e308` as the bucket's effective upper bound —
  implementations are free to compare strictly or use Infinity
  internally; both produce identical results for any practical input.
- **Floating-point literals**: Expected output values are encoded with
  the exact IEEE-754 representation the bundled engine produces.
  Implementations comparing with strict equality (`Object.is`-style)
  MUST honor IEEE-754; lossier comparisons are not contract-compatible.

## The conformance vectors

### V0 baseline (V1-V7)

| Vector | What it proves |
|--------|----------------|
| V1.trivial-constant | constant → output (the smallest possible plan) |
| V2.input-passthrough | externalInputs[x] → input → output (input substitution) |
| V3.chain-mult | base × constants[1.10, 0.95, 1.32] = 1379.4 (chain.mult fan-in) |
| V4.lookup-direct-known | class_code → factor via lookup.direct |
| V5.lookup-range-middle-bucket | TIV $500k → middle bucket factor 1.00 (range boundary) |
| V6.subplan-composition | outer plan calls inner doubler subplan; 21 → 42 (recursion + trace nesting) |
| V7.bop-like-end-to-end | class lookup × TIV band × LCM = premium (the canonical ISO BOP shape) |

### Phase B M1 additions (V8-V15)

| Vector | Brief | What it proves |
|--------|-------|----------------|
| V8.class-exposure-primary | 16 | input.class_exposure resolves to a class's primary exposure declaration (Restaurants → sales) |
| V9.class-exposure-coverage-scope | 16 | coverage_scope routes to the alternate declaration (Concrete contractors → area when scope=property) |
| V10.chain-lob-sum | 17 | fan-in of two coverage premiums into a property-LOB total |
| V11.eligibility-first-match | 10 | first matching rule wins (WI restaurant → core_market preferred tier) |
| V12.eligibility-default-fallback | 10 | falls back to default_tier when no rule matches |
| V13.modifier-schedule-cap | 15 | per-category mods + filed cap; factor = 1 + sum/100 |
| V14.modifier-schedule-tier-filter | 15 | tier-conditional categories skipped when tier doesn't match (compose with Brief 10) |
| V15.chain-from-report-acceptance | 7 | require_acceptance: true → only accepted UW Report adjustments contribute (the no-gimmicks line) |

### Brief 39 addition (V17)

| Vector | Brief | What it proves |
|--------|-------|----------------|
| V17.endorsement-auto-attach | 39 | endorsement.factor + .additive + .sublimit auto-attach per trigger; effect math composes across the chain |

### Phase H additions (V18-V20) — IMPLEMENTED

All three vectors execute deterministically against the registered
builtins. They close Phase G's gate-runtime gap:

- V18 covers Brief 40's `endorsement.rate_branch` composition
  (BlockKind landed in Phase H.4).
- V19 covers Brief 41's `modifier.model` fallback semantics
  (BlockKind landed in Phase H.7).
- V20 covers the full Brief 42 §−1 Q1 cascade end-to-end (composed
  from kinds shipped by Phase H.3.1-H.3.3 + Brief 39).

| Vector | Brief | Status | What it proves |
|--------|-------|--------|----------------|
| V18.endorsement-rate-branch | 40 + 42 | ✓ implemented in H.4 | endorsement.rate_branch composition: trigger fires → embedded chain runs → output added to premium. Independent LCM per Brief 42 §−1 Q5 |
| V19.modifier-model-fallback | 41 + 42 | ✓ implemented in H.7 | modifier.model fallback semantics: missing declared_input → fallback_factor applied; clamp NOT evaluated. Brief 42 §−1 Q6 case 2 |
| V20.full-gate-cascade | 42 | ✓ executes after H.3.1-H.3.3 + H.4 | Full cascade in fixed order (Brief 42 §−1 Q1): eligibility.gate → chain → modifier.schedule → endorsement.{factor,additive,sublimit}. Validates the composition end-to-end (1000 × 1.05 × 1.10 + 50 = 1205, eligibility_tier=preferred, peak_sublimit metadata emitted) |

## Policy conformance vectors (`P*.json`) — ADR-0034

`V*.json` vectors prove a single **Plan** (one product's algorithm).
`P*.json` vectors prove the **composition layer above it**: a `Policy`
that references N product Plans, runs each, and sums them with a
policy-level package credit + minimum (`composePolicy`, ADR-0034).

This is the OSS proof for the composer — a third-party composition
engine verifies itself by running these and matching the build-up. The
runner is `../policy-conformance.test.ts`.

```jsonc
{
  "name": "P1.policy-compose-do-cgl",
  "description": "…",
  "policy": { /* Policy — policy_types.ts */ },
  "plans": {                       // resolution source, keyed by plan_id
    "do-plan": { "plan": { /* Plan */ }, "externalInputs": { /* … */ } },
    "cgl-plan": { "plan": { /* Plan */ }, "externalInputs": { /* … */ } }
  },
  "expected": {                    // the composed PolicyResult build-up
    "subtotal": 1200, "package_credit": 0.5, "after_credit": 600,
    "minimum_premium": 700, "minimum_applied": true, "total": 700,
    "lines": [ { "product": "do", "plan_id": "do-plan", "premium": 900 }, … ]
  }
}
```

**Genericity:** the runner builds `resolve` generically from `plans` and
never inspects a product — a `bop+auto` policy verifies through the same
runner as `do+cgl`. (ADR-0033 §0 invariant; the engine/composer never
branch on a product.)

| Vector | Proves |
|--------|--------|
| P1.policy-compose-do-cgl | sum of two product premiums × package_credit, floored at minimum_premium (the canonical Policy build-up) |

## Adding a vector

1. Create `V{n}.{slug}.json` (engine) or `P{n}.{slug}.json` (policy)
   here matching the schema above.
2. Verify the bundled engine / composer reproduces the expected values.
3. Add the `import` + push it onto `VECTORS` in the matching runner
   (`../conformance.test.ts` or `../policy-conformance.test.ts`).

Vectors don't need to be numbered contiguously — names are the stable
identifier. `V8.X` can ship before `V8.Y` lands.
