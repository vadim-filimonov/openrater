# Integration-contract conformance fixtures (IC1–IC10)

Portable JSON test vectors for [`docs/specs/integration-contract.md`](../../integration-contract.md)
§10. **Passing this suite is the definition of contract-compatible** — the same relationship the
engine's V1–V7 vectors have to the engine contract. Both repos run it:

- **openrater CI** runs each fixture against the live API Lab routes (harness provisions the world
  in the real store, then replays the steps).
- **An integrator's CI** runs the same files against its client +
  a fixture server that answers with each step's `expect` body — proving the client sends what the
  contract says and renders what it returns.

Fixtures are **data, not code**: no harness ships in this directory. Their
status and normative force follow the integration contract.

## File format

Each `IC*.json` is self-contained:

```jsonc
{
  "id": "IC3",
  "name": "quote-set-parity",
  "spec": "§4",                        // the contract section under test
  "asserts": "one sentence",
  "world": { … },                      // state the harness must provision BEFORE step 1
  "steps": [
    {
      "note": "human-readable intent",
      "actor": "operator | integrator | anonymous",
      "call": { "method": "POST", "path": "…", "headers": { … }, "body": { … } },
      "expect": { "status": 200, "body": { …matchers… } },
      "capture": { "name": "$.json.path" }      // bind values for later {{name}} refs
    },
  ]
}
```

### The world block

Declares the minimum state the fixture needs. The harness provisions it natively (seeds, API calls,
SQL — its choice) and **injects these pre-captured bindings** before step 1:

| Binding | Meaning |
| --- | --- |
| `{{integration_id}}` | The provisioned integration's id |
| `{{plan_alpha_id}}` / `{{plan_beta_id}}` | Internal ids of the world's plans (for direct plan-quote calls) |
| `{{plan_alpha_ref}}` / `{{plan_alpha_snapshot}}` | plan-alpha's descriptor `plan_ref` and published `snapshot_id` (for event `quote_pins`) |
| `{{integrator_key}}` | The integration's key — **only when `world.integration.paired` is true** |

The canonical world most fixtures use ("W1"):

- **plan-alpha** — published BOP·WA, exposed as carrier **`acme-mutual`**, `trace_policy:
  "summary"`, `validity_days: 30`, live. Consumed inputs: `gross_receipts` (number, required),
  `construction_class` (enum, required), `tiv` (number, required). Mapping: `rest.gross_receipts →
  gross_receipts`, `property.construction → construction_class`, `property.tiv → tiv`.
- **plan-beta** — published BOP·KS, exposed as carrier **`birch-specialty`**, live, same three
  mapped inputs, **plus an eligibility rule that refuses `tiv > 2,000,000`** with a named reason.
- **plan-gamma** *(IC4 only)* — published BOP·OR, exposed as carrier **`cedar-assurance`**, live,
  with a **stale mapping** relative to what the published plan consumes (`gross_receipts`, `tiv`,
  `liab_exposure_base`, all required): `property.tiv → tiv` is mapped `required: false` though the
  plan requires it (so a missing `property.tiv` reaches the ENGINE's preflight instead of the
  composer's own check), `property.construction → construction_class` is still mapped though the
  plan no longer consumes it, and `liab_exposure_base` is required by the plan but never mapped.

The canonical facts payload: `{"rest.gross_receipts": 1250000, "property.construction": "JM",
"property.tiv": 1500000}`.

### Matchers (partial-match semantics)

`expect.body` checks **only the fields it lists**; extra response fields are ignored (additive
evolution stays green, per contract §8). Literals must equal. Non-literal assertions:

| Matcher | Meaning |
| --- | --- |
| `{"$present": true}` | Field exists and is non-null |
| `{"$type": "string" \| "number" \| "object" \| "array" \| "null"}` | Type check |
| `{"$same": "name"}` | Equals the captured binding `name` |
| `{"$oneOf": [ … ]}` | Value is one of the literals |
| `{"$contains": [ … ]}` | Array contains every listed element (strings: substring) |
| `{"$empty": true}` | Field is null, `{}`, `[]`, `""`, **or absent** (a number/bool is never empty). `{"$empty": false}` asserts the opposite: present and non-empty. Pins Law 2 — a refused row crosses the wire carrying no numbers (`premium: null`, `outputs: {}`). |

Arrays of objects match **by position**. This leans on two normative ordering rules (contract
§4.2/§5): `quotes[]` is ordered by carrier label ascending; event `acks[]` ride in request order.

## The fixtures

| # | File | Asserts |
| --- | --- | --- |
| IC1 | `IC1.pairing-exchange.json` | code → key + descriptor; code is single-use |
| IC2 | `IC2.descriptor-shape.json` | required_fields derived through mapping, peer vocabulary |
| IC3 | `IC3.quote-set-parity.json` | member premium ≡ direct per-plan quote (Law 1) |
| IC4 | `IC4.named-gaps.json` | gaps → 200 + `input_issues` in peer vocabulary at BOTH layers (mapping check + engine preflight), premium null |
| IC5 | `IC5.honest-refusal.json` | refusal = null premium + named reason; siblings unaffected |
| IC6 | `IC6.identity-rejected.json` | identity-class fact keys → 422, keys named |
| IC7 | `IC7.event-idempotency.json` | same event_id twice → one LEDGER row, second ack `duplicate` |
| IC8 | `IC8.bound-lifecycle.json` | quoted→bound events → both recorded on the ledger, acked in order |
| IC9 | `IC9.trace-clamp.json` | requested `full` over `summary` ceiling → granted `summary` |
| IC10 | `IC10.validity-pins.json` | every member pins version + as_of + valid_until |
| IC11 | `IC11.drift-demotion.json` | republishing a live plan without a re-test → demoted (no member, named `live_version_untested`, descriptor `paused`); sibling unaffected; re-test restores |
| IC12 | `IC12.corrected-soft-undo.json` | `corrected` records on the ledger (`removed:true` marks recanting, `removed:false` restates); idempotent on `event_id` |
| IC18 | `IC18.pinned-rerate.json` | `pins {plan_ref, snapshot_id}` → ONE member at the NAMED frozen version (kind `snapshot`), the inception computation even after the live version moved on and drift demoted unpinned serving; unknown pin/snapshot → named issue + zero members, never a 4xx |

## Versioning

Fixtures carry the contract's `contract_version` (1.0). Additive contract changes must keep every
fixture green; a breaking change revs the fixtures with the major version, in the same PR.
