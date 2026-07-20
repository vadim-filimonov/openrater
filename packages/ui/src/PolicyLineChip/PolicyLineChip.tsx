/**
 * <PolicyLineChip> — one product line on a Policy (Brief 46 §5).
 *
 * The consistent chip for a bound product Plan: product badge + plan
 * name + pinned version + the output it writes + the line premium, with
 * optional expand (per-line build-up, J4), remove, and a "newer filed
 * version available" rebind hint (principle #3 — pin the version, never
 * drift silently).
 *
 * GENERICITY (ADR-0033 §0): the badge tone is derived from a stable
 * HASH of the product code into 4 token tones — NOT a per-product color
 * map. A new product gets a consistent tone for free; nothing branches
 * on a specific product. The badge text is the product code; the full
 * label (PRODUCT_LABELS) is the accessible title.
 *
 * Pure + presentational. Composes @openrater/design-system <Num> +
 * <IconButton> + lucide.
 */

import type { ReactNode } from "react";
import { IconButton, Num } from "@openrater/design-system";
import { PRODUCT_LABELS, type ProductCode } from "@openrater/contracts";
import { ChevronDown, ChevronRight, ArrowUpRight, X } from "lucide-react";
import "./PolicyLineChip.css";

export interface PolicyLineChipProps {
  readonly product: ProductCode;
  readonly planName: string;
  /** The bound Plan's content_hash (pins the algorithm version). */
  readonly contentHash: string;
  /** The Plan output field this line's premium reads from. */
  readonly premiumOutput: string;
  /** The line premium, or `null` before the insured is scored. */
  readonly premium: number | null;
  /** e.g. "all coverages bound". */
  readonly coverageSummary?: string;
  /** The plan's selectable premium outputs (its chain `output_field`s).
   *  With `onPremiumOutputChange` + >1 option, the output renders as a
   *  picker (Brief 46 D3). */
  readonly availableOutputs?: readonly string[];
  readonly onPremiumOutputChange?: (output: string) => void;
  /** When set, a newer filed version exists → render the rebind hint. */
  readonly newerVersionHash?: string | null;
  readonly expanded?: boolean;
  readonly onToggleExpand?: () => void;
  readonly onRemove?: () => void;
  readonly onRebind?: () => void;
  /** Per-line build-up (J4), rendered when `expanded`. */
  readonly children?: ReactNode;
}

const TONE_COUNT = 4;

/** Stable hash of the product code → a tone index. Generic: no
 *  per-product map; a new product gets a consistent tone for free. */
function toneIndex(product: string): number {
  let h = 0;
  for (let i = 0; i < product.length; i += 1) {
    h = (h * 31 + product.charCodeAt(i)) >>> 0;
  }
  return h % TONE_COUNT;
}

/** "7221abc…c630" → "v7221…c630". */
function shortHash(hash: string): string {
  return hash.length > 8 ? `v${hash.slice(0, 4)}…${hash.slice(-4)}` : `v${hash}`;
}

export function PolicyLineChip({
  product,
  planName,
  contentHash,
  premiumOutput,
  premium,
  coverageSummary,
  availableOutputs,
  onPremiumOutputChange,
  newerVersionHash,
  expanded = false,
  onToggleExpand,
  onRemove,
  onRebind,
  children,
}: PolicyLineChipProps) {
  return (
    <div className="rater-policy-line-chip">
      <div className="rater-policy-line-chip__row">
        <span
          className={`rater-policy-line-chip__badge rater-policy-line-chip__badge--tone-${toneIndex(product)}`}
          title={PRODUCT_LABELS[product]}
        >
          {product.toUpperCase()}
        </span>

        <div className="rater-policy-line-chip__body">
          <div className="rater-policy-line-chip__head">
            <span className="rater-policy-line-chip__name">{planName}</span>
            <span className="rater-policy-line-chip__ver">
              {shortHash(contentHash)}
            </span>
          </div>
          <div className="rater-policy-line-chip__out">
            writes{" "}
            {onPremiumOutputChange && availableOutputs && availableOutputs.length > 1 ? (
              <select
                className="rater-policy-line-chip__out-select"
                value={premiumOutput}
                aria-label="Premium output"
                onChange={(e) => onPremiumOutputChange(e.target.value)}
              >
                {availableOutputs.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <code>{premiumOutput}</code>
            )}
            {coverageSummary ? ` · ${coverageSummary}` : null}
          </div>
        </div>

        <span className="rater-policy-line-chip__spacer" />

        <span className="rater-policy-line-chip__prem">
          {premium === null ? (
            <span
              className="rater-policy-line-chip__prem-none"
              title="Not scored yet"
            >
              —
            </span>
          ) : (
            <Num
              value={premium}
              format="currency"
              maximumFractionDigits={0}
              minimumFractionDigits={0}
            />
          )}
        </span>

        {onToggleExpand ? (
          <IconButton
            aria-label={expanded ? "Collapse line" : "Expand line"}
            variant="ghost"
            size="sm"
            icon={expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            onClick={onToggleExpand}
          />
        ) : null}

        {onRemove ? (
          <IconButton
            aria-label={`Remove ${planName} from policy`}
            variant="ghost"
            size="sm"
            icon={<X size={15} />}
            onClick={onRemove}
          />
        ) : null}
      </div>

      {newerVersionHash ? (
        <button
          type="button"
          className="rater-policy-line-chip__rebind"
          onClick={onRebind}
        >
          <ArrowUpRight size={13} aria-hidden="true" />
          <span>
            A newer filed version ({shortHash(newerVersionHash)}) is available —{" "}
            <span className="rater-policy-line-chip__rebind-cta">
              review &amp; rebind
            </span>
          </span>
        </button>
      ) : null}

      {expanded && children ? (
        <div className="rater-policy-line-chip__expand">{children}</div>
      ) : null}
    </div>
  );
}
