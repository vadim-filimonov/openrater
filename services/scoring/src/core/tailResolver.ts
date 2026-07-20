/**
 * tailResolver — the service-side `AdjustmentResolver` for a plan's
 * final-adjustments tail (Brief 75 phase 3; Law 1).
 *
 * The browser resolves a tail's non-literal sources through
 * `makeIrpmAdjustmentResolver`; this module is the SAME construction
 * minus React. Literal + column sources need no I/O.
 *
 * The `{from:"model"}` arm is retired with the model registry: a tail
 * that still carries one refuses BY NAME
 * (`ServiceError` here → `composition_failed` at the caller), never a
 * silent identity factor (Law 2). Scores enter plans as typed inputs
 * and resolve through the `column` source.
 */

import {
  makeIrpmAdjustmentResolver,
  MODEL_SOURCE_RETIRED_MESSAGE,
} from "@openrater/contracts";
import type {
  AdjustmentResolver,
  PolicyAdjustment,
} from "@openrater/contracts";

import { badRequest } from "./errors";

/** The retired model refs a legacy tail still pins (schedule_rating /
 *  endorsement adjustments with `source.from === "model"`). Structural —
 *  the arm no longer exists in the `IrpmSourceSpec` type. */
export function collectLegacyTailModelRefs(
  tail: readonly PolicyAdjustment[] | null | undefined,
): string[] {
  const refs: string[] = [];
  for (const adj of tail ?? []) {
    if (adj.kind !== "schedule_rating" && adj.kind !== "endorsement") continue;
    const source = (adj as { source?: { from?: unknown; model_id?: unknown; version?: unknown } }).source;
    if (source?.from === "model") {
      refs.push(`${String(source.model_id ?? "?")}@${String(source.version ?? "?")}`);
    }
  }
  return refs;
}

/**
 * Build the tail's `AdjustmentResolver`, or `undefined` when there is
 * no tail. A legacy model-sourced adjustment refuses up front with the
 * canonical S1 message (naming the pinned refs), so the caller's
 * `composition_failed` surface says exactly what to migrate.
 */
export function buildTailResolver(
  tail: readonly PolicyAdjustment[] | null | undefined,
): AdjustmentResolver | undefined {
  if (!tail || tail.length === 0) return undefined;
  const legacy = collectLegacyTailModelRefs(tail);
  if (legacy.length > 0) {
    throw badRequest(
      `This plan's final-adjustments tail pins model source(s) ` +
        `[${legacy.join(", ")}] — ${MODEL_SOURCE_RETIRED_MESSAGE}`,
    );
  }
  return makeIrpmAdjustmentResolver();
}
