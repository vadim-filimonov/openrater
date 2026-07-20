/**
 * <RatingChainsSection> — the Coverage Chains section pane content.
 *
 * Reads `multiplicative_chain` stages from the active plan and renders
 * one `<RatingChainCard>` per `ChainSpec` inside each stage's
 * `config_json.chains[]`. A single chain stage typically carries 1–3
 * `ChainSpec`s (Building / BPP / Liability for BOP).
 *
 * Current behavior:
 *   · Read-only display of existing chain factors
 *   · "+ Add factor" opens the ChainFactorDrawer in add mode
 *   · Edit and remove callbacks identify the exact factor row
 *
 * Defensive against malformed config_json: a parse failure renders a
 * card-level error state per stage; the rest of the section keeps
 * rendering.
 */

import { Button } from "@openrater/design-system";
import { type StageSummary } from "@openrater/api-client";
import {
  multiplicativeChainConfigSchema,
  type ChainSpec,
  type FactorLookup,
  type MultiplicativeChainConfig,
} from "@openrater/contracts";
import { RatingChainCard, type ChainFactor } from "@openrater/ui";
import { Plus } from "lucide-react";

/**
 * Identifies one Coverage-Chain-card-able unit: a stage + the chain
 * index within its `config_json.chains[]`.
 */
export interface ChainContext {
  readonly stageId: string;
  readonly chainIndex: number;
  readonly chainName: string;
  /**
   * Form-input path the chain's subtotal lives at, used by the
   * adapter when authoring a sibling flat_factor / formula stage.
   * Synthesized as `stages.{stageId}.{output_field}`.
   */
  readonly chainOutputPath: string;
}

/**
 * Identifies one specific factor row in a chain — stage + chainIndex
 * + factorIndex. Used by edit and remove flows.
 */
export interface FactorContext extends ChainContext {
  readonly factorIndex: number;
}

export interface RatingChainsSectionProps {
  readonly stages: readonly StageSummary[];
  readonly onAddFactor: (ctx: ChainContext) => void;
  readonly onEditFactor: (ctx: FactorContext) => void;
  readonly onRemoveFactor: (ctx: FactorContext) => void;
  /** Fires when the actuary clicks edit/remove on the synthetic
   *  Carrier LCM row. The LCM is carrier-set + mandatory, so the
   *  caller usually shows a toast explaining it can't be edited
   *  via this affordance. */
  readonly onLcmAction?: () => void;
  readonly onAddChain: () => void;
}

/**
 * Encodes a factor row's location for round-tripping through the
 * RatingChainCard's `onEditFactor` / `onRemoveFactor` callbacks
 * (those callbacks only get a string `factorId`).
 *
 * Format: `${stageId}__${chainIndex}__${factorIndex}` — fully
 * positional, robust against chain renames.
 *
 * The synthetic LCM row uses `${stageId}__${chainIndex}__lcm` so
 * the route can detect + handle it separately (LCM editing isn't
 * wired today; clicking it toasts).
 */
export function encodeFactorId(
  stageId: string,
  chainIndex: number,
  factorIndex: number,
): string {
  return `${stageId}__${chainIndex}__${factorIndex}`;
}

export function decodeFactorId(
  id: string,
): { stageId: string; chainIndex: number; factorIndex: number } | null {
  const parts = id.split("__");
  if (parts.length < 3) return null;
  const factorIndex = Number(parts[parts.length - 1]);
  const chainIndex = Number(parts[parts.length - 2]);
  if (!Number.isInteger(factorIndex) || !Number.isInteger(chainIndex)) {
    return null;
  }
  const stageId = parts.slice(0, -2).join("__");
  return { stageId, chainIndex, factorIndex };
}

export function RatingChainsSection({
  stages,
  onAddFactor,
  onEditFactor,
  onRemoveFactor,
  onLcmAction,
  onAddChain,
}: RatingChainsSectionProps): JSX.Element {
  const onLcm = onLcmAction ?? (() => undefined);
  const chainStages = stages.filter(
    (s) => s.stage_kind === "multiplicative_chain",
  );

  if (chainStages.length === 0) {
    return (
      <div className="rating-chains-section__empty">
        <p className="rating-chains-section__empty-headline">
          No rating chains yet.
        </p>
        <p className="rating-chains-section__empty-subtext">
          A rating chain is the heart of a coverage premium —
          <code> base × class × construction × territory × … </code>.
          Add one to start authoring multipliers.
        </p>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={onAddChain}
        >
          Add first chain
        </Button>
      </div>
    );
  }

  return (
    <div className="rating-chains-section__cards">
      {chainStages.map((stage) => {
        const parsed = safeParseChainConfig(stage.config_json);
        if (!parsed.ok) {
          return (
            <StageParseErrorCard
              key={stage.stage_id}
              stageDisplayName={stage.display_name}
              error={parsed.error}
            />
          );
        }
        return parsed.config.chains.map((chain, chainIndex) => {
          const chainCtx: ChainContext = {
            stageId: stage.stage_id,
            chainIndex,
            chainName: chain.name,
            chainOutputPath: `stages.${stage.stage_id}.${chain.output_field}`,
          };
          const handleFactorAction = (
            handler: (ctx: FactorContext) => void,
            onLcm: () => void,
          ) => (factorId: string) => {
            const decoded = decodeFactorId(factorId);
            if (decoded === null) {
              // LCM rows have non-numeric "lcm" suffix. The carrier
              // LCM is mandatory + carrier-set, so it has no inline
              // edit/remove affordance — surface a toast so the
              // click isn't silently swallowed.
              onLcm();
              return;
            }
            handler({ ...chainCtx, factorIndex: decoded.factorIndex });
          };
          return (
            <RatingChainCard
              key={`${stage.stage_id}__${chainIndex}`}
              title={chain.name}
              operator="multiply"
              base={describeBase(chain)}
              factors={chainSpecToCardFactors(chain, stage.stage_id, chainIndex)}
              output_label={chain.output_field}
              onAddFactor={() => onAddFactor(chainCtx)}
              onEditFactor={handleFactorAction(onEditFactor, onLcm)}
              onRemoveFactor={handleFactorAction(onRemoveFactor, onLcm)}
              testId={`rating-chain-card__${stage.stage_id}__${chainIndex}`}
            />
          );
        });
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ParseResult =
  | { readonly ok: true; readonly config: MultiplicativeChainConfig }
  | { readonly ok: false; readonly error: string };

function safeParseChainConfig(
  raw: Record<string, unknown> | null,
): ParseResult {
  // User-facing copy carries no schema or field-name jargon; the raw parse
  // error is logged for developers, not shown.
  if (raw === null || raw === undefined) {
    return { ok: false, error: "This coverage chain couldn't load." };
  }
  const parsed = multiplicativeChainConfigSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, config: parsed.data };
  }
  if (import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.warn("chain config parse error:", parsed.error.errors);
  }
  return { ok: false, error: "This coverage chain couldn't load." };
}

/**
 * Builds the card's `factors` prop from a ChainSpec's factor_lookups
 * plus its mandatory carrier LCM. Factor IDs are positional
 * (`${stageId}__${chainIndex}__${factorIndex}`) so they round-trip
 * through the card's onEditFactor / onRemoveFactor callbacks.
 */
function chainSpecToCardFactors(
  chain: ChainSpec,
  stageId: string,
  chainIndex: number,
): ChainFactor[] {
  const rows: ChainFactor[] = chain.factor_lookups.map((fl, factorIndex) =>
    factorLookupToChainFactor(fl, stageId, chainIndex, factorIndex),
  );
  rows.push({
    id: `${stageId}__${chainIndex}__lcm`,
    label: "Carrier LCM",
    kind: "lcm",
    // `input_path` is optional: an authored-constant
    // LCM carries `value` instead). Coalesce to undefined; surfacing the
    // authored value in the card is handled by the inspector.
    resolves_to: chain.lcm.input_path ?? undefined,
  });
  return rows;
}

function factorLookupToChainFactor(
  fl: FactorLookup,
  stageId: string,
  chainIndex: number,
  factorIndex: number,
): ChainFactor {
  return {
    id: encodeFactorId(stageId, chainIndex, factorIndex),
    label: fl.name,
    // `interpolated` (the legacy curve wire shape) maps to
    // "lookup.range" (a banded factor table, the closest UI label).
    kind: fl.lookup_method === "interpolated" ? "lookup.range" : "lookup.direct",
    resolves_to: describeResolution(fl),
  };
}

function describeResolution(fl: FactorLookup): string {
  const dimKeys = Object.keys(fl.dimensions);
  if (dimKeys.length === 0) return fl.factor_kind;
  if (dimKeys.length === 1) {
    return `${fl.factor_kind}[${dimKeys[0]}]`;
  }
  return `${fl.factor_kind}[${dimKeys.join(", ")}]`;
}

function describeBase(chain: ChainSpec): string {
  return chain.base_input;
}

function StageParseErrorCard({
  stageDisplayName,
  error,
}: {
  stageDisplayName: string;
  error: string;
}): JSX.Element {
  return (
    <div className="rating-chains-section__parse-error" role="alert">
      {/* Keep raw errors and "stage JSON" jargon off the user surface. */}
      <strong>{stageDisplayName}</strong> — {error} Try removing and
      re-adding this coverage.
    </div>
  );
}
