# OpenRater Integration Contract — the platform seam

| Field | Value |
| --- | --- |
| **Status** | **v1 — normative.** Ratified by decision record ADR-0057 (**Accepted** 2026-07-09; owner validated). The §12 open items are resolved — see §12. |
| **Created** | 2026-07-09 |
| **Drafted by** | Claude (Fable 5) for Vadim Filimonov ([@vadim-filimonov](https://github.com/vadim-filimonov)) |
| **Audience** | Integrators connecting a distribution platform (an agency portal, a broker system, a raterfront) to an OpenRater deployment for live quoting + book-of-record feed. |
| **Companions** | [`engine-contract.md`](./engine-contract.md) (the compute) and the Integration Hub surface in the app (the GUI that authors everything in this spec). |
| **Supersedes** | Nothing. It *composes* the per-plan quote endpoint (`/quote`), which is unchanged and remains the documented single-plan path. |
| **Decision records** | This spec cites internal decision records (ADR-####) and design briefs (Brief ##) by number. They live in the project's pre-detachment private archive; **the normative content is in this document** — the citations are provenance, not required reading. |

---

## 0. Why this document exists

The engine contract lets anyone **compute** a premium. This contract lets a
platform **converse** with a Labs deployment: discover what's quotable, send a
pseudonymous risk once and receive an indicative premium **per carrier**, and
report what the market later did (quoted / bound / declined / lost) onto an
append-only event ledger — all without the integrator ever learning
Labs' internal plan vocabulary, and without Labs ever learning who the insured
is.

Two design facts drive every choice below:

1. **We control both sides** (OpenRater Front ↔ OpenRater), so the handshake can be
   a pairing code, not an API-onboarding project. But the contract is written
   for *any* integrator — OpenRater Front is the reference consumer, the way Rate
   Lab is the engine contract's reference consumer.
2. **All integration semantics live Labs-side, authored in a GUI** (the
   Integration Hub wizard). The integrator sends its *own* canonical field
   vocabulary; a non-technical operator maps it to plan inputs in Labs. Adding
   a carrier plan to the pipeline is a wizard run, not a sprint on either
   repo.

### 0.1 The fences (unchanged, restated)

- Labs **never executes a bind**. `POST …/events` records that market events
  occurred elsewhere (ADR-0049 §"bind/quote API" — stands verbatim).
- Labs is **not a PAS**: no issuance, endorsements, billing, documents.
- Labs quoting **writes nothing on the compute path** (Brief 76 D-A). The
  durable record of a quote lives with the integrator; OpenRater keeps the
  event LEDGER only (see the §5 amendment — the book-of-record sink was
  removed with the Exhibits re-founding). **Amended by
  ADR-0058:** a *passive, record-only*
  forensic row is now also written post-response (off the response path,
  best-effort, never read back) — the compute path, its determinism, and
  retry-safety are unchanged.
- The seam is **pseudonymous by construction** (§7). Consumer PII never
  exists on either platform; commercial identity exists only on the
  integrator and never crosses.

---

## 1. Nouns

| Noun | Meaning |
| --- | --- |
| **Integration** | One paired peer: a named, keyed relationship between a Labs deployment and one integrator deployment. Deployment-level — the integrator owns its own tenancy (§6.3). |
| **Peer catalog** | The integrator's canonical field vocabulary — `{key, label, dtype, unit, example}` per field (e.g. `rest.gross_receipts` / "Annual gross receipts" / number / USD) — uploaded at pairing, refreshable. What the mapping GUI shows humans. |
| **Exposed plan** | One published rating plan made quotable through this integration, wearing a **carrier label** (the integrator's vocabulary — see §1.1) plus an input mapping, a trace policy, and a validity window. |
| **Input mapping** | Per exposed plan: `peer field key → plan input key`. Direct key-to-key in v1 (no transform DSL — same reasoning that kept expression DSLs out of portfolio KPIs). Authored in the wizard; persists via the ADR-0027 envelope mechanism, integration-scoped. |
| **Descriptor** | The machine-readable statement of the integration: exposed plans, their carrier labels, their **required peer fields** (mapping ∘ plan's consumed inputs), policies, contract version. The integrator's field tracker is driven by this. |
| **Quote-set** | One request, N answers: the risk quoted against every live exposed plan (or a named subset). Each member is a Brief-76 `QuoteResponse` — same shape, same premium the Run tab shows (Law 1). |
| **Placement event** | An append-only fact from the integrator about what the market did: `sent · quoted · bound · declined · lost · corrected`. The one stream that feeds the Labs event ledger, and — integrator-side — the warehouse and PAS sinks. |

### 1.1 Vocabulary rule — "carrier" and "submission"

- **Carrier is integrator vocabulary.** Labs plans stay carrier-agnostic
  (`product` × `state`, per ADR-0033); the *integration* pins a carrier label
  onto an exposed plan. Nothing named "carrier" enters the plan model.
- **"Submission" is banned on the wire.** It means a carrier placement in
  OpenRater Front and a ledger row in Labs. The wire says *quote-set* and
  *placement event*.

---

## 2. The pairing protocol

Pairing turns "integrate two platforms" into "copy one code."

```
Labs operator (wizard)                    Integrator admin (GUI)
──────────────────────                    ──────────────────────
1. Create Integration
2. Generate pairing code
   RATE-7Q2M-…  (TTL 10 min,
   single-use, shows Labs URL)
                    ── code + URL (human copies) ──▶
                                          3. Paste into Admin → Rating
                                          4. POST /integrations/pair
                                             {code, peer_name, catalog}
                    ◀── {integrator_key, integration_id, descriptor} ──
5. Wizard shows "Paired ✓"                6. Stores key (secret store),
   + peer catalog synced                     caches descriptor
```

- The **code** is a one-time bearer credential for exactly one exchange; it
  expires in 10 minutes and is revoked on use. Regenerating invalidates prior
  codes. Codes are displayed once, like key material.
- The exchange **uploads the peer catalog** in the same call — so by the time
  the Labs operator opens the mapping step, every dropdown speaks the peer's
  human labels. Catalog refresh: `PUT …/catalog` (integrator key) any time.
- Re-pairing (lost key) = new code, same integration; old key revoked on
  exchange.

## 3. The descriptor

`GET /api/v1/integrations/{id}/descriptor` (integrator key) →

```jsonc
{
  "contract_version": "1.0",
  "integration_id": "int_01J…",
  "labs": { "engine_contract": "v1", "deployment": "hosted" },
  "plans": [
    {
      "carrier": "acme-mutual",            // the integrator's label (§1.1)
      "plan_ref": "opaque-stable-id",      // NOT the internal plan id
      "product": "bop", "state": "WA",     // the ADR-0033 ProductCode, verbatim

      "status": "live",                    // live | paused | unmapped
      "required_fields": [                  // peer-vocabulary keys
        { "key": "rest.gross_receipts", "dtype": "number", "unit": "USD" },
        { "key": "property.construction", "dtype": "enum" }
      ],
      "optional_fields": [ … ],
      "trace_policy": "summary",           // ceiling for this peer (§4.3)
      "validity_days": 30                   // ★ default pending owner call
    }
  ],
  "events": { "accepted_kinds": ["sent","quoted","bound","declined","lost","corrected"] }
}
```

- `required_fields` is **derived, never authored**: the plan's consumed
  inputs (the same `deriveRequiredInputs` union the Inputs workspace shows)
  pulled back through the input mapping into peer vocabulary. When a plan
  edit changes its consumed inputs, the descriptor changes on next publish —
  the integrator's field tracker updates itself. This is the load-bearing
  trick of the whole seam: **the front's forms are steered by Labs' plans
  without either side writing schema by hand.**
- `status: "unmapped"` is a **coverage statement** against the CURRENT
  published version, not a has-any-mapping statement: it means at least one
  required consumed input is not covered by the mapping — including the
  republish case, where a new version consumes a required input the operator
  hasn't mapped yet (a field the mapping doesn't name can be neither listed
  in `required_fields` nor sent, so every quote would refuse). Integrators
  should treat an `unmapped` plan as not quotable; Labs' Hub shows the
  operator the same demotion with the gap named.
- `plan_ref` is an opaque stable alias minted per integration (internal ids
  and snapshot ids are Labs' own; snapshot ids do appear in version pins,
  which are audit data, not addressing).
- `status` is `paused` **both** when the operator toggles a plan off **and**
  when its live version drifted from the tested one and was demoted (§4.5) —
  either way it is not currently serving. `unmapped` means no required field
  is mapped yet. Only `live` is quotable.

## 4. Quoting — `POST /api/v1/integrations/{id}/quote-set`

### 4.1 Request

```jsonc
{
  "risk_ref": "r_8f3d…",          // pseudonymous, integrator-minted; never a name/address
  "request_hash": "sha256:…",     // integrator's canonical-payload hash, echoed back
  "effective_date": "2026-08-01",
  "as_of": null,                   // temporal anchor; defaults to effective_date
  "carriers": null,                // null = all live exposed plans; or ["acme-mutual"]
  "trace": "summary",             // request ≤ per-plan trace_policy ceiling
  "facts": {                       // PEER vocabulary — Labs maps per plan
    "rest.gross_receipts": 1250000,
    "property.construction": "JM",
    "geo.county_fips": "53033"
  },
  "locations": null                // reserved — policy quotes (Brief 76 P4.1b) are v1.1
}
```

### 4.2 Response

```jsonc
{
  "risk_ref": "r_8f3d…", "request_hash": "sha256:…",
  "as_of": "2026-08-01", "contract_version": "1.0",
  "quotes": [
    {
      "carrier": "acme-mutual", "plan_ref": "…",
      "version": { "kind": "published", "snapshot_id": "…", "content_hash": "…" },
      "row_status": "ok",           // Brief-76 body verbatim from here down
      "premium": 4821.00, "tier": "standard",
      "composed": { … },             // build-up: subtotal → tail → final
      "input_issues": { … },         // NAMED missing/unknown fields (peer vocabulary!)
      "row_issues": [ … ], "plan_issues": [ … ],
      "trace": { … },                // at the granted level
      "valid_until": "2026-08-31"
    },
    {
      "carrier": "birch-specialty", "plan_ref": "…",
      "version": { … },
      "row_status": "error",        // a NAMED refusal — never $0 (Law 2)
      "premium": null,
      "row_issues": [{ "code": "eligibility_refused", "detail": "TIV above program max" }]
    }
  ],
  "issues": []                       // integration-level: unknown carrier label, paused plan
}
```

Normative rules:

1. **One premium** (Law 1): each member reuses the Brief-76 scoring
   delegation. A quote-set member and a direct `POST /plans/{id}/quote` with
   the mapped inputs MUST return identical premiums for the same version.
   (Conformance IC3.)
2. **Refuse honestly** (Law 2): missing/unknown fields are NAMED in
   `input_issues` — translated back to **peer vocabulary** — and never a 4xx.
   This holds at BOTH layers that can catch a gap: the mapping's
   required-field check and the engine's input preflight land in one shape —
   `missing` / `unknown` lists of peer keys. A plan input the mapping never
   covered cannot be said in peer vocabulary; it surfaces under
   `unmapped_plan_inputs` (a mapping gap, named rather than dropped — no
   fact the peer sends can fill it). Refusals carry a reason and a `null`
   premium, never $0. The integrator's "refer, never decline" principle
   renders on top of this. (Conformance IC4, both layers.)
3. **Fan-out is the default.** `carriers: null` quotes every live exposed
   plan. Partial failure is normal: each member stands alone. `quotes[]` is
   **ordered by carrier label, ascending** — responses are deterministic all
   the way down (fixture-forced; IC5/IC10 match by position).
4. **The compute writes nothing** (Brief 76 D-A stands). The endpoint computes
   and returns. The integrator persists its own quote records; the book becomes
   durable only via events (§5). `request_hash` makes retries safe by
   construction — same bytes in, same bytes out (engine determinism).
   **ADR-0058 amends this narrowly:** a
   passive forensic row per served member is recorded *after* the response — no
   dedup on `request_hash`, never read back by the quote path — so this rule's
   idempotency semantics are untouched.
5. **Version pins are mandatory** in every member (`version`, `as_of`,
   `valid_until`) so any premium is replayable forever.

### 4.3 Trace policy

`trace_policy` per exposed plan is a **ceiling**: `none | summary | full`.
Default `summary` — factor-level drivers without the full node-by-node filed
plan internals, which a carrier may consider proprietary. `full` is for
integrations the plan owner trusts with plan internals. Request `trace` above
the ceiling is silently clamped (echoed in the member as `trace_granted`).

### 4.4 Validity

`valid_until = quote date + validity_days`, AND a quote dies early if its
snapshot is superseded — integrators SHOULD re-quote when
`descriptor.plans[].status` or a fresh quote's `snapshot_id` differs from the
pinned one. Re-quotes are new quotes; nothing mutates.

### 4.5 Republish drift — the one server-side demotion

Everything above **soft-flags** supersession: a live plan whose published
snapshot advances to a new version keeps serving that new version, and the
integrator re-quotes on its own signal (§4.4; ADR-0057 resolution 1). That
holds while the new version's mapping is still valid.

It does **not** hold when the new live version's **mapping was never
validated**. A published plan's consumed-input surface can change on republish
— a newly-required input the mapping doesn't cover (the `unmapped_plan_inputs`
case of §4.2 rule 2) — and an unvalidated mapping then prices live money with a
silent wiring gap. So Labs enforces one — and only one — **server-side hard
gate**:

> A live exposed plan serves quotes only while its **currently-published
> snapshot is the exact one that last passed its Hub mapping test** (the
> step-5 receipt). On republish to any other snapshot the plan is **demoted**
> until re-tested:
> - the quote-set **omits its member** and names the reason at integration
>   level — `issues[]` carries `{ "code": "live_version_untested", "carrier":
>   … }`. A named demotion, never a silent drop, never a fabricated `$0` (the
>   Law 2 spirit). Sibling members are unaffected (§4.2 rule 3).
> - the **descriptor** advertises the plan as `paused`, so the integrator's
>   `descriptor.plans[].status` watch (§4.4) already sees it and stops trusting
>   the pin.
> - re-running the Test step against the new version restamps the receipt and
>   restores the plan to live **automatically** — a one-click operator
>   recovery; nothing else changes.

This is deliberately conservative: any republish demands one re-test, even a
byte-identical one, because Labs will not assume the consumed-input surface is
unchanged. The gate lives entirely Labs-side — the reference integrator needs
no new behavior: a demoted plan reaches it as an ordinary integration-level
issue (§9), and its field tracker already renders a plan whose status left
`live`. (Conformance **IC11**.)

### 4.6 Pinned re-rate — quote a NAMED frozen version (ADR-0060 rule 8)

The request MAY carry `pins: { plan_ref, snapshot_id }`. The fan-out then
collapses to **that one exposed plan at that one frozen version** — the same
computation the plan-owner path's `?snapshot_id=` runs (Law 1 extended
through time; the member's `version` pins `kind: "snapshot"` + the pinned
id). The canonical caller is a PAS re-rating a **mid-term change at the
version in force at inception**: the snapshot its placement's `quote_pins`
recorded, regardless of what is live today.

Precedence and gates, exactly:

- `pins` overrides `carriers` — a pinned request scopes to the pinned plan,
  period.
- The §4.5 drift gate is deliberately **not consulted**: it protects the
  CURRENTLY-published version's serving, and a pin explicitly requests a
  historical one. The operator pause still rules — a paused plan quotes
  nothing, pinned or not (`plan_paused`).
- Every miss is a **named** integration-level issue with zero members,
  never a 4xx (Law 2): `unknown_pin` (no exposed plan with that
  `plan_ref`), `unknown_pin_snapshot` (the snapshot doesn't exist or
  belongs to a different plan — the lookup is plan-scoped, so a pin can
  never quote across plans), `plan_paused`.

(Conformance **IC18**.)

## 5. The event feed — `POST /api/v1/integrations/{id}/events`

The integrator reports market facts; the ledger records them. One stream,
integrator-side fan-out to its other sinks (warehouse, PAS).

> **Amended (Exhibits re-founding, 2026-07-18 — design brief
> `portfolio-redesign` §6):** OpenRater no longer keeps a book of
> record. The wire shape below is unchanged, but every accepted event
> is now a LEDGER ROW ONLY — no submission row is created, no status
> machine runs, and the ADR-0060 servicing kinds record without
> projecting. Validation that guards the contract itself (idempotency,
> identity-class fact keys, the exposure fence, required
> `premium_cents`/`policy_ref`) is unchanged. IC13–IC17, which pinned
> the book projections, were retired with the sink.

```jsonc
{ "events": [
  {
    "event_id": "pe_01H8…",        // integrator's id — THE idempotency key
    "risk_ref": "r_8f3d…",
    "carrier": "acme-mutual",
    "kind": "bound",                // sent | quoted | bound | declined | lost | corrected
    "at": "2026-08-02T17:04:00Z",
    "premium_cents": 482100,        // agency-DECLARED (may differ from indicative)
    "quote_pins": {                 // when the event descends from a Labs quote
      "plan_ref": "…", "snapshot_id": "…", "request_hash": "sha256:…"
    },
    "facts": {                      // OPTIONAL (ADR-0059) — the risk restated at
      "rest.gross_receipts": 250000,//   placement; §4.1's field + peer vocabulary,
      "geo.zip": "67202"            //   ≤ 64 scalar values (rule 6)
    },
    "effective_on": "2026-08-15", "term_months": 12,
    "reason": null,                 // declined: price|appetite|class|capacity|other
    "removed": false                // corrected/soft-undo ⇒ soft transitions, trail stays honest
  }
]}
```

→ `202` with `{"acks": [{event_id, status: "applied" | "duplicate" | "error", detail?}]}` —
**acks ride in request order** (fixture-forced; IC8 matches by position).

Normative rules:

1. **Idempotent on `event_id`.** Replaying a batch is always safe; duplicates
   ack as `duplicate`. (Conformance IC7.)
2. **Ledger identity:** `(integration_id, risk_ref, carrier)` names the
   risk the fact is about; the ledger stores the wire verbatim and derives
   `risk_id` from a `risk_`-prefixed ref at read time (ADR-0060 rule 2).
   *(Amended: formerly this keyed the book-of-record status lifecycle —
   removed with the sink.)*
3. **The fence, again:** these are records of events that happened elsewhere.
   No event triggers any market action, workflow, queue, or notification in
   Labs. (ADR-0049 language applies verbatim.)
4. **Declared ≠ indicative:** `premium_cents` is the agency's number; the
   pinned quote's premium is Labs' number. The book stores both; the delta is
   an analytics column, not a correction.
5. **`corrected` is the soft-undo** (`removed: true`): it re-opens the row
   the prior fact created — `bound`/`declined`/`lost` → `quoted` — through
   the same status write path, so the trail keeps every hop (and `bound_at`
   clears: the bind was a recording error, not a market fact). Undoing the
   original `quoted` fact leaves the row standing (no prior state to
   restore); a `cancelled` row refuses correction (cancellation is a market
   fact). `removed: false` restatements are ledger-only records in v1 — the
   book keeps the original declaration. (Conformance IC12.)
6. **`facts` are validated, then dropped (ADR-0059, amended).**
   `quoted`/`bound` MAY restate the risk's facts — the same field and
   peer vocabulary as §4.1, ≤ 64 scalar values. Identity-class keys ack
   `error` (`identity_keys_rejected`) for that event alone. The ledger
   never stores facts, and with no book row to land on they are
   validated and discarded — the event records that a declaration was
   made, never the risk's attributes. Facts are DECLARED, like
   `premium_cents` (rule 4) — never re-rated, never verified; the
   ADR-0058 quote ledger remains the cross-check via `request_hash`.
   *(Formerly conformance IC13 — retired with the book sink.)*
7. **Risk identity rides the existing ref (ADR-0060, amended).** A
   `risk_`-prefixed, format-valid `risk_ref` (`risk_` + lowercase
   canonical UUID) IS the global risk id — minted once, echoed by every
   later reporter, never re-minted. The ledger stores the wire verbatim
   and derives `risk_id` at read time; the same convention threads the
   quote ledger on both quote paths. *(The cross-integration book-row
   unification this rule drove was retired with the book sink —
   formerly IC14.)*
8. **`issued` requires its pointer (ADR-0060 Part 2, amended).**
   `policy_ref` (opaque, ≤64 chars — a POINTER to the PAS's policy
   record; OpenRater remains not-a-PAS) is required: an `issued` event
   without one acks `error`. With it, the event records. Idempotent via
   `event_id`. *(Ratification onto a bound book row — and the
   `policy_ref_conflict` verdict that guarded it — retired with the
   book sink; formerly IC15.)*
9. **`endorsed` records the declared in-force truth.** `premium_cents`
   on an `endorsed` event is the restated in-force TOTAL (never a delta
   — deltas drift), recorded as declared; nothing is verified and no
   stored premium moves (there is none). *(The `premium_current_cents`
   projection and the `endorsement_seq` monotonic guard were retired
   with the book sink; formerly IC16.)*
10. **`cancelled` / `reinstated` record the loop's ends.** Both are
    market facts on the ledger, timestamped from the event's `at`.
    *(The `bound ⇄ cancelled` status machine they drove was retired
    with the book sink; formerly IC17.)*

### 5.2 Reading the ledger back

`GET /integrations/{id}/events` — the event ledger, newest first
(`applied_at`), filterable by `kind` / `risk_ref` / `since` / `until`.
Operator-facing (auth-shim posture, like `GET /quote-ledger`: internal
forensic data; integrators bring identity), and the surface a downstream
journey collector (Brief 85's Spine) PULLS — Labs never pushes; the "no
outbound webhooks" fence stands.

## 6. Auth + deployment posture

### 6.1 Integrator key

- Minted once at pairing; scope = this integration's descriptor/quote-set/
  events/catalog endpoints, nothing else. Sent as `X-OpenRater-Integration-Key`.
- Revocable + rotatable from the wizard (re-pair = rotate). Reveal-once.
- Distinct from Brief-76 **per-plan** keys (which remain for direct single-
  plan callers) and from operator sessions (which own authoring).

### 6.2 Transport

HTTPS required. Hosted-to-hosted OpenRater deployments SHOULD ride a private
network or mTLS; the contract itself stays transport-agnostic so OSS
self-hosters aren't forced into one topology.

### 6.3 Tenancy

Labs keeps its **single-operator posture** (ADR-0049 §single-operator): one
integration = one peer *deployment*. The integrator owns its own tenants;
`risk_ref` opacity means Labs cannot tell tenants apart and doesn't need to.
Per-tenant federation (a tenant pairing its *own* Labs) is out of scope v1
and nothing here precludes it — it's another Integration row.

## 7. PII — pseudonymous by construction, enforced twice

- `risk_ref` is opaque. The wire schema simply has **no fields** for insured
  identity.
- **Deny-classes** (normative): fact keys matching identity patterns —
  legal/display/owner name, dba, address, phone, email, website/url,
  editorial prose, license numbers — MUST be rejected by Labs with `422`,
  error code **`identity_keys_rejected`**, and every offending key named in
  `error.details.keys` (the envelope's structured-payload slot; never
  silently stripped). The same guard runs on catalog upload, so the Hub's
  mapper can never even list an identity field. The reference integrator lints the same classes
  outbound (`lib/rating/client.ts` — the same guard, both sides of the wire).
- **Allowed geography:** rating territory is not identity — city, state,
  county FIPS, tract, flood zone, protection class MAY cross. Raw street
  address MUST NOT; derive-then-drop happens integrator-side.
- Firewalled-signal rules (the integrator's demographic firewall) bind the
  *integrator's* payload assembly; Labs additionally refuses any key the
  exposed plan's mapping doesn't consume — unmapped facts are dropped, not
  stored (quoting writes nothing anyway).

## 8. Versioning

`contract_version` (semver) rides every descriptor + quote-set response.
Additive fields = minor bump, consumers MUST ignore unknown fields; breaking
changes = major bump with a dual-serve window. Same posture as the engine
contract §"Versioning."

## 9. Error envelope

Non-2xx uses the central `RaterError` envelope (`{error: {code, message,
param?}}`) — the same one connectors/routes ship. The critical distinction
the integrator must render differently:

| Situation | Signal | Integrator UX (reference) |
| --- | --- | --- |
| Transport/deployment down | non-2xx / timeout | degrade to "no price" copy, retry affordance — never block the flow |
| Risk refused by a plan | `200`, member `row_status:"error"` + reason | "refer, with a reason" — a first-class outcome |
| Inputs incomplete | `200`, member `input_issues` named | field tracker lights up "N fields from a rateable quote" |
| Live version untested (republish drift, §4.5) | `200`, integration-level `issues[]` `live_version_untested` (no member); descriptor `status: paused` | plan reads as temporarily paused — no price; re-quote when its status returns to `live` |
| Bad key / expired code | `401` envelope | re-pair flow |
| Identity key in facts | `422` envelope, keys named | a bug — surface loudly, never auto-strip |

## 10. Conformance fixtures (the plug-and-play proof)

Portable JSON fixtures at
[`docs/specs/conformance/integration/`](./conformance/integration/README.md)
(**drafted 2026-07-09** — format, world bindings, and matcher vocabulary in
that README), run by **both** repos' CI (Labs against its live routes; the
integrator against its client + a fixture server). Pass the suite ⇒
contract-compatible — the same discipline as engine conformance V1–V7.

| # | Fixture | Asserts |
| --- | --- | --- |
| IC1 | `pairing-exchange` | code → key + descriptor; code single-use; reuse → 401 |
| IC2 | `descriptor-shape` | required_fields derived through mapping, peer vocabulary |
| IC3 | `quote-set-parity` | member premium ≡ direct Brief-76 quote, same version, byte-equal |
| IC4 | `named-gaps` | gaps → 200 + `input_issues` in peer vocabulary at both layers (mapping + engine preflight), no 4xx |
| IC5 | `honest-refusal` | refusing plan → `premium:null` + named reason; sibling members unaffected |
| IC6 | `identity-rejected` | `facts` containing `legal_name`-class key → 422 with keys named |
| IC7 | `event-idempotency` | same `event_id` twice → one ledger row, second ack `duplicate` |
| IC8 | `bound-lifecycle` | quoted→bound events → both recorded on the ledger, acked in order |
| IC9 | `trace-clamp` | request `full` over `summary` ceiling → granted `summary`, echoed |
| IC10 | `validity-pins` | every member carries version + as_of + valid_until |
| IC11 | `drift-demotion` | republish without re-test → demoted (no member, named `live_version_untested`, descriptor `paused`); sibling unaffected; re-test restores |

## 11. What this contract is NOT

- **Not a bind/quote execution API** — records and computations only
  (ADR-0049 fence, verbatim).
- **Not a PAS bridge.** PAS hand-off is the *integrator's* sink on its own
  placement-event stream (see the front brief §PAS); Labs never talks to a
  PAS.
- **Not a transform engine.** v1 mapping is key-to-key; unit mismatches
  surface as wizard warnings. A mapping-transform DSL is explicitly out
  (audit hole + gimmick magnet — the portfolio-KPI precedent).
- **Not multi-tenant Labs.** One peer per integration; tenancy is the
  integrator's job.
- **Not a message bus.** Events are HTTP-batched, idempotent, integrator-
  retried. No queues in v1 on either side.

## 12. Open items — RESOLVED by ADR-0057 (Accepted 2026-07-09)

1. `validity_days` default **30**; snapshot supersession **soft-flags** —
   the integrator prompts re-quote, nothing hard-expires server-side. *(One
   exception, §4.5: a live version whose mapping was never re-tested is
   **demoted** server-side — a serving-eligibility gate, not a quote expiry —
   because an unvalidated mapping silently misprices. Added by the 2026-07-11
   audit; conformance IC11.)*
2. Events land on the ledger **on by default**. *(Amended: the
   events→portfolio sink this resolved was removed with the book of
   record — Exhibits re-founding.)*
3. `plan_ref` = **per-integration opaque alias**.
4. **No rate limiting** on quote-set for paired peers in v1.
5. `locations` stays **reserved-null** in v1.0 (policy quotes are v1.1).
