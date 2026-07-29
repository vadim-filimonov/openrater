/**
 * Exhibits — the stage's annotation sentence (Brief: portfolio-redesign
 * v2, P5 workbench).
 *
 * Every chart on the stage carries ONE editorial line telling the
 * reader what to see — the graphics-desk move. Like the lede, it is a
 * TEMPLATE over counted facts: deterministic, data-derived, never
 * prose-by-AI. Portrait frames name the extremes; compare frames name
 * the biggest move and how much of the table moved.
 */

import type { LevelValue } from "./anatomy";

/** ×2.10 style — the story speaks factor language. */
function x(v: number): string {
  return `×${v.toFixed(2)}`;
}

function pct(from: number, to: number): string {
  const p = (to / from - 1) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export interface StoryInput {
  readonly kind: "bars" | "curve" | "grid" | "flat";
  /** A-side values in DRAWING order (1-D kinds). */
  readonly values: readonly LevelValue[];
  /** B-side values by level id — null in the portrait. */
  readonly bValues: ReadonlyMap<string, number> | null;
  /** Grid/flat cells (A side) keyed by cell key. */
  readonly cells: Readonly<Record<string, number>>;
  readonly bCells: Readonly<Record<string, number>> | null;
}

/** The compare frame: the biggest move + how much of the table moved.
 *  `noun` matches the table's grain — levels for 1-D, cells for grids. */
function compareStory(
  pairs: readonly { readonly label: string; readonly a: number; readonly b: number }[],
  noun: "level" | "cell",
): string | null {
  const moved = pairs.filter((p) => Math.abs(p.b - p.a) > 1e-9);
  if (moved.length === 0) return "Identical on both sides, cell for cell.";
  let biggest = moved[0];
  if (biggest === undefined) return null;
  for (const p of moved) {
    const move = p.a !== 0 ? Math.abs(p.b / p.a - 1) : Math.abs(p.b - p.a);
    const best =
      biggest.a !== 0
        ? Math.abs(biggest.b / biggest.a - 1)
        : Math.abs(biggest.b - biggest.a);
    if (move > best) biggest = p;
  }
  const scope =
    moved.length === pairs.length
      ? `every ${noun} moves`
      : `${moved.length} of ${pairs.length} ${noun}s move`;
  return `Biggest move: ${biggest.label} ${x(biggest.a)} → ${x(biggest.b)} (${pct(biggest.a, biggest.b)}) — ${scope}.`;
}

export function stageStory(input: StoryInput): string | null {
  // ── Compare frames ─────────────────────────────────────────────────
  if (input.bValues !== null && input.kind !== "grid" && input.kind !== "flat") {
    const pairs = input.values
      .map((v) => {
        const b = input.bValues?.get(v.id);
        return b === undefined ? null : { label: v.label, a: v.value, b };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (pairs.length > 0) return compareStory(pairs, "level");
  }
  if (input.bCells !== null && (input.kind === "grid" || input.kind === "flat")) {
    const pairs = Object.entries(input.cells)
      .map(([key, a]) => {
        const b = input.bCells?.[key];
        return b === undefined
          ? null
          : { label: key.replace("::", " × "), a, b };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (pairs.length > 0) return compareStory(pairs, "cell");
  }

  // ── Portrait frames ────────────────────────────────────────────────
  if (input.kind === "curve" && input.values.length >= 2) {
    const first = input.values[0];
    const last = input.values[input.values.length - 1];
    if (first === undefined || last === undefined) return null;
    const verb = last.value < first.value ? "slides" : "climbs";
    return `${verb === "slides" ? "Slides" : "Climbs"} from ${x(first.value)} at ${first.label} to ${x(last.value)} at ${last.label}.`;
  }
  if (input.kind === "bars" && input.values.length >= 2) {
    let top = input.values[0];
    let bottom = input.values[0];
    for (const v of input.values) {
      if (top === undefined || v.value > top.value) top = v;
      if (bottom === undefined || v.value < bottom.value) bottom = v;
    }
    if (top === undefined || bottom === undefined || top.id === bottom.id)
      return null;
    return `${top.label} carries the highest factor (${x(top.value)}); ${bottom.label} the lowest (${x(bottom.value)}).`;
  }
  if (input.kind === "grid") {
    const entries = Object.entries(input.cells);
    if (entries.length < 2) return null;
    let top = entries[0];
    let bottom = entries[0];
    for (const e of entries) {
      if (top === undefined || e[1] > top[1]) top = e;
      if (bottom === undefined || e[1] < bottom[1]) bottom = e;
    }
    if (top === undefined || bottom === undefined) return null;
    return `Tops out at ${top[0].replace("::", " × ")} (${x(top[1])}); the floor is ${bottom[0].replace("::", " × ")} (${x(bottom[1])}).`;
  }
  return null;
}
