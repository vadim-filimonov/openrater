/**
 * <UsedInPanel> — the dim editor's navigational hub (Brief 30 §6).
 *
 * Renders the downstream references to a dimension — chains,
 * factor tables, modifiers, curves — each as a click-to-jump row.
 * When there are zero references, the panel becomes a CTA pair
 * pointing the user at how to use the dim (Brief 30 §−1 Q5).
 *
 * PR 30.1 surface: scaffold + empty-state CTAs. The reference
 * resolver (walks plan.stages + plan.factor_tables to compute the
 * row list) lives in PR 30.4 — until then the route passes
 * `references = []` and the empty state always renders.
 *
 * Pure presentation. Parent owns the references array + the jump /
 * CTA handlers.
 */

import { ArrowUpRight, GitBranch, Sparkles, Table2, TriangleAlert } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Button } from "@openrater/design-system";
import "./UsedInPanel.css";

/**
 * One downstream reference to the dim. The `id` is route-stable so
 * the consumer can wire `onJumpToReference` to the right destination.
 *
 * `kind` controls the icon + the meta-row's accent. Match the
 * categories on the rate-lab spine:
 *   - "chain"        — a coverage chain that references the dim as
 *                      a chain factor's `form_input`
 *   - "factor-table" — a factor table keyed on this dim
 *   - "modifier"     — a modifier schedule keyed on this dim
 *   - "curve"        — a curve whose x-axis is this dim
 */
export interface DimensionReference {
  readonly kind: "chain" | "factor-table" | "modifier" | "curve";
  readonly id: string;
  readonly label: string;
  /** One-line context: "stage 3 · 'Age factor'" / "key column · 5 rows" */
  readonly context: string;
  /**
   * When set, this reference is broken (e.g., a banded gap means
   * inputs in [15, 30) can't resolve). The reason renders as a
   * red warning chip on the row.
   */
  readonly broken?: { readonly reason: string };
}

export interface UsedInPanelProps {
  readonly references: readonly DimensionReference[];
  /** Fires when the user clicks a reference row. */
  readonly onJumpToReference?: (ref: DimensionReference) => void;
  /** Empty-state CTA — opens a chain factor picker pre-keyed on this dim. */
  readonly onReferenceInChain?: () => void;
  /** Empty-state CTA — opens a new factor table with this dim as a key. */
  readonly onUseAsFactorTableKey?: () => void;
  readonly testId?: string;
}

export function UsedInPanel(props: UsedInPanelProps): JSX.Element {
  const {
    references,
    onJumpToReference,
    onReferenceInChain,
    onUseAsFactorTableKey,
    testId = "rater-dim-used-in",
  } = props;

  const isEmpty = references.length === 0;

  return (
    <div className="rater-dim-used-in" data-testid={testId}>
      <div className="rater-dim-used-in__head">
        <span className="rater-dim-used-in__label">Used in</span>
        <span className="rater-dim-used-in__count">
          {isEmpty ? "· 0 references" : `· ${references.length} reference${references.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {isEmpty ? (
        <EmptyCta
          {...(onReferenceInChain !== undefined ? { onReferenceInChain } : {})}
          {...(onUseAsFactorTableKey !== undefined
            ? { onUseAsFactorTableKey }
            : {})}
          testId={`${testId}-empty`}
        />
      ) : (
        <div className="rater-dim-used-in__rows">
          {references.map((ref) => (
            <ReferenceRow
              key={`${ref.kind}-${ref.id}`}
              reference={ref}
              {...(onJumpToReference !== undefined
                ? { onJumpToReference }
                : {})}
              testId={`${testId}-row-${ref.kind}-${ref.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Reference row
// ──────────────────────────────────────────────────────────────────

function ReferenceRow(props: {
  readonly reference: DimensionReference;
  readonly onJumpToReference?: (ref: DimensionReference) => void;
  readonly testId: string;
}): JSX.Element {
  const { reference, onJumpToReference, testId } = props;
  const isBroken = reference.broken !== undefined;
  return (
    <button
      type="button"
      className={`rater-dim-used-in__row rater-dim-used-in__row--${reference.kind}${
        isBroken ? " is-broken" : ""
      }`}
      onClick={() => onJumpToReference?.(reference)}
      disabled={onJumpToReference === undefined}
      data-testid={testId}
      aria-label={`Jump to ${reference.label}${
        isBroken ? ` (broken: ${reference.broken!.reason})` : ""
      }`}
    >
      <span
        className={`rater-dim-used-in__icon rater-dim-used-in__icon--${reference.kind}`}
        aria-hidden
      >
        {iconFor(reference.kind)}
      </span>
      <span className="rater-dim-used-in__row-label">
        {/* B6 — labels are human names (factor-table display name, chain name),
            so render them in the body font, not mono; the internal id stays on
            hover via `title`. */}
        <span className="rater-dim-used-in__row-label-text" title={reference.id}>
          {reference.label}
        </span>
      </span>
      <span className="rater-dim-used-in__row-context">
        {isBroken ? (
          <span className="rater-dim-used-in__broken">
            <TriangleAlert size={11} aria-hidden /> {reference.broken!.reason}
          </span>
        ) : (
          reference.context
        )}
      </span>
      <span className="rater-dim-used-in__row-jump" aria-hidden>
        <ArrowUpRight size={12} />
      </span>
    </button>
  );
}

function iconFor(kind: DimensionReference["kind"]): ReactNode {
  switch (kind) {
    case "chain":
      return <GitBranch size={12} />;
    case "factor-table":
      return <Table2 size={12} />;
    case "modifier":
      return <Sparkles size={12} />;
    case "curve":
      // No bespoke icon; reuse Sparkles for now. The PR 30.4 resolver
      // would also need to surface curves, which the existing
      // editedDimensions wiring doesn't reach yet.
      return <Sparkles size={12} />;
  }
}

// ──────────────────────────────────────────────────────────────────
// Empty CTA — "Not used yet" + two next-step buttons
// ──────────────────────────────────────────────────────────────────

function EmptyCta(props: {
  readonly onReferenceInChain?: () => void;
  readonly onUseAsFactorTableKey?: () => void;
  readonly testId: string;
}): JSX.Element {
  const { onReferenceInChain, onUseAsFactorTableKey, testId } = props;
  const hasChainCta = onReferenceInChain !== undefined;
  const hasTableCta = onUseAsFactorTableKey !== undefined;
  return (
    <div className="rater-dim-used-in__empty" data-testid={testId}>
      <p className="rater-dim-used-in__empty-msg">
        This dimension isn't referenced yet. Once you save, you can
        use it in a chain factor or as a factor table key.
      </p>
      {(hasChainCta || hasTableCta) && (
        <div className="rater-dim-used-in__empty-ctas">
          {hasChainCta && (
            <Button
              variant="ghost"
              size="xs"
              icon={<GitBranch size={12} />}
              iconAfter={<ArrowUpRight size={11} />}
              onClick={onReferenceInChain}
              data-testid={`${testId}-chain-cta`}
            >
              Reference in a chain factor
            </Button>
          )}
          {hasTableCta && (
            <Button
              variant="ghost"
              size="xs"
              icon={<Table2 size={12} />}
              iconAfter={<ArrowUpRight size={11} />}
              onClick={onUseAsFactorTableKey}
              data-testid={`${testId}-table-cta`}
            >
              Use as factor table key
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
