/**
 * tailSync — Brief 70 §2 / Phase 3 (the §8/§9 move).
 *
 * Bridges the Final-adjustments TAIL drafts (ModifierDraft /
 * EndorsementDraft from @openrater/ui) with the substrate's stage
 * kinds. This is gatesSync trimmed to the two kinds that moved into
 * the Algorithm's Final adjustments: modifier schedules + endorsements.
 * The filter arms died with the GateCanvas — `appetiteSync` owns the
 * eligibility document now (one consolidated stage per scope).
 *
 * V1 scope carried verbatim from gatesSync:
 *   · Modifiers: SCHEDULE kind only (`modifier.schedule` is the only
 *     substrate modifier kind). Flat/Provision drafts refuse.
 *   · Endorsements: all four effect kinds (factor / additive /
 *     sublimit / rate_branch) map 1:1.
 *   · Value coercion preserves leading-zero strings (Brief 69 §3.1 —
 *     class codes '0521' and ZIPs '01040' stay strings).
 */

import {
  emptyModifierDraft,
  type ModifierDraft,
  type EndorsementDraft,
} from "@openrater/ui";
import type { AddStageRequest, StageSummary } from "@openrater/api-client";

export type TailEntry =
  | { readonly kind: "modifier"; readonly id: string; readonly draft: ModifierDraft }
  | {
      readonly kind: "endorsement";
      readonly id: string;
      readonly draft: EndorsementDraft;
    };

// ── Value coercion (round-trip stable; leading zeros stay strings) ──

function coerceScalar(s: string): unknown {
  if (s === "") return "";
  if (s === "true") return true;
  if (s === "false") return false;
  const n = Number(s);
  if (
    !Number.isNaN(n) &&
    Number.isFinite(n) &&
    /^-?(0|[1-9]\d*)(\.\d+)?$/.test(s)
  ) {
    return n;
  }
  return s;
}

function coerceValueOut(raw: string, op: string): unknown {
  const trimmed = raw.trim();
  if (op === "in" || op === "nin") {
    return trimmed
      .split(",")
      .map((s) => coerceScalar(s.trim()))
      .filter((s) => s !== "");
  }
  return coerceScalar(trimmed);
}

function coerceValueIn(raw: unknown, op: string): string {
  if (op === "in" || op === "nin") {
    if (Array.isArray(raw)) return raw.map(String).join(", ");
    return String(raw ?? "");
  }
  return String(raw ?? "");
}

// ── Forward: draft → AddStageRequest ────────────────────────────────

export function modifierDraftIsLossy(draft: ModifierDraft): boolean {
  return draft.kind !== "schedule";
}

export function modifierDraftToStageRequest(
  entryId: string,
  draft: ModifierDraft,
): AddStageRequest | null {
  if (draft.kind !== "schedule") return null;
  if (draft.categories.length === 0) return null;
  // F06 — the substrate requires every category's name to be non-empty
  // (min_length≥1). A draft with an unnamed category must not produce a request
  // — it would 422. Returning null lets the caller surface "name a category"
  // instead of firing a doomed POST.
  if (draft.categories.some((c) => c.name.trim().length === 0)) return null;
  return {
    stage_id: entryId,
    stage_kind: "modifier.schedule",
    display_name: draft.display_name || entryId,
    inputs: [],
    outputs: [],
    config_json: {
      schedule: {
        schedule_id: draft.modifier_id || entryId,
        display_name: draft.display_name || entryId,
        scope: "package" as const,
        total_cap_pct: draft.cap_pct,
        categories: draft.categories.map((c) => {
          const out: {
            category_id: string;
            name: string;
            range_pct: number;
            reasoning_required: boolean;
            tier_filter?: readonly string[];
          } = {
            category_id: c.id,
            name: c.name,
            // Substrate stores ±N% as one magnitude; the larger of
            // |lo|, |hi| is the conservative cap.
            range_pct: Math.max(
              Math.abs(c.range_lo_pct),
              Math.abs(c.range_hi_pct),
            ),
            reasoning_required: c.reasoning_required,
          };
          if (c.tier_filter.length > 0) out.tier_filter = c.tier_filter;
          return out;
        }),
        ...(draft.citation ? { citation: draft.citation } : {}),
      },
    },
  };
}

export function endorsementDraftToStageRequest(
  entryId: string,
  draft: EndorsementDraft,
): AddStageRequest | null {
  // Trigger may be empty (= always attach) — substrate accepts null.
  const trigger =
    draft.trigger.variable.trim() === ""
      ? null
      : {
          variable: draft.trigger.variable,
          op: draft.trigger.op,
          value: coerceValueOut(draft.trigger.value, draft.trigger.op),
        };

  const base = {
    stage_id: entryId,
    display_name: draft.display_name || entryId,
    inputs: [] as never[],
    outputs: [] as never[],
  };

  if (draft.effect_kind === "factor") {
    return {
      ...base,
      stage_kind: "endorsement.factor",
      config_json: {
        form_number: draft.form_number,
        display_name: draft.display_name || entryId,
        trigger,
        factor: draft.factor,
        ...(draft.citation ? { citation: draft.citation } : {}),
      },
    };
  }
  if (draft.effect_kind === "additive") {
    return {
      ...base,
      stage_kind: "endorsement.additive",
      config_json: {
        form_number: draft.form_number,
        display_name: draft.display_name || entryId,
        trigger,
        amount: draft.amount,
        ...(draft.citation ? { citation: draft.citation } : {}),
      },
    };
  }
  if (draft.effect_kind === "sublimit") {
    return {
      ...base,
      stage_kind: "endorsement.sublimit",
      config_json: {
        form_number: draft.form_number,
        display_name: draft.display_name || entryId,
        trigger,
        coverage: draft.sublimit_coverage,
        sublimit: draft.sublimit_value,
        ...(draft.citation ? { citation: draft.citation } : {}),
      },
    };
  }
  if (draft.effect_kind === "rate_branch") {
    const c = draft.branch_chain;
    const factorLookups = (c.factor_lookups ?? [])
      .filter(
        (row) =>
          row.name.trim().length > 0 &&
          row.factor_kind.trim().length > 0 &&
          row.dim_slug.trim().length > 0 &&
          row.source_path.trim().length > 0,
      )
      .map((row) => ({
        name: row.name,
        factor_kind: row.factor_kind,
        dimensions: {
          [row.dim_slug]: {
            source: "form_input",
            path: row.source_path,
          },
        },
      }));
    return {
      ...base,
      stage_kind: "endorsement.rate_branch",
      config_json: {
        form_number: draft.form_number,
        display_name: draft.display_name || entryId,
        trigger,
        branch_chain: {
          name: c.name,
          base_input: c.base_input,
          factor_lookups: factorLookups,
          lcm: {
            input_path: c.lcm_input_path || "form_input.lcm",
          },
          exposure_input: c.exposure_input,
          exposure_unit_divisor: c.exposure_unit_divisor,
          output_field: c.output_field,
        },
        ...(draft.citation ? { citation: draft.citation } : {}),
      },
    };
  }
  return null;
}

// ── Reverse: plan.stages → TailEntry[] ──────────────────────────────

export function planStagesToTailEntries(
  stages: readonly StageSummary[],
): TailEntry[] {
  const out: TailEntry[] = [];
  for (const stage of stages) {
    const cfg = stage.config_json as Record<string, unknown> | null;
    if (!cfg) continue;

    if (stage.stage_kind === "modifier.schedule") {
      const schedule = cfg.schedule as Record<string, unknown> | undefined;
      if (!schedule) continue;
      const categories =
        (schedule.categories as Array<Record<string, unknown>>) ?? [];
      const draft: ModifierDraft = {
        ...emptyModifierDraft(),
        modifier_id: (schedule.schedule_id as string) ?? stage.stage_id,
        display_name: stage.display_name,
        kind: "schedule",
        cap_pct: (schedule.total_cap_pct as number) ?? 0,
        categories: categories.map((c) => {
          const range = (c.range_pct as number) ?? 0;
          return {
            id: (c.category_id as string) ?? "",
            name: (c.name as string) ?? "",
            // Substrate's ±N% expands symmetrically on read.
            range_lo_pct: -range,
            range_hi_pct: range,
            reasoning_required: Boolean(c.reasoning_required),
            tier_filter: ((c.tier_filter as string[]) ?? []).slice(),
          };
        }),
        citation: (schedule.citation as string) ?? "",
      };
      out.push({ kind: "modifier", id: stage.stage_id, draft });
      continue;
    }

    if (
      stage.stage_kind === "endorsement.factor" ||
      stage.stage_kind === "endorsement.additive" ||
      stage.stage_kind === "endorsement.sublimit" ||
      stage.stage_kind === "endorsement.rate_branch"
    ) {
      const trigger = cfg.trigger as Record<string, unknown> | null | undefined;
      const branchChainStage = cfg.branch_chain as
        | Record<string, unknown>
        | undefined;
      // Decode factor_lookups from the embedded ChainSpec (v1: 1-D —
      // the first dimension key; gatesSync's H.5 scope carried as-is).
      const decodedFactorLookups = (() => {
        if (!branchChainStage) return [];
        const arr = branchChainStage.factor_lookups;
        if (!Array.isArray(arr)) return [];
        return arr.map((raw, idx) => {
          const r = raw as Record<string, unknown>;
          const dims =
            (r.dimensions as Record<string, Record<string, string>>) ?? {};
          const firstDimKey = Object.keys(dims)[0] ?? "";
          const firstDim = firstDimKey ? dims[firstDimKey] : undefined;
          return {
            id: `bfl-${idx}`,
            name: (r.name as string) ?? "",
            factor_kind: (r.factor_kind as string) ?? "",
            dim_slug: firstDimKey,
            source_path: (firstDim?.path as string) ?? "",
          };
        });
      })();
      const branchChain =
        stage.stage_kind === "endorsement.rate_branch" && branchChainStage
          ? {
              name: (branchChainStage.name as string) ?? "",
              base_input: (branchChainStage.base_input as string) ?? "",
              exposure_input:
                (branchChainStage.exposure_input as string) ?? "",
              exposure_unit_divisor:
                (branchChainStage.exposure_unit_divisor as number) ?? 1,
              lcm_input_path:
                ((branchChainStage.lcm as { input_path?: string })
                  ?.input_path) ?? "form_input.lcm",
              output_field: (branchChainStage.output_field as string) ?? "",
              factor_lookups: decodedFactorLookups,
            }
          : {
              name: "",
              base_input: "",
              exposure_input: "",
              exposure_unit_divisor: 1,
              lcm_input_path: "form_input.lcm",
              output_field: "",
              factor_lookups: [],
            };
      const draft: EndorsementDraft = {
        endorsement_id: stage.stage_id,
        form_number: (cfg.form_number as string) ?? "",
        display_name: stage.display_name,
        trigger: trigger
          ? {
              variable: (trigger.variable as string) ?? "",
              op:
                ((trigger.op as EndorsementDraft["trigger"]["op"]) || "eq"),
              value: coerceValueIn(
                trigger.value,
                (trigger.op as string) ?? "eq",
              ),
            }
          : { variable: "", op: "eq", value: "" },
        effect_kind:
          stage.stage_kind === "endorsement.factor"
            ? "factor"
            : stage.stage_kind === "endorsement.additive"
              ? "additive"
              : stage.stage_kind === "endorsement.sublimit"
                ? "sublimit"
                : "rate_branch",
        factor: (cfg.factor as number) ?? 1.0,
        amount: (cfg.amount as number) ?? 0,
        sublimit_coverage: (cfg.coverage as string) ?? "",
        sublimit_value: (cfg.sublimit as number) ?? 0,
        branch_chain: branchChain,
        citation: (cfg.citation as string) ?? "",
      };
      out.push({ kind: "endorsement", id: stage.stage_id, draft });
      continue;
    }
  }
  return out;
}
