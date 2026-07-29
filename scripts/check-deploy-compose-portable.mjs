#!/usr/bin/env node
/**
 * check-deploy-compose-portable — a demo box must deploy from a fresh
 * `cp deploy/.env.example deploy/.env`, and an OPTIONAL profile must never
 * block a box that didn't opt into it.
 *
 * The bug this locks out (hit on the live demo box, 2026-07-14): the
 * profile-gated `spine` service (Brief 85) declared
 *
 *     SPINE_DATABASE_URL: ${SPINE_DATABASE_URL:?set in deploy/.env — …}
 *
 * Compose interpolates the WHOLE file before it filters by profile, so that
 * `:?` (error when unset OR empty) hard-failed `docker compose up` for every
 * deployment that never opted into spine — breaking the service's own stated
 * promise ("PROFILE-GATED: a box that never opts in deploys byte-identically")
 * and even rejecting the repo's shipped `.env.example`, which ships the key
 * blank. A box mid-upgrade could not deploy at all.
 *
 * Two invariants, both static:
 *
 *   1. A service that declares `profiles:` must not hard-require any env var
 *      (`${VAR:?…}`). Give it `${VAR:-}` and let the service validate at
 *      RUNTIME — only an opted-in deploy can reach that check.
 *   2. Any hard-required var on an always-on service must ship a NON-EMPTY
 *      value in `deploy/.env.example`, so a fresh copy always parses.
 */
import { readFileSync } from "node:fs";

const COMPOSE = "deploy/docker-compose.yml";
const ENV_EXAMPLE = "deploy/.env.example";

// ${VAR:?msg} — Compose's "required": errors when VAR is unset OR empty.
const REQUIRED_VAR = /\$\{([A-Z_][A-Z0-9_]*):\?/g;

let compose;
try {
  compose = readFileSync(COMPOSE, "utf8");
} catch {
  console.log(`check-deploy-compose-portable: ${COMPOSE} absent — skipped.`);
  process.exit(0);
}

// Walk the file, attributing each line to its top-level service (2-space key
// under `services:`) and noting which services are profile-gated.
const lines = compose.split("\n");
const services = new Map(); // name → { profiled: boolean, required: [{var, line}] }
let inServices = false;
let current = null;

lines.forEach((raw, i) => {
  const line = raw.replace(/\r$/, "");
  if (/^\s*#/.test(line)) return; // whole-line comment

  if (/^services:\s*$/.test(line)) {
    inServices = true;
    return;
  }
  if (!inServices) return;
  // A new top-level key (column 0) ends the services block.
  if (/^\S/.test(line)) {
    inServices = false;
    current = null;
    return;
  }

  const svc = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
  if (svc) {
    current = svc[1];
    services.set(current, { profiled: false, required: [] });
    return;
  }
  if (!current) return;

  if (/^ {4}profiles:/.test(line)) {
    services.get(current).profiled = true;
  }
  for (const m of line.matchAll(REQUIRED_VAR)) {
    services.get(current).required.push({ var: m[1], line: i + 1 });
  }
});

// deploy/.env.example → the values a fresh box actually starts from.
const envExample = new Map();
try {
  for (const raw of readFileSync(ENV_EXAMPLE, "utf8").split("\n")) {
    const m = raw.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) envExample.set(m[1], m[2].trim());
  }
} catch {
  console.error(`✗ check-deploy-compose-portable: ${ENV_EXAMPLE} is missing.`);
  process.exit(1);
}

const errors = [];

for (const [name, svc] of services) {
  for (const req of svc.required) {
    if (svc.profiled) {
      errors.push(
        `${COMPOSE}:${req.line} — service \`${name}\` is profile-gated but ` +
          `hard-requires \`${req.var}\` via \${...:?}. Compose interpolates the ` +
          `whole file BEFORE filtering profiles, so this breaks every deploy ` +
          `that never opts into \`${name}\`. Use \${${req.var}:-} and validate ` +
          `at runtime inside the service.`,
      );
    } else if (!envExample.get(req.var)) {
      errors.push(
        `${COMPOSE}:${req.line} — \`${req.var}\` is hard-required by always-on ` +
          `service \`${name}\`, but ${ENV_EXAMPLE} ships it ` +
          `${envExample.has(req.var) ? "EMPTY" : "MISSING"}. A fresh ` +
          `\`cp .env.example .env\` would fail to deploy.`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(
    "✗ check-deploy-compose-portable: the demo deploy is blocked for boxes " +
      "that didn't opt into an optional profile.",
  );
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const profiled = [...services].filter(([, s]) => s.profiled).map(([n]) => n);
console.log(
  `✓ check-deploy-compose-portable: ${services.size} services ` +
    `(${profiled.length} profile-gated: ${profiled.join(", ") || "none"}) — ` +
    `no optional profile blocks a deploy; .env.example parses.`,
);
