/**
 * `unknown` kind — forward-compatibility placeholder.
 *
 * Plan Format Spec v1 §4.5 reserves this kind for plans that
 * reference a kind id this runtime does not yet know about. Used
 * by tools that need to load + inspect + migrate plans built
 * against newer versions of the spec rather than failing to
 * compile.
 *
 * `execute()` is a no-op — this kind should never actually run.
 * The compile layer surfaces an `unknown-kind` warning before any
 * runtime attempt. The optional params (`originalKind`,
 * `originalParams`) preserve the original kind reference + params
 * so a round-trip load → save doesn't drop data.
 *
 * Ported from `<prototype>/plan-builder/src/blocks/kinds/
 * unknown.tsx` (Phase A.1 PR 9). PURE half only.
 */

import type { BlockKind } from "../block-types";

export interface UnknownParams {
  /** The kind id the plan referenced (preserved for round-trip). */
  originalKind?: string;
  /** The params the plan supplied (preserved opaquely). */
  originalParams?: unknown;
}

export type UnknownInputs = Record<string, unknown>;
export type UnknownOutputs = Record<string, unknown>;

export const UnknownKind: BlockKind<
  UnknownParams,
  UnknownInputs,
  UnknownOutputs
> = {
  id: "unknown",
  category: "custom",
  label: "Unknown kind",
  description:
    "Forward-compatibility placeholder for kinds this runtime does not recognize",
  inputs: [],
  outputs: [],
  defaultParams: {},
  defaultSize: "compact",
  provenance: "core",
  certainty: "experimental",
  determinism: "strict",
  sideEffects: "none",
  execute: (_inputs, _params) => ({}),
};
