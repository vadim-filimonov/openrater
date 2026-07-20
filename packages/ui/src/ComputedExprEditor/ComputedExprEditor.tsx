/**
 * <ComputedExprEditor> — author a derived computed field (E03 / brief D3).
 *
 * The authoring surface for a `derive.computed` field — e.g.
 * `tiv = building_limit + bpp_limit`. Builds a closed arithmetic AST
 * (`ComputedExpr` from @openrater/contracts), NOT a free-text formula: each operand
 * is a declared input OR a constant, joined left-to-right by `+ − × ÷`. That
 * keeps the expression inspectable, portable, and deterministic — and means a
 * typo can't smuggle in a stray identifier.
 *
 * v1 ships a FLAT left-associative sequence (operand op operand op …), which
 * folds to a left-leaning AST and covers the appetite-field shapes that matter
 * (Σ of limits, a ratio). Parenthesized / nested grouping is a documented
 * fast-follow; an externally-authored nested expression renders read-only with
 * a hint rather than silently flattening.
 *
 * Controlled: the parent owns the `ComputedExpr`; `onChange` fires on every
 * edit. A live preview shows the formula and (when `sampleInputs` is supplied)
 * the value against the sample risk. Pure presentation; the math is
 * `@openrater/contracts` `evaluateComputedExpr` (one implementation, no drift).
 */

import { useId, type JSX } from "react";
import { Plus, Trash2, Variable, Hash } from "lucide-react";
import {
  type ComputedExpr,
  evaluateComputedExpr,
  formatComputedExpr,
} from "@openrater/contracts";
import "./ComputedExprEditor.css";

/** The display ⇄ AST operator mapping. */
type ExprOp = "+" | "-" | "*" | "/";
const OP_LABELS: Readonly<Record<ExprOp, string>> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
};
const OPS: readonly ExprOp[] = ["+", "-", "*", "/"];

type Operand =
  | { readonly kind: "input"; readonly name: string }
  | { readonly kind: "const"; readonly value: number };

/** One term in the flat sequence: an operand + (for non-first terms) the
 *  operator that joins it to the running total. */
interface Term {
  readonly op?: ExprOp;
  readonly operand: Operand;
}

export interface ComputedExprEditorProps {
  /** The expression being authored (controlled). */
  readonly value: ComputedExpr;
  /** Declared input names an operand can reference. */
  readonly availableFields: readonly string[];
  readonly onChange: (next: ComputedExpr) => void;
  /** Optional sample risk → drives the live numeric preview. */
  readonly sampleInputs?: Readonly<Record<string, unknown>>;
  readonly testId?: string;
}

/** Flatten a left-associative AST into terms. Returns `null` when the
 *  expression is nested (a non-leaf right operand) — the editor then renders
 *  it read-only rather than misrepresenting it. */
export function flattenComputedExpr(expr: ComputedExpr): Term[] | null {
  if (expr.kind !== "op") return [{ operand: expr }];
  if (expr.right.kind === "op") return null; // nested right operand — not flat
  const left = flattenComputedExpr(expr.left);
  if (left === null) return null;
  return [...left, { op: expr.op, operand: expr.right }];
}

/** Fold a flat term list back into a left-associative AST. */
export function buildComputedExpr(terms: readonly Term[]): ComputedExpr {
  if (terms.length === 0) return { kind: "const", value: 0 };
  let expr: ComputedExpr = terms[0]!.operand;
  for (let i = 1; i < terms.length; i++) {
    const t = terms[i]!;
    expr = { kind: "op", op: t.op ?? "+", left: expr, right: t.operand };
  }
  return expr;
}

export function ComputedExprEditor(
  props: ComputedExprEditorProps,
): JSX.Element {
  const {
    value,
    availableFields,
    onChange,
    sampleInputs,
    testId = "rater-computed-expr-editor",
  } = props;
  const uid = useId();
  const terms = flattenComputedExpr(value);

  // A nested (non-flat) expression authored elsewhere — show it, don't mangle.
  if (terms === null) {
    return (
      <div className="rater-cee" data-testid={testId}>
        <p className="rater-cee__readonly" role="note">
          This expression is nested; edit it as text for now.
        </p>
        <code className="rater-cee__formula">{formatComputedExpr(value)}</code>
      </div>
    );
  }

  const commit = (next: Term[]): void => {
    onChange(buildComputedExpr(next.length === 0 ? [{ operand: { kind: "const", value: 0 } }] : next));
  };

  const setOperand = (i: number, operand: Operand): void => {
    commit(terms.map((t, j) => (j === i ? { ...t, operand } : t)));
  };
  const setOp = (i: number, op: ExprOp): void => {
    commit(terms.map((t, j) => (j === i ? { ...t, op } : t)));
  };
  const addTerm = (): void => {
    commit([
      ...terms,
      { op: "+", operand: { kind: "input", name: availableFields[0] ?? "" } },
    ]);
  };
  const removeTerm = (i: number): void => {
    if (terms.length === 1) return;
    // Dropping the first term: the new first term loses its leading operator.
    const next = terms
      .filter((_, j) => j !== i)
      .map((t, j) => (j === 0 ? { operand: t.operand } : t));
    commit(next);
  };

  const numeric = sampleInputs
    ? evaluateComputedExpr(value, sampleInputs)
    : null;

  return (
    <div className="rater-cee" data-testid={testId}>
      <div className="rater-cee__rows">
        {terms.map((term, i) => (
          <div className="rater-cee__row" key={i} data-testid={`${testId}-term-${i}`}>
            {i > 0 ? (
              <select
                className="rater-cee__op"
                aria-label={`Operator ${i}`}
                value={term.op ?? "+"}
                onChange={(e) => setOp(i, e.target.value as ExprOp)}
                data-testid={`${testId}-op-${i}`}
              >
                {OPS.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABELS[op]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rater-cee__op rater-cee__op--lead" aria-hidden>
                =
              </span>
            )}

            <select
              className="rater-cee__kind"
              aria-label={`Operand ${i + 1} type`}
              value={term.operand.kind}
              onChange={(e) =>
                setOperand(
                  i,
                  e.target.value === "input"
                    ? { kind: "input", name: availableFields[0] ?? "" }
                    : { kind: "const", value: 0 },
                )
              }
              data-testid={`${testId}-kind-${i}`}
            >
              <option value="input">Field</option>
              <option value="const">Number</option>
            </select>

            {term.operand.kind === "input" ? (
              <span className="rater-cee__operand">
                <Variable size={13} strokeWidth={2} aria-hidden />
                <select
                  className="rater-cee__field"
                  aria-label={`Field ${i + 1}`}
                  value={term.operand.name}
                  onChange={(e) => setOperand(i, { kind: "input", name: e.target.value })}
                  data-testid={`${testId}-field-${i}`}
                >
                  <option value="">— field —</option>
                  {availableFields.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                  {term.operand.name && !availableFields.includes(term.operand.name) ? (
                    <option value={term.operand.name}>{term.operand.name} (unknown)</option>
                  ) : null}
                </select>
              </span>
            ) : (
              <span className="rater-cee__operand">
                <Hash size={13} strokeWidth={2} aria-hidden />
                <input
                  className="rater-cee__num"
                  type="number"
                  aria-label={`Number ${i + 1}`}
                  value={String(term.operand.value)}
                  onChange={(e) =>
                    setOperand(i, { kind: "const", value: Number(e.target.value) || 0 })
                  }
                  data-testid={`${testId}-num-${i}`}
                />
              </span>
            )}

            {terms.length > 1 ? (
              <button
                type="button"
                className="rater-cee__remove"
                aria-label={`Remove term ${i + 1}`}
                onClick={() => removeTerm(i)}
                data-testid={`${testId}-remove-${i}`}
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            ) : (
              <span className="rater-cee__remove-spacer" aria-hidden />
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="rater-cee__add"
        onClick={addTerm}
        data-testid={`${testId}-add`}
      >
        <Plus size={13} strokeWidth={2} /> Add term
      </button>

      <p className="rater-cee__preview" id={`${uid}-preview`} role="note">
        <code className="rater-cee__formula" data-testid={`${testId}-formula`}>
          {formatComputedExpr(value)}
        </code>
        {numeric !== null ? (
          <span className="rater-cee__value" data-testid={`${testId}-value`}>
            {" = "}
            {numeric.toLocaleString()}
          </span>
        ) : null}
      </p>
    </div>
  );
}
