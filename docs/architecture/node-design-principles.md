# Node design principles

| Field | Value |
| --- | --- |
| **Status** | Active. Load-bearing. Read before authoring any new node (stage kind), any UI component that represents a node, or any data structure that holds nodes. |
| **Created** | 2026-05-19 |
| **References** | [Plan format](../specs/plan-format-v1.md) · [engine contract](../specs/engine-contract.md) |

---

## §0. Why these principles exist

A rating plan is a graph of *nodes*. Each node represents one step in the rating computation — an input declaration, a factor lookup, a multiplication, a loading, or an output emission.

**For the product to be intuitive, every node must feel the same.** Once the actuary learns how one node works, they should know how every node works. That requires:

- **Shared shape** (data model) — every node has the same set of properties
- **Shared interface** (runtime) — every node executes through the same contract
- **Shared affordances** (UI) — every node renders, edits, and communicates state the same way

This document names the 10 principles that enforce that consistency. Each is a load-bearing decision; deviation requires an ADR explaining why this node is different.

The principles aren't aspirational — they're concrete shape constraints. A new contributor should be able to read this doc, pick up the existing `input_node` implementation, and ship a `multiplicative_chain` that feels identical in every way except the math.

---

## Substrate principles (runtime + data shape)

These apply to every node's data model + execute() function. They're enforced by the conformance vectors and the typed-strict TypeScript / Pydantic stack.

### P-N1. Pure execute()

**Statement.** Every node's `execute(inputs, params, ctx) → outputs` is a pure function. No side effects. Deterministic. Same inputs + same params + same `ctx.as_of` produces byte-identical outputs every time, forever.

**Why.** Reproducibility is the OSS proof. The conformance vectors enforce it. If a node reaches out to the network, mutates global state, or reads the wall clock without going through `ctx.as_of`, the engine is no longer trustworthy and we cannot guarantee filing-grade reproducibility.

**Not doing it looks like:** a node that fetches the latest factor table from an API at runtime, or computes a "this quarter's IRPM" using `new Date()`, or mutates a shared cache.

**Enforcement.** Every kind ships with conformance vectors that pin its behavior. Mutation = vector fails = PR blocked.

### P-N2. Typed I/O (explicit ports)

**Statement.** Every node declares its `inputs[]` and `outputs[]` explicitly. Each port has a `name`, a `data_type` (number | string | boolean | enum | object), and (for inputs) a `source_kind` describing where the value comes from.

**Why.** The DAG validator depends on this to catch "wrong wire" errors at authoring time, before runtime. The actuary sees "this input expects a number but you wired a string" inline, not as a runtime crash.

**Not doing it looks like:** nodes that accept `any` and return `any`. Drift you don't see until production. Every typed rating tool has this discipline; every spreadsheet doesn't.

**Enforcement.** Pydantic + Zod schemas at every contract boundary. The `validator.py` cross-references port declarations against the DAG.

### P-N3. Stable ID + human display name

**Statement.** Every node has a `stage_id` (kebab_case, stable, system-level identifier — never changes after creation) AND a `display_name` (free-text, actuary-readable). They are independent: rename the display_name freely; the ID is what wires reference.

**Why.** Refactor without breaking references. Audit logs key on ID; UI shows name. The actuary thinks "Class code lookup"; the system thinks `classification_lookup_class_code_a83bf2`.

**Not doing it looks like:** using the display_name as the key. Every rename breaks every downstream reference. (Excel spreadsheets do this; we don't.)

**Enforcement.** Schema requires both fields. ID is set at creation and never patched. Display_name lives in `config_json.name` for the kinds whose form authors a name; the `stage.display_name` field freezes after creation (per WA-2 — to be retired in backend slice 2.5).

### P-N4. Citation + provenance

**Statement.** Every node can carry a `citation_rule` (for example, "Manual §3.1 Table A"), a `citation_page` (page number in the source filing), and a `source_filing_id` (UUID of the filing this node was derived from). It also carries the operator ID + timestamp of the last edit.

**Why.** Filings require it. Audit logs require it. Regulatory review requires it. An actuary asked "where did this 1.15 come from?" must be able to point at a page in a real document, not a Slack message.

**Not doing it looks like:** floating factors with no defensible source. Looks like spreadsheet-grade tooling. Fails the filing reviewer.

**Enforcement.** Every kind's schema includes citation fields. The audit log captures who-edited-what-when. Empty citation isn't a hard error — sometimes the actuary derives a factor from experience — but the UI surfaces it as a softer warning ("no citation; consider adding one before filing").

### P-N5. Trace contract

**Statement.** Every node's `execute()` emits a trace fragment that explains "what came in, what went out, and why" in actuary-readable language. The plan's trace is the union of every node's trace.

**Why.** Every premium must be explainable. The cold-test depends on this — an actuary opening a plan should be able to see *"base rate $1.74 × class factor 0.94 × ... = $1,634.18"* without reading code.

**Not doing it looks like:** opaque math. "The model said $1,634" with no breakdown. OpenRater's rating runtime must never become a black box.

**Enforcement.** Trace contract is part of the engine-contract spec (`docs/specs/engine-contract.md`). Every kind's execute() returns `{output_values, trace}`. The trace shape is typed and uniform across kinds.

### P-N6. Validation at authoring time AND runtime

**Statement.** Every node has a `validate(node_state, plan_context) → ValidationResult` function. The validator runs:

1. **At authoring time** (when the actuary edits a stage in the drawer) — surfaces inline errors/warnings on the relevant field.
2. **At compile time** (before the runner executes) — surfaces a plan-level error if any node fails.

A node that won't validate cannot be run; a node with warnings can be run, with the warnings shown in the trace.

**Why.** Catch errors early. Actuary fixes them in the editor while the context is fresh, not three months later when production fails. Apple-grade UX requires problems be visible at the moment of need (W4 §4.0).

**Not doing it looks like:** silent partial failure (runs but produces wrong premiums), or runtime crashes with stack traces, or "validation later when you press Run" (too late).

**Enforcement.** Every kind's spec includes a validator. The plan-level validator composes them. The UI surfaces blocking errors in persistent, contextual notices rather than transient messages.

---

## UI principles (interaction + visual)

These apply to every UI representation of a node — primarily the stage chip + the editor drawer.

### P-N7. Consistent chip rendering

**Statement.** Every node renders in the UI as a chip with three regions:

- **Left:** a kind-aware icon (lucide-react) in a small accent-colored square
- **Center:** the node's display label, human-readable, single line, ellipsis on overflow
- **Right (conditional):** state indicator — empty, warning (⚠ orange), error (✕ red), or invalid (! amber)

Always. For all 18 kinds, in all surfaces (section pane, future pipeline view, future DAG).

**Why.** Visual consistency = intuitiveness. The actuary learns one chip pattern; it applies to every kind they encounter. Cognitive load drops; muscle memory builds.

**Not doing it looks like:** every kind rendered differently. Some show their kind code; some don't. Some show validation state; some don't. Steep learning curve, looks like 18 different products in one app.

**Enforcement.** A single `<StageChipButton>` primitive (in `@openrater/ui` eventually; today inline in `PlanDetailRoute.tsx`) renders every node. `iconForStageKind(kind)` is the single registry of icons.

### P-N8. Consistent edit interaction

**Statement.** Click any node's chip → the same drawer opens in edit mode, with the kind-specific form prefilled. The drawer chrome is identical across kinds (title, subtitle, body, footer). The save/cancel/delete affordances are in the same places.

The only thing that changes between kinds is the form body — i.e., the fields the actuary edits.

**Why.** Muscle memory. Once they know how to edit an `input_node`, they know how to edit a `multiplicative_chain`, a `classification_lookup`, and so on. The action vocabulary stays the same; only the noun changes.

**Not doing it looks like:** per-kind modals, custom flows, dialogs that look different. Each kind requires re-learning the edit pattern. Cognitive load.

**Enforcement.** The shared `Drawer` primitive and `<KindName>Form` pattern provide one interaction model for every kind.

### P-N9. Consistent state visualization across scales

**Statement.** The visual language for state is uniform across the chip, the section, and the plan:

| State | Color | Iconography | Copy |
| --- | --- | --- | --- |
| Empty | neutral (—) | ○ outline circle | "empty" / "No X yet" |
| Has content, no issues | neutral filled | ● filled circle | (no badge) |
| Warning (works but could fail filing) | orange | ⚠ AlertCircle | "warning" |
| Required-empty (would block compile) | orange | ⚠ AlertCircle | "required" |
| Error (won't compile/run) | red | ✕ XCircle | "error" |
| Success (compile + run passed) | green | ✓ Check | (no badge, color only) |

The same color means the same thing at the chip, the section card, the rail group header, and the plan-level completeness widget.

**Why.** The actuary can see plan health at a glance because the same color means the same thing everywhere. Orange means "needs your attention before filing" — whether it's on a chip, a section, or the whole plan.

**Not doing it looks like:** orange-here-means-warning, orange-there-means-pending. The same color carries different semantics in different places. Confusion. The user has to learn what each color means in each context.

**Enforcement.** Token-level: the color tokens are semantic (`--rater-color-orange-500`) and only used for the warning state. The `tone` prop on `<Chip>`, `<ProgressBar>`, etc. maps to these tokens consistently.

### P-N10. Connection as data

**Statement.** When one node references another's output (e.g., a `multiplicative_chain` referencing a `flat_factor`'s output), the reference is *data* in the consuming node's `inputs[]` declaration — not implicit by name-match, not embedded in code.

Specifically: each input port has a `source_kind: "stage_output"` and a `source_path: "<source_stage_id>.<output_name>"`. The plan JSON contains every wire. The wires are part of the conformance vectors.

**Why.** Plans are portable (per P-N1 reproducibility + the OSS bet). Wires that live in code aren't portable. Implicit name-match is brittle — rename one node, every downstream node silently breaks.

**Not doing it looks like:** "the multiplicative chain just knows to use the factor table because they have similar names." Brittle. Hard to debug. Every typed rating language has this discipline.

**Enforcement.** Plan Format Spec v1 requires explicit wires. The validator checks that every `source_path` resolves to an existing stage's output. Renaming a stage's ID is a deliberate refactor; the validator finds every wire that needs updating.

---

## How the principles compose

The 10 principles aren't independent — they reinforce each other:

- **P-N1 (pure)** + **P-N5 (trace)** = reproducible + explainable = the OSS proof
- **P-N2 (typed I/O)** + **P-N10 (connection as data)** = the DAG validator works
- **P-N3 (stable ID + display name)** + **P-N4 (citation)** = filing-grade plans
- **P-N6 (validate-early)** + **P-N9 (state visualization)** = the actuary fixes problems where they appear, not in production
- **P-N7 (chip)** + **P-N8 (edit drawer)** = one mental model, 18 kinds

Together they enforce OpenRater's three product commitments:

| Commitment | Principles that serve it |
| --- | --- |
| Best-in-class architecture | P-N1, P-N2, P-N3, P-N10 |
| Best-in-class UX | P-N5, P-N6, P-N7, P-N8, P-N9 |
| Best-in-class OSS | P-N1, P-N4, P-N5, P-N10 |

---

## Amendment process

To change a principle here:

1. Open a PR explaining what changed and why.
2. Reference every place in the codebase that relied on the old principle and update it in the same PR.
3. Update the plan-format or engine-contract specification and conformance vectors when runtime behavior changes.

Principles are added the same way: PR with the new principle + ADR justifying why we need a P-N11 / P-N12 / etc. Adding a principle that isn't transferable across all 18 kinds is a code smell.
