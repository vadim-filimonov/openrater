# Security policy

OpenRater is a **local-first, self-hosted** platform. Understanding
its deliberate security posture will save you a report — and us a
triage:

- **The platform ships unauthenticated by default.** Every mutating
  action attributes to `current_operator()` (stub:
  `operator@openrater.local`); deployments wire real identity via
  `openrater.auth.register_operator_resolver(...)`. This is a
  documented integration seam, not an oversight.
- **The packaged Desktop extension binds loopback only.** The runtime
  the `.mcpb` spawns listens on `127.0.0.1` on ephemeral ports, stores
  data in `~/.openrater/`, and exits with Claude Desktop. Nothing
  listens beyond the laptop, and the platform never makes AI calls.
- **Shared deployments put their own front door in front.** Bind to
  localhost or a private network and terminate auth at your proxy
  (the `deploy/` overlay ships a Cloudflare Access recipe). The
  `/quote` API can additionally require per-key auth via
  `RATER_QUOTE_REQUIRE_KEY=1`.

## Supported versions

OpenRater is pre-1.0 and pre-tagged. We accept security reports
against:

| Version | Supported |
|---|---|
| `main` (HEAD) | ✓ |
| Older commits | best-effort; please re-confirm on `main` before reporting |

When 1.0 ships with semver tags, this matrix will list the
maintenance window per minor version.

## Reporting a vulnerability

**Please do NOT open a public GitHub issue.** Security reports go via
private channels so we can triage and ship a fix before the issue
becomes public.

1. **GitHub Private Vulnerability Reporting** (preferred) — *Security
   → Report a vulnerability* on this repository.
2. If you can't use GitHub, email the maintainer at the address on
   their GitHub profile, with `[openrater security]` in the subject.

### What to include

- A clear description of the issue (what's wrong, what makes it
  exploitable).
- The smallest reproducer you have — ideally a curl command, test
  case, workbook, or short script.
- Affected file(s) + the commit SHA you're reporting against.
- An assessment of impact (data exposure? auth bypass? DoS?) and
  your suggested severity.
- Whether you're OK with public credit when the fix ships (name,
  GitHub handle, or "Anonymous").

### What to expect

| Stage | Timeline |
|---|---|
| Acknowledgement | ≤ 2 business days |
| Initial triage + severity assessment | ≤ 5 business days |
| Fix shipped (or detailed plan + ETA) | by severity — see below |
| Public disclosure + advisory | with the fix, or after a 30-day embargo if the fix takes longer |

**Severity tiers + target ship windows:**

- **Critical** (remote code execution, auth bypass affecting all
  users): emergency patch within 5 business days.
- **High** (data exposure, escalation of privilege): patch in the
  next scheduled release, typically within 2 weeks.
- **Medium** (DoS, info leak, broken contract): patch in the next
  minor release (4–6 weeks).
- **Low** (best-practice violation, hardening): grouped into the
  next maintenance window.

## Threat model — what's in scope

OpenRater IS:

- A deterministic rating engine (`services/scoring`) + a FastAPI
  service (`server/`) + a web app + an MCP server + a packaged
  desktop runtime.
- An OSS substrate that actuaries run locally and that carriers /
  MGAs / brokers deploy behind their own auth + network controls.

In-scope issues include:

- **Engine determinism failures** — same inputs producing different
  outputs across runs, or a non-number escaping the engine looking
  like a premium.
- **Server vulnerabilities** — SQL injection, path traversal,
  request smuggling, idempotency cache poisoning, responses leaking
  stack traces.
- **Ingestion vulnerabilities** — a malicious `.xlsx` workbook or
  plan JSON triggering code execution, path escape, or resource
  exhaustion in the deterministic ingester.
- **Desktop runtime issues** — the packaged runtime binding beyond
  loopback, leaking data off-machine, or spawning with a wider
  surface than documented.
- **`/quote` API-key bypass** when `RATER_QUOTE_REQUIRE_KEY` is set.
- **Supply chain** — compromised or typo-squatted dependencies.
- **OSS hygiene** — license violations, third-party code without
  attribution.

## Threat model — what's out of scope

OpenRater is NOT a deployment platform. We do not provide HTTPS
termination, authentication/RBAC (beyond the resolver seam and quote
API keys), network rate limiting, WAF, or secrets management beyond
environment variables. So out of scope:

- Reports that the default deployment is unauthenticated — that's
  the documented posture above; the resolver seam is the fix.
- CORS configuration in dev defaults — adjust `RATER_CORS_ORIGINS`.
- TLS concerns in your deployment — that's the deployer's proxy.

If you're unsure whether your report is in scope, send it anyway —
we'd rather triage one extra report than miss a real issue.

## Coordinated disclosure

We follow a 30-day default embargo: 30 days from acknowledgement to
public disclosure, longer if the fix is non-trivial and you agree to
extend. We'll credit you in the advisory + the CHANGELOG entry unless
you prefer anonymity.

## Hall of fame

Reporters of confirmed vulnerabilities will be listed here once the
first report lands. Thank you for keeping OpenRater safe.
