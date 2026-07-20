/**
 * <RatingChainCard> — visualizes one rating chain.
 *
 * The Rating Chains section (#6 in the 14-section spine) holds the
 * multiplicative + additive chains that produce coverage premium.
 * Each chain is a stage of kind `multiplicative_chain` or `additive`
 * (eventually `flat_factor` for IRPM-style single-factor stages).
 *
 * This primitive shows ONE chain:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ class_factor_chain         CHAIN.MULT  ×     │
 *   │ ────────────────────────────────────────────  │
 *   │ Base rate            500.00                  │
 *   │ × class factor       lookup.direct → ...     │
 *   │ × construction       lookup.direct → ...     │
 *   │ × sprinkler          constant → 0.95         │
 *   │ × territory          lookup.territory → ...  │
 *   │ ────────────────────────────────────────────  │
 *   │ Indicated premium    →                       │
 *   └──────────────────────────────────────────────┘
 *
 * Pure presentation. Parent owns:
 *   · data — pass `chain` from the parent's state
 *   · mutations — wire `onEditFactor` / `onAddFactor` / `onRemoveFactor`
 *     callbacks to the parent's drawer state
 *
 * Operator and base value are documented inline; the factor list is
 * scrollable when there are >10 factors. No new design tokens.
 */

import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@openrater/design-system";
import "./RatingChainCard.css";

/**
 * Chain operator. Determines which separator the card renders between
 * factors + the prefix on each factor row.
 */
export type ChainOperator = "multiply" | "add";

/**
 * One factor row in the chain — the actuary's authoring unit.
 */
export interface ChainFactor {
  /** Stable identifier (the chain stage's index, or the factor's
   *  own stage_id if factors are stored as separate stages). */
  readonly id: string;
  /** Display label (e.g., "class factor", "sprinkler credit"). */
  readonly label: string;
  /** What kind of factor — surfaces as a chip badge.
   *  Common values: "constant", "lookup.direct", "lookup.classification",
   *  "lookup.range", "curve.evaluate", etc. */
  readonly kind: string;
  /** Hint about what the factor resolves to. For a constant, the
   *  literal value. For a lookup, the key being looked up or the
   *  target table name. Free-form display text. */
  readonly resolves_to?: string | undefined;
}

export interface RatingChainCardProps {
  /** Display name of the chain (e.g., "BOP class factor chain"). */
  readonly title: string;
  /** Multiplicative or additive. Drives the visual operator. */
  readonly operator: ChainOperator;
  /** Base value the chain operates on (e.g., a base rate). When
   *  omitted, the chain is rendered as starting from the first
   *  factor. Free-form display string so the parent can render
   *  numbers + units however they want ("$500.00", "1.000", etc.). */
  readonly base?: string | undefined;
  /** Ordered list of factors. Empty list renders the empty-state hint. */
  readonly factors: readonly ChainFactor[];
  /** Optional output label shown at the bottom (e.g., "Indicated premium"). */
  readonly output_label?: string | undefined;
  /** Called when the actuary clicks a factor row. */
  readonly onEditFactor?: (factorId: string) => void;
  /** Called when the actuary clicks the "+ Add factor" affordance. */
  readonly onAddFactor?: () => void;
  /** Called when the actuary removes a factor (× button per row). */
  readonly onRemoveFactor?: (factorId: string) => void;
  /** Optional test ID. */
  readonly testId?: string;
}

export function RatingChainCard(props: RatingChainCardProps): JSX.Element {
  const {
    title,
    operator,
    base,
    factors,
    output_label,
    onEditFactor,
    onAddFactor,
    onRemoveFactor,
    testId = "rater-rating-chain-card",
  } = props;

  const operatorLabel = operator === "multiply" ? "chain.mult" : "chain.add";
  const operatorSymbol = operator === "multiply" ? "×" : "+";

  return (
    <article
      className="rater-rating-chain-card"
      data-testid={testId}
      aria-label={`Chain: ${title}`}
    >
      <header className="rater-rating-chain-card__header">
        <h3 className="rater-rating-chain-card__title">{title}</h3>
        <span
          className="rater-rating-chain-card__kind"
          aria-label={`Operator: ${operatorLabel}`}
        >
          {operatorLabel}
          <span aria-hidden> · </span>
          <span
            className="rater-rating-chain-card__symbol"
            aria-hidden
          >
            {operatorSymbol}
          </span>
        </span>
      </header>

      <div className="rater-rating-chain-card__body">
        {base !== undefined && (
          <div className="rater-rating-chain-card__row rater-rating-chain-card__row--base">
            <span className="rater-rating-chain-card__op" aria-hidden>
              =
            </span>
            <span className="rater-rating-chain-card__label">Base</span>
            <span className="rater-rating-chain-card__value">{base}</span>
            <span className="rater-rating-chain-card__action-placeholder" />
          </div>
        )}

        {factors.length === 0 ? (
          <div className="rater-rating-chain-card__empty" role="status">
            No factors yet. Add a {operator === "multiply" ? "multiplier" : "addend"}{" "}
            to start the chain.
          </div>
        ) : (
          <ul className="rater-rating-chain-card__factors" role="list">
            {factors.map((factor) => (
              <li
                key={factor.id}
                className="rater-rating-chain-card__row rater-rating-chain-card__row--factor"
              >
                <span className="rater-rating-chain-card__op" aria-hidden>
                  {operatorSymbol}
                </span>
                <button
                  type="button"
                  className="rater-rating-chain-card__factor-button"
                  onClick={() => onEditFactor?.(factor.id)}
                  disabled={!onEditFactor}
                  aria-label={`Edit ${factor.label}`}
                >
                  <span className="rater-rating-chain-card__label">
                    {factor.label}
                  </span>
                  <span className="rater-rating-chain-card__kind-chip">
                    {factor.kind}
                  </span>
                  {factor.resolves_to !== undefined && (
                    <span className="rater-rating-chain-card__resolves">
                      → {factor.resolves_to}
                    </span>
                  )}
                </button>
                {onRemoveFactor && (
                  <IconButton
                    size="xs"
                    variant="danger-text"
                    aria-label={`Remove ${factor.label}`}
                    icon={<Trash2 aria-hidden size={12} />}
                    onClick={() => onRemoveFactor(factor.id)}
                    className="rater-rating-chain-card__remove"
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {onAddFactor && (
          <div className="rater-rating-chain-card__add-row">
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus aria-hidden size={14} />}
              onClick={onAddFactor}
            >
              Add factor
            </Button>
          </div>
        )}
      </div>

      {output_label !== undefined && (
        <footer className="rater-rating-chain-card__footer">
          <span className="rater-rating-chain-card__output-arrow" aria-hidden>
            →
          </span>
          <span className="rater-rating-chain-card__output-label">
            {output_label}
          </span>
        </footer>
      )}
    </article>
  );
}
