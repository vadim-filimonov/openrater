# Plan Format Spec v1 — The OpenRater Rating-Plan Data Model

| Field            | Value                                       |
| ---------------- | ------------------------------------------- |
| **Spec version** | 1.0 (draft, accepting comment until 1.0-final) |
| **Status**       | Draft                                       |
| **Created**      | 2026-05-17                                  |
| **Editor**       | Vadim Filimonov ([@vadim-filimonov](https://github.com/vadim-filimonov)) |
| **License**      | Apache-2.0                                  |
| **Tracks**       | Reference impl: `packages/contracts` (types + runtime) and `server/` (persistence + API) in this repo |

---

## 0. Status, scope, and audience

This document specifies the **OpenRater Plan Format v1** — the data model, runtime semantics, and content-addressing rules that define a OpenRater rating plan.

It is intended to be rigorous enough that an engineer who has never seen the reference implementation can build a compatible backend, a compatible UI, or a compatible analysis tool from this document alone. Where the reference implementation diverges from this spec, the spec is normative and the reference implementation is to be considered buggy.

**In scope**

- The Plan entity and its 14-section spine.
- The Block contract and the v1 set of canonical block kinds.
- The Plan DAG: nodes, edges, validation, and runtime execution.
- The sibling entities a Plan references: Coverage Chain, Dimension, Factor Table, Curve, Territory, Source / SourceUpdate.
- Content addressing — the rules that turn a Plan into a stable 16-character hash.
- The reference-and-lineage model.
- Compatibility and conformance requirements.

**Out of scope**

- The HTTP REST surface that publishes and serves Plans (covered in the REST API Spec).
- The IndexedDB / WASM SQLite embedded backend (covered in the In-Browser Backend Design Doc).
- The Model Lab, API Lab, and Data Lab data models (forthcoming sibling specs).
- The Portal application's intake and report surfaces.

**Audience**

- Implementers of compatible runtimes (e.g., a carrier wanting a JVM rater).
- Authors of tooling that reads or writes OpenRater Plans (linters, IDE plugins, diff viewers).
- Reviewers of contributed Block kinds and Curve interpolations.
- Auditors and regulators who need to understand exactly what a published Plan represents.

**Normative language**

The keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted as described in RFC 2119.

---

## 1. Glossary

| Term | Definition |
| ---- | ---------- |
| **Plan** | A typed DAG of Blocks plus a 14-section layout that maps Blocks onto the rating workflow. |
| **Block** | A node in the Plan DAG. Has a `kind` (which determines its ports and behaviour) and `params` (kind-specific configuration). |
| **Block kind** | A registered type of Block. Identified by a stable string id (e.g., `lookup-territory`). |
| **Port** | A named, typed input or output of a Block. |
| **Edge** | A directed connection between two ports. The producing port is the **source**; the consuming port is the **sink**. |
| **PlanSurface** | The 14-section spine that gives every Plan a uniform top-level structure. |
| **Section** | One of the 14 PlanSurface sections (e.g., `risk-inputs`, `rating-chains`, `curves`). |
| **Coverage Chain** | An entity that defines a multiplicative chain of factors used to rate a single coverage. |
| **Dimension** | A typed risk attribute (e.g., construction class, occupancy). |
| **Factor Table** | A multi-key lookup table that returns a factor. |
| **Curve** | A function defined by a small number of control points, evaluated via a chosen interpolation. |
| **Territory** | A named geographic region defined by a list of ZIP5s and a set of base loss costs. |
| **Source** | A catalog entry describing an external data source (vendor file, regulatory filing). |
| **SourceUpdate** | A specific dated instance of a Source ("Meridian BOP base rates, 2026Q1"). |
| **Content hash** | A 16-character SHA-256 hex prefix of the canonicalized content of an entity. The entity's stable identifier across time. |
| **Lineage** | The directed graph of producer-to-consumer references between entities. |
| **as_of** | The explicit instant at which a Plan is being evaluated. Required for determinism. |

---

## 2. Notation and conventions

### 2.1 Type notation

This document describes shapes using a compact pseudo-Zod / pseudo-Pydantic notation. The notation is illustrative; the normative shape of any entity is the combination of the prose, the canonical-JSON example, and the required field table.

```
Plan {
  rating_plan_id: string          // 1-80 chars, slug pattern
  display_name:   string          // 1-200 chars
  status:         enum            // "draft" | "proposed" | "active" | "archived"
  content_hash?:  string          // 16 hex chars, optional during draft
  ...
}
```

A trailing `?` denotes an optional field. A trailing `|null` denotes a field that may be explicitly null. A field with neither is REQUIRED.

### 2.2 Canonical JSON

When this document refers to "canonical JSON" of an object, it means the result of:

1. Recursively sorting object keys lexicographically.
2. Serializing with no insignificant whitespace.
3. Using `,` as the inter-element separator and `:` as the key-value separator (no spaces around either).
4. Preserving full Unicode (`ensure_ascii=false`).

A Python reference:

```python
import json
def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
```

This is a strict subset of RFC 8785 sufficient for the content-hashing use cases in this spec. A future revision may upgrade to full RFC 8785; implementations SHOULD treat that as a breaking change to the hash.

### 2.3 Identifiers

- All entity ids are non-empty strings matching `[a-z0-9][a-z0-9_-]{0,79}` unless noted.
- Content hashes are exactly 16 lowercase hex characters: `^[0-9a-f]{16}$`.
- Timestamps are ISO 8601 strings, UTC, with no fractional seconds: `YYYY-MM-DDTHH:MM:SSZ`.
- Dates (without times) are ISO 8601 strings: `YYYY-MM-DD`.

### 2.4 Immutability

All entities described by this spec are conceptually immutable values. A "change" is a new entity with a new content hash, not a mutation of the prior entity. Reference implementations MAY persist mutable rows in a database while exposing immutable values across the API boundary, but the wire format described here is value-typed.

---

## 3. The Plan entity

### 3.1 Plan identifier and metadata

A Plan has the following top-level fields:

| Field | Type | Required | Notes |
| ----- | ---- | -------- | ----- |
| `rating_plan_id` | string (1-80) | yes | Human-readable slug (`bop-il-2026`). Stable across content revisions. |
| `display_name` | string (1-200) | yes | Free-text title shown in UI. |
| `line_of_business` | enum | yes | One of `bop`, `cgl`, `wc`, `auto`, `umbrella`. |
| `jurisdiction` | string (2) \| null | yes | Two-letter US state code, or `null` for multistate. |
| `effective_date` | date | yes | ISO `YYYY-MM-DD`. The earliest date this Plan may be applied to a quote. |
| `description` | string \| null | yes | Free-text. May be empty string or null. |
| `parent_plan_id` | string \| null | yes | The `rating_plan_id` of the Plan this one was forked from, if any. |
| `source_filing_id` | string \| null | yes | Identifier of the regulatory filing this Plan represents, if any. |
| `template_id` | string \| null | yes | The PlanTemplate this Plan was instantiated from. |
| `coverages` | string[] \| null | yes | Coverage ids included in this Plan, frozen at creation. |
| `section_layout` | object \| null | yes | `{section_id: component_id[]}` — UI layout per section. |
| `status` | enum | yes | One of `draft`, `proposed`, `active`, `archived`. Default `draft` on creation. |
| `created_at` | timestamp | yes | UTC instant the Plan was created. |
| `last_edited_at` | timestamp \| null | yes | UTC instant of last edit, or null. |
| `content_hash` | string (16) \| null | yes | The 16-char content hash. Null only while the Plan is unsaved. |
| `dag` | PlanDAG | yes | The Block graph. See §5. |
| `entities` | EntityBundle | yes | The Coverage Chains, Curves, Territories, etc. this Plan references. See §6. |

All fields are required to be present in serialization. Optional fields use explicit `null` rather than being omitted.

`rating_plan_id` MUST be unique within a OpenRater deployment. Different content revisions of the same logical Plan share a `rating_plan_id` but have different `content_hash` values.

### 3.2 The 14-section PlanSurface spine

Every OpenRater Plan, regardless of line of business or jurisdiction, is organized into **exactly 14 sections**, in this order:

| # | Section id | Scope | Required | Purpose |
| - | ---------- | ----- | -------- | ------- |
| 1 | `risk-inputs` | plan-wide | yes | Declared inputs the rater expects (submission fields). |
| 2 | `eligibility` | plan-wide | no | Yes/no rules that decline a risk before pricing. |
| 3 | `dimensions` | line-wide | yes | Typed risk attributes (class, occupancy, etc.). |
| 4 | `territories` | plan-wide | no | ZIP-coded geographic regions and base loss costs. |
| 5 | `classification` | line-wide | yes | Class-code-driven base-rate lookups. |
| 6 | `rating-chains` | per-coverage | yes | The multiplicative factor chain per coverage. |
| 7 | `factor-tables` | plan-wide | no | Shared lookup tables. |
| 8 | `curves` | plan-wide | no | Shared continuous functions. |
| 9 | `modifiers` | per-coverage | no | Schedule rating, IRPM, experience mods. |
| 10 | `endorsements` | per-coverage | no | Coverage extensions priced as additional factors. |
| 11 | `loadings` | per-coverage | yes | Expense, profit, contingency loadings. |
| 12 | `final-adjustments` | plan-wide | yes | Min premium, rounding, hidden floors. |
| 13 | `outputs` | plan-wide | yes | The declared output ports of the Plan. |
| 14 | `rate-against-sample` | plan-wide | yes | The execution panel; sample submission + expected outcome. |

The 14-section spine is **universal**. A Plan MUST NOT introduce new top-level sections, rename existing sections, or reorder them. A line of business that does not need a section (e.g., WC does not use `territories`) leaves that section empty rather than omitting it.

This invariant is what allows the UI, the lineage engine, the diff viewer, the form-generated regulatory PDF, and any third-party tool to navigate Plans without per-LOB special cases.

### 3.3 Lifecycle and status

A Plan's `status` field takes one of four values:

- **`draft`** — The Plan is a work in progress. Content may change. Other entities MAY reference this Plan only with explicit acknowledgement (typically a UI warning).
- **`proposed`** — The Plan is being reviewed (peer review, filing prep). Content SHOULD NOT change; reviewers add comments rather than edits.
- **`active`** — The Plan is published and immutable. The `content_hash` is the canonical identifier. Any further work happens in a new draft (typically forked from this Plan).
- **`archived`** — The Plan is retired. It is preserved for audit (historical quotes referenced it) but MUST NOT be selected for new quotes.

Status transitions follow this state machine:

```
draft ──► proposed ──► active ──► archived
  │           │           │
  └───────────┴───────────┴──► (delete only allowed in draft)
```

A Plan in `active` status is **frozen**: any field other than `status` (transitioning to `archived`) and `last_edited_at` (which MAY update to record audit metadata) MUST NOT change. Implementations MUST enforce this at write time. Implementations SHOULD compute the `content_hash` and compare to the persisted hash on every read of an `active` Plan as a sanity check.

### 3.4 Content addressing (the hash)

A Plan's `content_hash` is a deterministic 16-character lowercase hex string derived from its content. Two Plans have the same content hash if and only if they are content-identical (modulo the excluded lifecycle fields listed in §8.1).

The full hashing rules are normative and appear in §8. The summary:

1. Strip the lifecycle fields: `created_at`, `last_edited_at`, `status`, `content_hash`, `draft_session_id`.
2. Canonically JSON-serialize the result (§2.2).
3. SHA-256 the UTF-8 bytes.
4. Take the first 16 hex characters of the digest.

The hash is computed by both writer and reader. A reader who receives a Plan whose computed hash disagrees with its declared `content_hash` MUST treat the Plan as corrupt.

---

## 4. Blocks

### 4.1 The Block contract

A Block has the following structure:

```
Block {
  id:     string                  // unique within the Plan DAG
  kind:   string                  // id of a registered BlockKind
  params: object                  // kind-specific configuration
  layout?: { x: number, y: number } // optional UI hint
}
```

The behaviour of a Block is determined entirely by its `kind`. A registered BlockKind defines:

- **inputPorts**: ordered list of input port specs.
- **outputPort**: a single output port spec.
- **paramsSchema**: the shape of the kind-specific `params` payload (validated at write time).
- **execute(inputs, params)**: pure function from input values to the output value.
- **category**: a UI grouping (`input`, `lookup`, `math`, `entity`, etc.).

A BlockKind MAY define additional behaviour for stacking (§5.4); kinds that participate in stacking declare `executeStacked(prevOutput, inputs, params)`.

A Block's `params` MUST validate against its kind's `paramsSchema`. A Block whose `params` are invalid is a compile-time error (§5.2).

### 4.2 Port types

A port has a `type` drawn from the following set.

**Primitive types** (11):

| Type | Domain | Notes |
| ---- | ------ | ----- |
| `money` | non-negative real | Dollar amount. SHOULD use a decimal representation in implementations that care about exactness. |
| `factor` | positive real | Multiplicative factor. 1.0 = identity. |
| `pct` | real | Percentage as fraction (0.10 = 10%). |
| `class_code` | string | Domain-specific subtype of string (ISO class codes, etc.). |
| `string` | string | UTF-8 text. |
| `date` | string (ISO date) | YYYY-MM-DD. |
| `bool` | boolean | true / false. |
| `int` | integer | 64-bit signed. |
| `float` | real | IEEE 754 double. |
| `model_output` | object | Structured output of a statistical model. Opaque to the runtime. |
| `record` | object | Structured record with named typed fields. |

**Composite types** (3):

| Type | Form | Notes |
| ---- | ---- | ----- |
| Optional | `{ kind: "optional", of: TypeRef }` | A value of the inner type, or absent. |
| List | `{ kind: "list", of: TypeRef }` | Ordered zero-or-more values of the inner type. |
| Record | `{ kind: "record", fields: { [name: string]: TypeRef } }` | Heterogeneous structured value with named typed fields. |

Composite types nest arbitrarily (e.g., `list<optional<factor>>`).

### 4.3 Port compatibility rules

An edge from a source port of type `S` to a sink port of type `T` is **compatible** if and only if `isCompatible(S, T)` returns true. The rules:

1. **Identity.** If `S == T`, compatible.
2. **Optional widening.** If `T = optional<U>` and `isCompatible(S, U)`, compatible. (Required → optional is fine; the reverse is not.)
3. **Composite recursion.** If `S` and `T` are both `list<...>` or both `record<...>`, compatible iff the element / field-wise types are pairwise compatible.
4. **Numeric cluster.** The types `money`, `factor`, `pct`, `int`, `float` are pairwise compatible **except** that `money` MUST NOT flow into a `factor` or `pct` sink and vice versa. (Multiplying a dollar amount as if it were a factor is the most common pricing bug in legacy systems; the spec prohibits it.)
5. **class_code ↔ string.** Compatible in both directions; class_code is a domain marker, not a structural constraint.
6. **All other pairs.** Incompatible.

Implementations MUST reject incompatible edges at write time. The check happens at edge-creation, not just at compile time, so the UI can prevent the user from drawing a forbidden edge.

### 4.4 The Block registry

A BlockKind is registered under a globally unique id. The id MUST be a kebab-case string matching `[a-z][a-z0-9-]*` and SHOULD be stable across spec revisions.

Implementations MUST reject Plans containing Blocks whose `kind` is not registered. The reference implementation surfaces this as a compile-time `unknown-kind` error (§5.2). Forward-compatible implementations MAY define an `unknown` BlockKind that preserves the Block in serialization while disabling execution; this is the strategy used by the reference UI to load older Plans during migration.

### 4.5 Canonical block kinds (v1)

The following BlockKinds are part of spec v1. A compatible implementation MUST support all of them at the contracts level (accept and serialize them) and SHOULD support all of them at runtime.

**Input / output primitives**

| kind | category | inputs | output | purpose |
| ---- | -------- | ------ | ------ | ------- |
| `input` | input | — | varies | A declared external input to the Plan. `params.name` and `params.type` define the port. |
| `input-source` | input | — | varies | An input that is sourced from a registered Source entity. References an `entity.input-source`. |
| `output` | output | one of varies | — | A declared output of the Plan. Wire any value here to expose it as a Plan output. |

**Constants**

| kind | category | inputs | output | purpose |
| ---- | -------- | ------ | ------ | ------- |
| `constant` | constant | — | varies | A literal value. `params.value` and `params.type`. |

**Lookups**

| kind | category | inputs | output | purpose |
| ---- | -------- | ------ | ------ | ------- |
| `lookup-direct` | lookup | `key: string` | `factor` | Direct key → factor lookup in a referenced Factor Table. |
| `lookup-range` | lookup | `value: float` | `factor` | Range-based bucket lookup. |
| `lookup-classification` | lookup | `class_code: class_code` | `factor` | Class-code-driven base-rate lookup. |
| `lookup-territory` | lookup | `state: string`, `zip5: string` | `record<string, float>` | Territory resolver. Returns the filing-defined numeric factor record on the Territory entity. |
| `lookup-multi` | lookup | varies | `factor` | Multi-key lookup. `params.keys` defines the input ports. |

**Interpolation**

> `curve-evaluate` was removed because 1-D banded factor tables are the
> canonical 1-D relativity representation; the Curve authoring surface is
> gone. The interpolation *math* — a relativity read **between** breakpoints
> rather than stepped at them — remains as the lean `interpolate` kind. Its
> breakpoints are inline `params`, with no separate entity to reference.

| kind | category | inputs | output | purpose |
| ---- | -------- | ------ | ------ | ------- |
| `interpolate` | transform | `x: float` | `factor` | Linear interpolation between `params.points` (x-ascending `{x, y}` breakpoints). An exact breakpoint hit returns that `y` byte-exactly; outside the range clamps to the nearest endpoint (`params.clamp`, default true) or extrapolates; non-numeric `x` yields a non-finite output the output backstop withholds. `params.mode` is `"linear"` (reserved for future modes). Conformance: `V61.interpolate-linear`. |

**Math**

| kind | category | inputs | output | purpose |
| ---- | -------- | ------ | ------ | ------- |
| `math-op` | math | `a: float`, `b: float` | `float` | Binary op. `params.op` ∈ {`+`, `-`, `*`, `/`, `min`, `max`}. |
| `chain-mult` | math | `factors: list<factor>` | `factor` | Multiplicative chain. Empty list yields 1.0. |
| `chain-add` | math | `addends: list<float>` | `float` | Additive chain. Empty list yields 0.0. |

**Control flow**

| kind | category | inputs | output | purpose |
| ---- | -------- | ------ | ------ | ------- |
| `predicate` | control | varies | `bool` | A boolean predicate over its inputs. `params.expr`. |
| `branch` | control | `cond: bool`, `then: T`, `else: T` | `T` | Conditional selection. |
| `range-check` | control | `value: float` | `bool` | True iff value falls in `[params.lo, params.hi]`. |

**Entity blocks**

| kind | category | inputs | output | purpose |
| ---- | -------- | ------ | ------ | ------- |
| `coverage-chain` | entity | varies | `factor` | Embeds a Coverage Chain entity inline as a Block. |
| `entity.dimension` | entity | — | varies | Surfaces a Dimension entity as an input source. |
| `entity.coverage-chain` | entity | varies | `factor` | Reference to a Coverage Chain entity. |
| `entity.input-source` | entity | — | varies | Reference to an Input Source entity. |

**Composition**

| kind | category | inputs | output | purpose |
| ---- | -------- | ------ | ------ | ------- |
| `subplan` | composition | varies | varies | Embeds another Plan as a callable subroutine. `params.plan_ref` references the inner Plan by id+hash. |

**Models (forward-declared)**

| kind | category | inputs | output | purpose |
| ---- | -------- | ------ | ------ | ------- |
| `model-glm` | model | varies | `model_output` | GLM inference. Reserved for Model Lab integration. v1 implementations MAY raise NotImplementedError at runtime. |
| `model-rating` | model | varies | `factor` | ML-derived rating factor. Reserved for Model Lab integration. |

**Placeholder**

| kind | category | inputs | output | purpose |
| ---- | -------- | ------ | ------ | ------- |
| `unknown` | meta | — | — | Reserved for forward-compatible loading of Plans that reference unregistered kinds. MUST NOT appear in a published Plan. |

### 4.6 Adding a new Block kind

New Block kinds are added by RFC (see CONTRIBUTING.md). An RFC MUST specify:

- The kind id (kebab-case, globally unique).
- The input port specs.
- The output port spec.
- The `paramsSchema`.
- The `execute` semantics in pseudocode or a reference implementation.
- Whether the kind participates in stacking (`executeStacked`).
- Hashing implications (does the kind reference an external entity by id? by hash? — see §7).
- Migration story for Plans authored before the kind existed.

Adding a Block kind is a **minor** version bump of this spec; removing or changing the semantics of a Block kind is a **major** version bump.

---

## 5. The Plan DAG

### 5.1 Nodes and edges

The `dag` field of a Plan is:

```
PlanDAG {
  nodes: PlanNode[]
  edges: PlanEdge[]
}

PlanNode {
  id:        string         // unique within the DAG
  block:     Block          // see §4.1
  section:   string         // one of the 14 section ids
  component_id?: string     // UI grouping within a section
  stacked_on?: string       // id of another node this one is stacked on (§5.4)
}

PlanEdge {
  id:        string
  from:      { node: string, port: string }
  to:        { node: string, port: string }
}
```

Every PlanNode MUST declare which section it belongs to (`section`). Sections that are `per-coverage` (chains, modifiers, endorsements, loadings) MUST also declare which coverage the node serves; this is conveyed via `component_id` whose value is the coverage id.

### 5.2 Compile-time validation

Before a Plan can be executed it MUST be **compiled**. Compilation validates the DAG and produces an executable form. The reference compile error categories are:

| Code | Trigger | Severity |
| ---- | ------- | -------- |
| `unknown-kind` | A node's `kind` is not in the registry. | error |
| `cycle` | The DAG contains a cycle. | error |
| `missing-edge-target` | An edge references a node id that doesn't exist. | error |
| `duplicate-node` | Two nodes share an id. | error |
| `unwired-input` | A required input port has no incoming edge and no default. | error |
| `incompatible-edge` | An edge connects incompatible port types (§4.3). | error |
| `orphan-output` | An `output` node has no incoming edge. | warning |
| `dead-code` | A node has no path to any `output` node. | warning |

A Plan with any error MUST fail to compile. A Plan with warnings only MAY compile but implementations SHOULD surface warnings prominently.

### 5.3 Runtime execution semantics

A compiled Plan executes as follows:

1. **External inputs** are provided as a `Record<string, unknown>` keyed by input node name. The runtime validates each input against the declared port type and SHOULD reject the run with a typed error if validation fails.
2. **Topological order.** Nodes are processed in topological order (Kahn's algorithm). Independent subtrees MAY be parallelized; the spec does not require it but does not forbid it either.
3. **Input gathering.** For each node, gather inputs by following incoming edges. Multiple edges into the same port (allowed only for ports with `cardinality: "N"`) produce a list in source-edge id order.
4. **Special node handling.**
   - `input` and `input-source` nodes pull their value from external inputs (or their declared default).
   - `subplan` nodes recursively compile and run the referenced inner Plan with the gathered inputs as its external inputs.
   - All other nodes call `BlockKind.execute(inputs, params)`.
5. **Stacking.** If any other node has `stacked_on == this.id`, those stacked nodes are evaluated bottom-up via `BlockKind.executeStacked(prevOutput, inputs, params)` and their result replaces this node's output for downstream consumption.
6. **Output collection.** `output` nodes have their incoming value collected into the result's `outputs` map keyed by the output node's declared name.
7. **Trace.** For every executed node the runtime MUST record the node's inputs, params (or a hash thereof), and outputs into a structured trace keyed by node id. Subplan nodes nest their inner trace under `${parentId}/${innerId}`.

The result of executing a Plan is:

```
RunResult {
  outputs:    Record<string, unknown>   // one entry per output node
  trace:      Record<string, NodeTrace> // every executed node
  startedAt:  timestamp
  durationMs: number
}

NodeTrace {
  inputs:  Record<string, unknown>
  outputs: Record<string, unknown>
}
```

The trace is mandatory, not optional. Audit, debugging, and the lineage UI all depend on it. Implementations MUST NOT short-circuit trace recording for performance.

### 5.4 Stacking

Stacking lets multiple Blocks be visually attached to a single "base" Block and execute in series, with each stacked Block transforming the previous Block's output. The use case is per-state amendments: a `coverage-chain` defines the base chain, and a stack of `chain-mult` Blocks applies state-specific factors.

Rules:

- A node MAY have at most one `stacked_on` reference.
- The reference MUST point to another node within the same DAG.
- Stacked nodes MUST live in the same section as their base.
- Stacked nodes MUST NOT participate in any other edges. Their input comes solely from the previous node in the stack; their output is consumed solely by the next.
- The base node's output port type and the stacked nodes' input/output port types MUST all match.

The reference implementation enforces all of the above.

### 5.5 Subplans

A `subplan` node references another Plan by `{id, content_hash}`. The referenced Plan is executed as a callable: its declared `input` nodes receive values from the subplan node's input ports (matched by name), and its declared `output` nodes' values become the subplan node's output ports.

Subplans MUST reference the inner Plan by **both** id and content hash. Resolving a subplan by id alone is forbidden because it would allow the meaning of a Plan to drift when the inner Plan is updated, breaking reproducibility.

Recursive subplans (a Plan that transitively references itself) are forbidden and MUST be rejected at compile time as a `cycle` error.

### 5.6 Determinism

A compiled Plan is a pure function of `(externalInputs, asOf)`. Implementations MUST guarantee:

- No reads from `Date.now()` or wall-clock time within `execute`. All time-dependent behaviour is parameterized by `asOf`.
- No reads from `Math.random()`, `crypto.randomUUID()`, or any other entropy source. Block kinds that genuinely need randomness MUST take a seed as an explicit param and MUST declare `deterministic: false` in their kind registration.
- No reads from any global mutable state.
- No I/O (network, filesystem, IndexedDB) within `execute`. Block kinds that need external data declare their dependency at the entity level and have the data snapshotted into the Plan at publish time.

The reference implementation enforces (1) and (2) via a build-time lint that bans the offending APIs from `BlockKind.execute` implementations.

---

## 6. Entities beyond Plan

A Plan references six sibling entity types. Each is a content-addressable entity with its own lifecycle, persisted independently and referenced from the Plan by `{id, content_hash}` (or `id` alone — see §7).

### 6.1 Coverage Chain

A multiplicative factor chain for a single coverage.

```
CoverageChain {
  coverage_chain_id: string
  display_name:      string
  coverage_id:       string         // which coverage this chain rates
  base_rate_source:  string         // id of a Source or a literal
  factors: [
    {
      factor_id:    string
      kind:         enum            // "lookup-direct" | "lookup-range" | "lookup-classification" | "curve" | "constant" | "model-rating"
      ref:          string|null     // id of the referenced Factor Table, Curve, or Model
      input_binding: string         // name of the Dimension or input field driving this factor
      params:       object          // kind-specific config
    },
    ...
  ]
  status, created_at, last_edited_at, content_hash  // standard lifecycle fields
}
```

A Coverage Chain evaluates to the product of all its factor values. Each factor resolves to a single number; missing or null factors evaluate to 1.0 (identity) unless the factor explicitly opts into "strict" mode in its `params`.

### 6.2 Dimension

A typed risk attribute exposed to all Plans in the deployment.

```
Dimension {
  dimension_id:  string
  display_name:  string
  data_type:     enum               // "class_code" | "string" | "int" | "float" | "bool" | "enum"
  domain:        object             // type-specific; for enum, the value list; for int/float, min/max
  description:   string|null
  status, created_at, last_edited_at, content_hash
}
```

Dimensions are referenced by Block params (e.g., a `lookup-direct` block's `input_binding`) and by Coverage Chains.

#### 6.2.1 Geographic dimension lookup domain

A Dimension MAY be **geographic** (`dimension_type: "geographic"`), in which case it carries three optional fields persisted by the registry and treated by the engine as a substitutable variable:

```
geo_granularity:  "state" | "county" | "zip"   // the unit of the dim's levels; locked at creation
geo_scope:        { kind: "national" } | { kind: "subset", states: string[] }
geo_territories:  [ { id: string, label: string, members: string[] } ]   // members are level ids
```

A geographic dim's **lookup domain** — the single key space the factor grid keys on, the input validator accepts against, and the engine resolves to — is defined by the **"territory-when-grouped, else level"** rule. A territory is *active* when it has ≥ 1 member:

- **No active territory** → the lookup keys ARE the granular levels (rate directly on the states/counties/ZIPs).
- **≥ 1 active territory** → the lookup keys are `{ active territory ids } ∪ { ungrouped level ids }`. Grouped levels collapse to their territory; ungrouped levels stay rateable on their own id. A fully-grouped dim (e.g. every KS ZIP in 701 or 702) collapses to exactly `{701, 702}`.

**Resolution is idempotent on keys.** A raw input value resolves to a key as follows: a value already equal to an active territory id passes through unchanged; a grouped member level id resolves to its territory id; an ungrouped level id resolves to itself; anything else is *unmapped*. Consequently a conforming input may carry **either** the granular level (a ZIP) **or** the rollup key (a territory code) — both resolve to the same factor row.

The **acceptance domain** a conforming input validator MUST accept without flagging a mismatch is exactly the set of values that resolve to a non-null key: `{ all level ids } ∪ { active territory ids } ∪ { their member ids }`. An unmapped geographic value is a *diagnostic*, not a hard error — it scores at the lookup's default (see the engine contract §"derive.territory").

The runtime mechanism that performs this resolution is the `derive.territory` block kind (engine-contract §8; conformance vectors V22–V25). Note this is **orthogonal** to the legacy standalone `Territory` entity (§6.5), which is a separate `(state, zip5) → factor-record` resolver for the `lookup-territory` block; a geographic *dimension* resolves *grouping of already-known levels*, not address geocoding.

### 6.3 Factor Table

A multi-key lookup table that returns factors.

```
FactorTable {
  factor_table_id:  string
  display_name:     string
  key_columns: [
    { name: string, type: TypeRef }
  ]
  rows: [
    { keys: [...], value: float }
  ]
  default_value:    float|null      // if null, missing-key is an error
  status, created_at, last_edited_at, content_hash
}
```

Factor Tables are referenced by `lookup-direct`, `lookup-range`, `lookup-multi`, and `lookup-classification` blocks.

### 6.4 Curve

A function defined by control points and an interpolation rule.

```
Curve {
  curve_id:                string
  display_name:            string
  schema_version:          int (default 1)
  interpolation:           enum     // "linear" | "monotone_cubic" | "step_forward"
  extrapolation:           enum     // "clamp" | "extrapolate"
  input_binding_source:    enum     // "input" | "dimension"
  input_binding_name:      string
  control_points: [
    { x: float, y: float }
  ]
  status, created_at, last_edited_at, content_hash
}
```

**Interpolation kinds.**

- `linear` — piecewise linear between adjacent control points.
- `monotone_cubic` — Fritsch-Carlson monotone cubic Hermite spline. Guarantees C¹ smoothness with no overshoot between monotone segments.
- `step_forward` — y takes the value of the next control point at and beyond that point's x. Useful for discrete brackets.

**Extrapolation kinds.**

- `clamp` — y outside the control-point range is clamped to the boundary y.
- `extrapolate` — y is linearly extrapolated using the slope of the boundary segment.

Control points MUST be supplied in sorted-by-x order in canonical-JSON serialization. A Curve with fewer than two control points is invalid. Control point x-values MUST be strictly increasing (no duplicates).

### 6.5 Territory

A named geographic region defined by ZIP5s plus a filing-defined set of
numeric factors. Factor keys are plan data; the platform does not prescribe
a line of business or coverage set.

```
Territory {
  territory_id:      string
  display_name:      string
  state_code:        string (2)
  territory_code:    string         // filing-defined code, e.g. fictional "t1"
  zips:              string[]       // ZIP5 strings, sorted ascending in canonical form
  base_rates:        record<string, float>
  status, created_at, last_edited_at, content_hash
}
```

A `lookup-territory` block takes `(state, zip5)`, finds the Territory whose `state_code` matches and whose `zips` list contains the ZIP5, and returns the `base_rates` record.

A caller-defined fallback record provides the values when no Territory
matches. The neutral built-in id is the fictional Meridian reference id `t0`;
published plans should set the code and factors stated by their own source.

### 6.6 Source / SourceUpdate

A Source is a catalog entry for an external data feed; a SourceUpdate is a specific dated instance of one.

```
Source {
  source_id:     string
  display_name:  string
  vendor:        string             // "ISO" | "Verisk" | "Census" | ...
  data_kind:     enum               // "base-rates" | "class-relativities" | "territory-defs" | "expense-loadings" | ...
  url:           string|null        // canonical reference, if public
  description:   string|null
  status, created_at, last_edited_at, content_hash
}

SourceUpdate {
  source_update_id:  string
  source_id:         string         // the parent Source
  effective_date:    date
  filename:          string|null    // received file name
  sha256:            string         // 64-char hex digest of the raw payload
  row_count:         int|null
  notes:             string|null
  status:            enum           // "received" | "approved" | "rejected"
  reviewed_by:       string|null
  reviewed_at:       timestamp|null
  created_at, last_edited_at, content_hash
}
```

A Plan that references vendor data at runtime MUST resolve that reference to a specific SourceUpdate at publish time and snapshot the data into the Plan body. The Plan retains the `{source_id, source_update_id, sha256}` triple for audit.

---

## 7. References and lineage

### 7.1 Reference forms (id vs hash)

A reference from one entity to another takes one of two forms:

- **By id alone.** The reference resolves to whatever current revision of the target entity is in the registry at evaluation time.
- **By id and content hash.** The reference pins a specific revision.

The choice of form is determined by the **status of the referencing entity**:

| Referencing entity status | Required form |
| ------------------------- | ------------- |
| `draft` | id alone OR id+hash (author's choice) |
| `proposed` | id+hash strongly RECOMMENDED |
| `active` | id+hash REQUIRED |
| `archived` | id+hash REQUIRED (inherited from the active form) |

Once a Plan is `active`, every reference it makes to another entity MUST be a pinned id+hash reference. This makes the reproducibility guarantee provable: re-evaluating an active Plan with the same external inputs and `as_of` MUST produce byte-identical outputs forever.

Subplan references (§5.5) are always id+hash, regardless of status.

### 7.2 The lineage graph

The lineage engine computes a directed graph centered on a chosen entity. Nodes are entities of any of the eight kinds enumerated in the reference `LineageNodeKind` enum:

```
COVERAGE_CHAIN | DIMENSION | FACTOR_TABLE | CURVE | INPUT_SOURCE |
TERRITORY | MODIFIER | LOADING | FINAL_ADJUSTMENT | ENDORSEMENT |
ELIGIBILITY_RULE | SAMPLE_SUBMISSION | UNRESOLVED
```

Edges are directed from **producer** (the upstream entity that supplies a value) to **consumer** (the downstream entity that uses it). Each edge carries a `relation` string describing the semantic role: `factor`, `key_column`, `input_binding`, `references`, etc.

A bidirectional walk from the centered entity yields the lineage graph:

- Walk upstream (toward producers) by following `references` fields on the centered entity.
- Walk downstream (toward consumers) by querying the registry for entities that reference the centered entity.

The walk MUST de-duplicate by `(kind, id)`. Unresolved references appear as `UNRESOLVED` nodes so the graph stays connected.

### 7.3 Resolution rules

Resolving a reference of the form `{id, content_hash?}` proceeds as:

1. If `content_hash` is supplied, look up the entity by `(id, content_hash)`. If not found, the reference is unresolved.
2. If `content_hash` is not supplied, look up the latest non-archived revision by `id`. If none exists, the reference is unresolved.
3. If the resolved entity is `archived`, the reference is **stale**: implementations SHOULD log a warning and MAY refuse to compile the referencing Plan.

Unresolved and stale references in an `active` Plan are fatal — they indicate a corrupted or partially-migrated deployment. Compilation MUST fail.

---

## 8. Content hashing (normative)

This section is the authoritative specification of content addressing for spec v1.

### 8.1 Excluded fields

The following fields are stripped from an entity's representation before hashing. They are considered lifecycle metadata, not content:

| Field | Reason |
| ----- | ------ |
| `created_at` | Set by the writer at persistence time; not part of semantic content. |
| `last_edited_at` | Updated on every save; would defeat content-addressing if included. |
| `status` | Changes as the entity moves through its lifecycle. |
| `content_hash` | Self-referential; cannot be part of its own input. |
| `draft_session_id` | Ephemeral UI session tracking. |

All other fields participate in the hash, including `display_name` and `description`. Renaming an entity yields a new content hash.

### 8.2 Canonical JSON rules

Hashing input is the canonical JSON serialization of the stripped entity (§2.2):

1. Sort object keys lexicographically at every level.
2. No whitespace.
3. `,` separator between elements, `:` between key and value.
4. Full Unicode (no ASCII escaping).
5. Numbers serialize in their shortest decimal form that round-trips to the same float (Python's default `json.dumps` for floats is acceptable).
6. Arrays preserve their declared order.

Lists that have semantic equivalence under reordering (e.g., a `zips` list on a Territory) MUST be sorted into a canonical order **at write time** by the implementation, before hashing. The hashing function itself does not reorder; it relies on the writer's discipline.

### 8.3 Truncation

The SHA-256 digest is a 64-character hex string. The content hash is the **first 16 characters**, lowercase.

16 hex characters = 64 bits of entropy. For a deployment with 10^6 entities, the birthday-bound collision probability is ~10^-7. For 10^4 entities (a typical large carrier deployment) it is ~10^-11.

This is short enough to fit in URLs, logs, and grep-driven debugging while leaving headroom for mechanical migration to a longer hash if collisions ever become a concern. A migration would be a major spec version bump.

### 8.4 Cross-entity hashing

When an entity references another by `{id, content_hash}`, the **inner entity's hash is included verbatim** in the canonical JSON of the outer entity. The outer hash therefore transitively pins the inner content.

When an entity references another by `id` alone (permitted only in `draft` status), the canonical JSON includes the id but not the hash. The outer hash is then deliberately decoupled from the inner content — appropriate for drafts where the author wants to track the inner entity's evolution.

A Plan transitioning from `draft` to `proposed` SHOULD freeze its references by replacing every `id`-alone reference with the current `{id, content_hash}` form. A Plan transitioning to `active` MUST do so.

---

## 9. Versioning

### 9.1 Hash-as-version

This spec does not define a separate `version` integer on entities. The content hash is the version. Two entities with the same `id` and different `content_hash` are different versions of the same logical entity; "current version" means "most recent non-archived hash."

The Curve entity carries a `schema_version: int` field. This is **not** the entity version — it is the version of the Curve schema itself, used to interpret older Curve representations during spec evolution. It is forward-incremented when the Curve schema changes; the reference implementation currently uses `1`.

### 9.2 Plan immutability after publish

An `active` Plan is byte-frozen (§3.3). The combination of:

- the Plan's `content_hash`,
- every cross-entity reference being pinned by `id+hash`,
- vendor data being snapshotted at publish time,
- the explicit `as_of` parameter at runtime,

guarantees that re-running an active Plan with the same external inputs and `as_of` produces byte-identical outputs forever.

### 9.3 Migration strategy

When this spec evolves:

- **Minor version bump** (e.g., 1.0 → 1.1): Backwards-compatible additions. New Block kinds. New Curve interpolations. New optional fields. Existing Plans continue to validate and execute identically.
- **Major version bump** (e.g., 1.x → 2.0): Backwards-incompatible changes. Removed Block kinds. Changed runtime semantics. Truncation-length change to the content hash. Implementations MUST migrate persisted entities by re-canonicalizing and re-hashing.

A major migration produces new `content_hash` values for every entity. Downstream consumers (other Plans, lineage references) MUST be updated to pin the new hashes. The migration tooling that ships with spec major bumps does this mechanically.

---

## 10. Runtime evaluation

### 10.1 External inputs contract

The external inputs to a Plan run are a record keyed by the names of the Plan's declared `input` and `input-source` nodes.

```
PlanRunInputs {
  [input_node_name: string]: unknown
}
```

The runtime validates each input against the declared port type before execution begins. Validation MUST be strict: a string supplied for a `float` port is an error, not an implicit conversion.

Missing inputs trigger one of two behaviours:

- If the input node declares a `default`, the default is used.
- If no default is declared, the run fails with a typed error indicating which input was missing.

### 10.2 The `as_of` parameter

Every Plan run MUST be parameterized by an explicit `as_of: date` parameter. This date is supplied separately from the external inputs and MUST be used by any Block kind whose behaviour depends on a date (e.g., a `lookup-classification` block whose Factor Table has a per-class effective date).

A run with no `as_of` supplied is invalid. The runtime MUST NOT default to `Date.now()`.

### 10.3 Trace format

The trace produced by a run is a strict superset of the inputs and outputs. For every executed node, the trace contains:

```
NodeTrace {
  inputs:   Record<string, unknown>   // gathered inputs by port name
  outputs:  Record<string, unknown>   // produced outputs by port name
  kind:     string                    // the BlockKind id
  section:  string                    // the PlanSurface section id
}
```

Implementations MAY add additional trace fields (timing, references to inner subplan traces) but MUST NOT remove the four canonical fields above.

### 10.4 Error categories

Runtime errors are categorized as:

| Code | Description |
| ---- | ----------- |
| `input-validation` | An external input failed type validation. |
| `missing-input` | A required input has no value and no default. |
| `lookup-miss` | A lookup returned no row and the table has no default. |
| `unresolved-reference` | An entity reference did not resolve. |
| `division-by-zero` | Arithmetic divided by zero (math-op). |
| `domain-error` | A value fell outside a declared domain (e.g., negative money). |
| `subplan-failure` | A subplan run failed; carries the inner error as `cause`. |
| `internal-error` | A BlockKind implementation raised an unexpected exception. |

The runtime MUST surface each error with its category, the node id where it occurred, and a human-readable message.

---

## 11. Compatibility and conformance

### 11.1 What a compatible backend must do

A backend claiming "OpenRater Plan Format v1" compatibility MUST:

1. Persist all 17 fields of the Plan entity (§3.1).
2. Enforce the 14-section spine (§3.2).
3. Enforce the four-state status machine (§3.3).
4. Compute and validate `content_hash` per §8.
5. Implement all v1 canonical Block kinds (§4.5) at contracts level.
6. Implement compile-time validation with the eight error categories (§5.2).
7. Implement runtime execution with deterministic semantics (§5.6).
8. Mandate the `as_of` parameter (§10.2).
9. Produce the canonical trace format (§10.3).
10. Persist Coverage Chain, Dimension, Factor Table, Curve, Territory, Source, and SourceUpdate entities with their own content hashes.
11. Enforce id+hash references for `active` Plans (§7.1).
12. Compute the lineage graph for any entity per §7.2.

A backend MAY skip Block kinds in the Models group (`model-glm`, `model-rating`) at runtime, raising `internal-error` instead. It MUST still accept Plans containing them at the contracts level.

### 11.2 Reference test vectors

The reference implementation ships a conformance test suite under `tests/conformance/`. Each test vector is a tuple:

```
{
  name:          string,
  plan:          Plan,                    // input
  entities:      EntityBundle,
  external_inputs: PlanRunInputs,
  as_of:         date,
  expected_hash: string (16),
  expected_outputs: Record<string, unknown>,
  expected_trace:   Record<string, NodeTrace>   // canonicalized
}
```

A backend passes conformance if and only if, for every test vector:

- `hash(plan, entities) == expected_hash`
- `run(compile(plan, entities), external_inputs, as_of).outputs == expected_outputs`
- `run(...).trace == expected_trace` (after canonicalization)

The vector set covers:

- All v1 Block kinds.
- All three Curve interpolations and both extrapolations.
- Territory resolution including the rural fallback.
- Stacked nodes.
- Subplans.
- Every compile error code.
- Every runtime error code.

A vector set is published alongside each spec release and is itself versioned (`PLAN_FORMAT_CONFORMANCE_v1.tar.gz`).

### 11.3 Conformance test suite

Contributors building alternative runtimes are encouraged to run the conformance suite in CI. A backend that passes the v1 suite may declare itself "OpenRater Plan Format v1 compatible" in its own documentation; the marks "OpenRater" and "OpenRater" remain trademarks of OpenRater and MUST NOT be incorporated into the backend's product name without written permission (see GOVERNANCE.md).

---

## 12. Open questions (for v1.0-final)

The following items are intentionally unresolved in this draft. Each is tracked in a public issue and will be settled before this document is promoted from Draft to Final.

1. **Decimal vs float for `money`.** The reference implementation uses IEEE 754 doubles throughout. Carriers in jurisdictions with strict premium-rounding rules will want decimal arithmetic. Open question: do we mandate `decimal.Decimal` (Python) / `BigNumber` (JS) for `money` ports, or do we standardize a "premium rounding" convention?
2. **Plan-level eligibility short-circuit semantics.** Today, eligibility rules are evaluated and their `false` result is surfaced as a Plan output. Some implementations want eligibility to short-circuit the rest of the run. Open question: do we add a `terminate` semantic to the `output` Block kind, or do we leave it to the caller to check eligibility outputs first?
3. **Multi-jurisdictional Plan ergonomics.** Plans with `jurisdiction: null` work today via per-state stacked Blocks. Open question: is this the right ergonomic for the long tail of 50-state filings, or do we introduce a first-class "state amendment" entity?
4. **Block kind versioning.** A Block kind's `execute` semantics might evolve subtly (e.g., a new corner case in `chain-mult` when one factor is null). Open question: do we add a `kind_version` field to the Block schema and bind a Plan to a specific kind version at publish time?
5. **Streaming evaluation for very large batches.** The current spec requires loading all external inputs before a run starts. A backend rating a million-row reinsurance treaty cession needs streaming. Open question: do we add a streaming variant of the run protocol, or push that into the REST layer?
6. **Vendor data snapshotting limits.** Vendor data is snapshotted into the Plan body at publish time. For very large datasets (full state ZIP tables), this bloats the Plan. Open question: do we permit referenced-by-hash external blobs (content-addressed BLOBs in object storage) instead of inline snapshots?
7. **Cross-Lab references.** This spec covers Plans referencing Models, Sources, and Datasets. Once Model Lab and Data Lab are real, those entities will have their own format specs. Open question: do we extend `LineageNodeKind` now to reserve the future kinds, or wait?
8. **Internationalization of display fields.** `display_name` and `description` are plain strings today. Open question: do we add `display_name_i18n: { [locale: string]: string }` for non-English deployments?

---

## Appendix A — Example Plan (canonical JSON, abbreviated)

```json
{
  "rating_plan_id": "bop-il-2026",
  "display_name": "BOP — Illinois — 2026Q2",
  "line_of_business": "bop",
  "jurisdiction": "IL",
  "effective_date": "2026-04-01",
  "description": "Illinois BOP filing for 2026Q2, derived from the carrier's 2025 base.",
  "parent_plan_id": "bop-il-2025",
  "source_filing_id": "IL-2026-00142",
  "template_id": "sample-bop",
  "coverages": ["building", "bpp", "occupant-liability"],
  "section_layout": { "rating-chains": ["chain-building", "chain-bpp", "chain-liability"] },
  "status": "active",
  "created_at": "2026-03-12T17:04:00Z",
  "last_edited_at": "2026-03-18T11:22:09Z",
  "content_hash": "9a3e1b6c0f4e7d28",
  "dag": { "nodes": [...], "edges": [...] },
  "entities": { "coverage_chains": [...], "dimensions": [...], "factor_tables": [...], "curves": [...], "territories": [...], "sources": [...] }
}
```

The full conformance vector for this Plan is published with the test suite.

---

## Appendix B — Reference field invariants

A summary of the cross-cutting invariants stated throughout this spec:

| # | Invariant | Section |
| - | --------- | ------- |
| I1 | The 14-section spine is universal. | §3.2 |
| I2 | An `active` Plan is byte-frozen. | §3.3 |
| I3 | `content_hash` = first 16 hex of SHA-256 of canonical JSON, lifecycle fields stripped. | §8 |
| I4 | All cross-entity references in an `active` Plan are pinned by id+hash. | §7.1 |
| I5 | Money values never flow into factor or pct ports. | §4.3 |
| I6 | The runtime is a pure function of `(externalInputs, asOf)`. | §5.6 |
| I7 | Vendor data is snapshotted into the Plan at publish time. | §6.6 |
| I8 | Every executed node contributes to the trace. | §5.3, §10.3 |
| I9 | The 14-section spine ordering is fixed; no Plan reorders or renames sections. | §3.2 |
| I10 | Subplan references are always id+hash regardless of status. | §5.5 |

These invariants form the compliance checklist a reviewer should apply when accepting an implementation as "OpenRater Plan Format v1 compatible."
