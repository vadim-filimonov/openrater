/**
 * Canonical ordering helpers for the diff library.
 *
 * Determinism (Brief 12 P-CP4) requires the diff walker to traverse
 * both inputs in the SAME stable order. This module centralizes those
 * orderings so the diff stays reproducible across runs + machines.
 *
 *   - Object keys: sorted lexicographically.
 *   - Plan.nodes: sorted by node.id.
 *   - Plan.edges: sorted by composite (from.node | from.port | to.node | to.port).
 *   - Plan.citations: sorted by citation.id.
 *   - Plan.testBench: sorted by testCase.id.
 *   - Plan top-level fields: explicit canonical order (see PLAN_TOP_KEYS below).
 *   - Trace steps: walked in the topological execution order of the plan
 *     they came from (which is itself deterministic per the runtime).
 *
 * Pure functions. No mutation of inputs (returns new sorted arrays).
 *
 * Per Brief 12 §6 (Diff algorithm). Pure types — no React, no DOM.
 */

import type { Plan, PlanEdge, PlanNode } from "../plan-types";

/**
 * Top-level Plan fields in canonical traversal order. Driver for
 * `diffPlans` walking — every field listed here gets a row in the
 * diff tree (changed/unchanged/added/removed); fields NOT listed
 * here are ignored (currently none — Plan has no other public
 * fields). Future Plan extensions add their keys here in the right
 * structural position.
 */
export const PLAN_TOP_KEYS = Object.freeze([
  "id",
  "version",
  "name",
  "line", // legacy
  "lines",
  "jurisdiction",
  "effective",
  "nodes",
  "edges",
  "citations",
  "testBench",
] as const);

/** Sort plan nodes by id (lexicographic) without mutating the input. */
export function canonicalNodes(
  nodes: readonly PlanNode[],
): readonly PlanNode[] {
  return [...nodes].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/**
 * Canonical edge key — used to identify "the same edge" across two
 * versions of a plan. Composite of all four endpoint fields.
 */
export function edgeKey(edge: PlanEdge): string {
  return `${edge.from.node}|${edge.from.port}->${edge.to.node}|${edge.to.port}`;
}

/** Sort edges by canonical key without mutating the input. */
export function canonicalEdges(
  edges: readonly PlanEdge[],
): readonly PlanEdge[] {
  return [...edges].sort((x, y) => {
    const kx = edgeKey(x);
    const ky = edgeKey(y);
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
}

/**
 * Sort an object's keys lexicographically. Used when diffing
 * arbitrary nested params shapes.
 */
export function canonicalObjectKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).sort();
}

/**
 * Union of keys across two objects, sorted. The diff walker needs
 * this to walk every key that exists in EITHER side.
 */
export function unionKeys(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): string[] {
  const set = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  return [...set].sort();
}

/**
 * Union of identifiable items by id, sorted. Returns id strings for
 * downstream walkers.
 */
export function unionIds<T extends { readonly id: string }>(
  a: readonly T[],
  b: readonly T[],
): string[] {
  const set = new Set<string>([...a.map((x) => x.id), ...b.map((x) => x.id)]);
  return [...set].sort();
}

/**
 * Lookup map for nodes by id. Returns a plain Map so diff walkers
 * can find "is this id in plan A?" in O(1).
 */
export function nodesById(plan: Plan): Map<string, PlanNode> {
  const m = new Map<string, PlanNode>();
  for (const n of plan.nodes) m.set(n.id, n);
  return m;
}
