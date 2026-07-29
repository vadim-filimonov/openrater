/**
 * `subplan` kind — embed another Plan as a callable.
 *
 * Per Plan Format Spec v1 §4.5 + §5.5: a `subplan` node holds an
 * inner Plan and behaves like one node from the outer plan's
 * perspective:
 *
 *   · Inputs — the inner plan's `input` / `input.source` node names
 *     become the subplan node's input ports (derived dynamically via
 *     `derivedPorts(params)`).
 *   · Outputs — the inner plan's `output` node names become the
 *     subplan node's output ports.
 *   · Execution — `execute()` is never invoked; the runtime
 *     SPECIAL-CASES the subplan kind id (runtime.ts ~line 256) and
 *     handles recursive compile + run + trace nesting directly. The
 *     stub here satisfies the BlockKind contract for callers that
 *     bypass the runtime.
 *
 * Per spec §5.5: recursive subplans (a plan that transitively
 * references itself) are FORBIDDEN and MUST be rejected at compile
 * time as a `cycle` error.
 *
 * Ported from `<prototype>/plan-builder/src/blocks/kinds/
 * subplan.tsx` (Phase A.1 PR 9). PURE half only.
 */

import type { BlockKind, PortSpec } from "../block-types";
import type { Plan } from "../plan-types";

export interface SubplanParams {
  /** The inner Plan to embed and execute. */
  plan: Plan;
  /** Human-readable label for the subplan instance. */
  label?: string;
  /** Optional citation reference for the embedded plan. */
  citation?: string;
}

export type SubplanInputs = Record<string, unknown>;
export type SubplanOutputs = Record<string, unknown>;

const EMPTY_PLAN: Plan = {
  id: "subplan-empty",
  version: "0.0.0",
  name: "Empty subplan",
  nodes: [],
  edges: [],
};

export const SubplanKind: BlockKind<
  SubplanParams,
  SubplanInputs,
  SubplanOutputs
> = {
  id: "subplan",
  category: "chain",
  label: "Subplan",
  description: "Embed another Plan as a callable subroutine",
  inputs: [],
  outputs: [],
  defaultParams: { plan: EMPTY_PLAN },
  defaultSize: "regular",
  provenance: "core",
  certainty: "draft",
  determinism: "strict",
  sideEffects: "none",
  // Inputs / outputs are derived from the embedded plan's input /
  // output nodes so the subplan node looks like a typed function
  // whose signature mirrors the inner plan's I/O contract.
  derivedPorts: (params) => {
    const inputs: PortSpec[] = [];
    const outputs: PortSpec[] = [];
    for (const node of params.plan.nodes) {
      if (node.kind === "input" || node.kind === "input.source") {
        const np = node.params as
          | { fieldName?: string; fieldType?: string; description?: string }
          | undefined;
        const name = np?.fieldName;
        if (typeof name === "string" && name.length > 0) {
          inputs.push({
            name,
            type: (np?.fieldType ?? "string") as PortSpec["type"],
            description: np?.description,
          } as PortSpec);
        }
      } else if (node.kind === "output") {
        const np = node.params as
          | { fieldName?: string; fieldType?: string; description?: string }
          | undefined;
        const name = np?.fieldName;
        if (typeof name === "string" && name.length > 0) {
          outputs.push({
            name,
            type: (np?.fieldType ?? "string") as PortSpec["type"],
            description: np?.description,
          } as PortSpec);
        }
      }
    }
    return { inputs, outputs };
  },
  execute: (_inputs, _params) => {
    // Stub — the runtime handles subplan execution directly.
    return {};
  },
  validate: (params) => {
    if (!params.plan || typeof params.plan !== "object") {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "plan is required (the inner Plan to embed)",
            field: "plan",
          },
        ],
      };
    }
    if (!Array.isArray(params.plan.nodes)) {
      return {
        valid: false,
        issues: [
          {
            severity: "error",
            message: "plan.nodes must be an array",
            field: "plan",
          },
        ],
      };
    }
    if (params.plan.nodes.length === 0) {
      return {
        valid: true,
        issues: [
          {
            severity: "warning",
            message:
              "Embedded plan has no nodes; subplan will produce empty outputs",
            field: "plan",
          },
        ],
      };
    }
    return { valid: true, issues: [] };
  },
};
