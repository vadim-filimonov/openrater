/**
 * WCAG contrast gate over the token file (FCA fca-2026-07-25 #32).
 *
 * The instrumented visual pass measured the muted-ink family below
 * WCAG AA on ~1,300 instances across both themes — the parked
 * workspace tabs sat near-invisible at ~2.5:1, light-theme rating
 * annotations at 2.46:1, the preflight warning at 2.06:1, and
 * "Discard plan" at 3.61:1. Nothing in CI computed a ratio, so one
 * dim token failed everywhere, silently.
 *
 * This test parses tokens.css directly (no DOM), resolves the alias
 * chains per theme, and asserts every READABLE text tier clears
 * 4.5:1 (WCAG AA, normal text) against every text-bearing surface of
 * its theme. `--rater-text-disabled` is deliberately exempt:
 * non-interactive, conventionally dimmed.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "tokens.css"),
  "utf8",
);

/** All `--x: value;` pairs inside the block following `selector`. */
function blockVars(selector: string): Map<string, string> {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = CSS.indexOf("{", start);
  let depth = 1;
  let i = open + 1;
  while (i < CSS.length && depth > 0) {
    if (CSS[i] === "{") depth += 1;
    if (CSS[i] === "}") depth -= 1;
    i += 1;
  }
  const body = CSS.slice(open + 1, i - 1);
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

const ROOT = blockVars(":root {");
const LIGHT = new Map([...ROOT, ...blockVars(':root[data-theme="light"]')]);

/** Resolve a token to a #hex through var() chains. */
function resolve(vars: Map<string, string>, name: string): string {
  let value: string | undefined = name.startsWith("--")
    ? vars.get(name)
    : name;
  for (let hops = 0; hops < 10 && value !== undefined; hops += 1) {
    const m = value.match(/^var\((--[a-z0-9-]+)\)$/);
    if (!m) break;
    value = vars.get(m[1]!);
  }
  if (value === undefined || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`token ${name} did not resolve to a hex (got ${value})`);
  }
  return value;
}

function luminance(hex: string): number {
  const c = (i: number): number => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const AA = 4.5;
const READABLE_TEXT = [
  "--rater-text-default",
  "--rater-text-muted",
  "--rater-text-subtle",
  "--rater-text-faint",
] as const;
const TEXT_SURFACES = [
  "--rater-surface-canvas",
  "--rater-surface-1",
  "--rater-surface-2",
] as const;

describe.each([
  ["dark", ROOT],
  ["light", LIGHT],
] as const)("WCAG AA — %s theme", (_theme, vars) => {
  it.each(READABLE_TEXT.flatMap((t) => TEXT_SURFACES.map((s) => [t, s])))(
    "%s clears 4.5:1 on %s",
    (text, surface) => {
      const ratio = contrast(
        resolve(vars, text as string),
        resolve(vars, surface as string),
      );
      expect(ratio).toBeGreaterThanOrEqual(AA);
    },
  );

  it("on-accent text clears 4.5:1 on the danger fill (the Discard button)", () => {
    expect(
      contrast(
        resolve(vars, "--rater-on-accent"),
        resolve(vars, "--rater-accent-danger"),
      ),
    ).toBeGreaterThanOrEqual(AA);
  });

  it("the accent TEXT roles clear 4.5:1 on their theme's card surface", () => {
    for (const token of [
      "--rater-accent-primary-text",
      "--rater-accent-danger-text",
      "--rater-accent-warning",
    ]) {
      expect(
        contrast(resolve(vars, token), resolve(vars, "--rater-surface-1")),
        token,
      ).toBeGreaterThanOrEqual(AA);
    }
  });
});
