# OpenRater Privacy Policy

**Effective date: 2026-07-19**

OpenRater is a local-first application. It is designed so that your
rating content — filings, workbooks, plans, books of business, quotes —
never has to leave your machine. This policy describes exactly what the
OpenRater desktop extension does with data, which is very little.

## What OpenRater is

OpenRater turns a rate filing or rating manual into a working,
deterministic rating engine that runs entirely on your computer. The
desktop extension bundles the whole platform — the engine, its local
web app, and an MCP server that lets an AI assistant (such as Claude)
drive it. The engine binds to `127.0.0.1` only and never calls any AI
service itself: the assistant reads and transcribes; the math is
deterministic and local.

## Data we collect

**None.** OpenRater has no accounts, no sign-in, no telemetry, no
analytics, no crash reporting, and no servers of ours that receive your
data. We (the OpenRater developers) never see your filings, plans,
books, quotes, or usage.

## Where your data lives

Everything OpenRater stores — rating plans, build reports (including
the ingested workbook bytes), run results, versions — is written to a
local SQLite database and local files in the extension's data directory
on your machine. Deleting the extension's data directory deletes the
data. Backups are yours to make; OpenRater does not copy your data
anywhere.

## What travels between components

By default, traffic between the three bundled components is
loopback-only (`127.0.0.1`): the MCP server, the rating engine, and the
review app in your browser. No component opens inbound ports to your
network or makes outbound calls to OpenRater's developers. The only
exception is an optional third-party connector that you explicitly
configure, as described below.

## Your AI assistant

When you drive OpenRater from an AI assistant, the content you place in
that conversation (for example, a filing PDF you ask it to transcribe,
or a quote result it reads back to you) is processed by the assistant
under **its** provider's privacy policy — for Claude, Anthropic's
policy applies to the conversation itself. OpenRater's tools are built
to keep bulk data out of the chat: books of business travel as local
file paths, row-level results stay in the local app, and chat responses
carry counts and summaries rather than row dumps.

## Optional third-party connectors

OpenRater's API Lab can optionally connect a plan's inputs to external
data APIs (for example, an address-validation service) — **only if you
add such a connector and supply your own API key**. These connectors
are off by default and none are required. If you enable one, the
specific fields you route to it are sent to that provider under that
provider's privacy policy, using your key. Keys you enter are stored
locally on your machine.

## Data sharing

We share nothing, because we hold nothing. There are no third parties
receiving data from us, no advertising, and no sale of data.

## Data retention

Retention is entirely under your control: data exists only on your
machine, for as long as you keep it. Uninstalling the extension and
removing its data directory removes everything.

## Children's privacy

OpenRater is a professional tool for insurance rate-making and is not
directed at children.

## Changes to this policy

If a future version of OpenRater changes any of the above (for
example, adding an opt-in update check), this policy will be updated in
the project repository before that version ships, with the change
described plainly.

## Contact

Questions about this policy: open an issue at
<https://github.com/vadim-filimonov/openrater/issues>.
