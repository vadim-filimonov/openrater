/**
 * <PolicyGroupingCard> — Brief 80 D-A (platform-test finding E7).
 *
 * The ONE authoring home for the policy-composition contract inside
 * the Inputs mapping act: which book columns key the grouping
 * (`grouping_config`) and which scored fields roll up to the policy
 * (`rollup_fields`). Sentence-shaped, not form-shaped — the card
 * reads as the fact it states ("Rows group into policies by X ·
 * rolling up Y"), the same statement grammar as the appetite
 * composer (Brief 70).
 *
 * Two states:
 *   · collapsed (grouping off) — the P2.2 offer, no longer gated on
 *     a completed sample score: detection hit → the full offer
 *     sentence; no detection → the manual-pick invitation. One click
 *     enables with the D-C defaults.
 *   · enabled — the sentence with live column pickers, the roll-up
 *     list (the plan total is ALWAYS rolled and non-removable, D-C),
 *     extra rolled fields add/remove, and the missing-policy-id
 *     honesty line. [Stop grouping] is the one exit.
 *
 * Pure presentation: props in, callbacks out. The panel owns the
 *  mapping state (and persists via onMappingChange).
 */

import { useState } from "react";
import { Layers, Plus, X } from "lucide-react";
import { Button } from "@openrater/design-system";
import { ROLLUP_REDUCERS, type RollupReducer } from "@openrater/contracts";
import type {
  PolicyGroupingConfig,
  RollupFieldSpec,
} from "../InputsWorkspace/InputsWorkspace";
import "./PolicyGroupingCard.css";

export interface PolicyGroupingCardProps {
  readonly editable: boolean;
  /** The loaded book's columns — pickers + detection operate on these. */
  readonly bookColumns: readonly string[];
  /** The active grouping (an empty/absent policy column = grouping off). */
  readonly grouping: PolicyGroupingConfig | undefined;
  readonly rollupFields: readonly RollupFieldSpec[];
  /**
   * The plan's total field (Brief 80 D-C) — always rolled while
   * grouping is on; rendered as the non-removable first row.
   *
   * `null` for the legal total-less multi-coverage transcription: the
   * plan declares NO total, so there is no field to roll and nothing
   * premium-named may be declared (any premium-named roll-up reads to
   * the composers as an explicit basis and suppresses the dec-page
   * sum). The row then states the sum over `coverageFields` instead.
   */
  readonly totalField: string | null;
  /**
   * The coverage money outputs the policy premium sums when
   * `totalField` is null — stated, not rolled.
   */
  readonly coverageFields?: readonly string[];
  /** Auto-detected key columns (drives the collapsed offer's copy). */
  readonly detected: PolicyGroupingConfig;
  /** Sample rows with a BLANK policy id (the honesty line); null = unknown. */
  readonly rowsMissingPolicyId?: number | null;
  readonly onEnable: () => void;
  readonly onDisable: () => void;
  readonly onGroupingChange: (next: PolicyGroupingConfig) => void;
  readonly onRollupsChange: (next: readonly RollupFieldSpec[]) => void;
  readonly testId?: string;
}

const NONE = "__none__";

export function PolicyGroupingCard(props: PolicyGroupingCardProps): JSX.Element | null {
  const {
    editable,
    bookColumns,
    grouping,
    rollupFields,
    totalField,
    coverageFields = [],
    detected,
    rowsMissingPolicyId = null,
    onEnable,
    onDisable,
    onGroupingChange,
    onRollupsChange,
    testId = "rater-polgroup",
  } = props;

  const [addOpen, setAddOpen] = useState(false);

  const active =
    typeof grouping?.policy_id_column === "string" &&
    grouping.policy_id_column !== "";

  // Nothing to say without a book, and a read-only surface has no
  // business advertising an authoring affordance it can't honor.
  if (bookColumns.length === 0) return null;
  if (!active && !editable) return null;

  // ── Collapsed — the offer (Brief 80: visible whenever a book is
  //    loaded; detection only changes the copy, never gates). ──────
  if (!active) {
    return (
      <section
        className="rater-polgroup rater-polgroup--offer"
        aria-label="Policy grouping"
        data-testid={testId}
      >
        <Layers size={15} strokeWidth={1.8} aria-hidden />
        <p className="rater-polgroup__offer-copy">
          {detected.policy_id_column ? (
            <>
              This book looks multi-location. Group rows into policies by{" "}
              <code>{detected.policy_id_column}</code> — composed premiums,
              policy gates, and the per-policy minimum apply then.
            </>
          ) : (
            <>
              Multi-location book? Group rows into policies by a key column —
              composed premiums, policy gates, and the per-policy minimum
              apply then.
            </>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEnable}
          data-testid={`${testId}-enable`}
        >
          Group by policy
        </Button>
      </section>
    );
  }

  // ── Enabled — the sentence + the roll-up list. ───────────────────
  const extraRollups = rollupFields.filter((f) => f.fieldName !== totalField);
  const addCandidates = bookColumns.filter(
    (c) => c !== totalField && !rollupFields.some((f) => f.fieldName === c),
  );

  return (
    <section
      className="rater-polgroup"
      aria-label="Policy grouping"
      data-testid={testId}
    >
      <div className="rater-polgroup__head">
        <span className="rater-polgroup__eyebrow">Policies</span>
        {editable ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={onDisable}
            data-testid={`${testId}-disable`}
          >
            Stop grouping
          </Button>
        ) : null}
      </div>

      <p className="rater-polgroup__sentence">
        Rows group into policies by{" "}
        <select
          className="rater-polgroup__select"
          value={grouping?.policy_id_column ?? ""}
          disabled={!editable}
          aria-label="Policy key column"
          data-testid={`${testId}-policy-col`}
          onChange={(e) =>
            onGroupingChange({
              ...grouping,
              policy_id_column: e.target.value,
            })
          }
        >
          {bookColumns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>{" "}
        · locations keyed by{" "}
        <select
          className="rater-polgroup__select"
          value={grouping?.location_id_column ?? NONE}
          disabled={!editable}
          aria-label="Location key column"
          data-testid={`${testId}-location-col`}
          onChange={(e) => {
            const v = e.target.value;
            const next: PolicyGroupingConfig = {
              ...(grouping?.policy_id_column
                ? { policy_id_column: grouping.policy_id_column }
                : {}),
              ...(v !== NONE ? { location_id_column: v } : {}),
            };
            onGroupingChange(next);
          }}
        >
          <option value={NONE}>row order</option>
          {bookColumns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </p>

      <div className="rater-polgroup__rollups">
        <span className="rater-polgroup__rollups-label">
          Each policy rolls up
        </span>
        <ul className="rater-polgroup__rollup-list">
          {totalField !== null ? (
            <li
              className="rater-polgroup__rollup rater-polgroup__rollup--total"
              data-testid={`${testId}-rollup-total`}
            >
              <code>{totalField}</code>
              <span className="rater-polgroup__reducer">Σ sum</span>
              <span className="rater-polgroup__rollup-note">
                the plan&apos;s total — always rolled
              </span>
            </li>
          ) : (
            // Total-less: state the fact instead of naming a field that
            // does not exist. Nothing is DECLARED here — the sum is what
            // the composers do precisely because no basis is declared.
            <li
              className="rater-polgroup__rollup rater-polgroup__rollup--total"
              data-testid={`${testId}-rollup-coverage-sum`}
            >
              <code>{coverageFields.join(" + ")}</code>
              <span className="rater-polgroup__reducer">Σ sum</span>
              <span className="rater-polgroup__rollup-note">
                this plan declares no total — each policy&apos;s premium is
                the sum of its {coverageFields.length} coverages
              </span>
            </li>
          )}
          {extraRollups.map((f) => (
            <li className="rater-polgroup__rollup" key={f.fieldName}>
              <code>{f.fieldName}</code>
              {editable ? (
                <select
                  className="rater-polgroup__select"
                  value={f.reducer}
                  aria-label={`Reducer for ${f.fieldName}`}
                  onChange={(e) =>
                    onRollupsChange(
                      rollupFields.map((r) =>
                        r.fieldName === f.fieldName
                          ? { ...r, reducer: e.target.value as RollupReducer }
                          : r,
                      ),
                    )
                  }
                >
                  {ROLLUP_REDUCERS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="rater-polgroup__reducer">Σ {f.reducer}</span>
              )}
              {editable ? (
                <button
                  type="button"
                  className="rater-polgroup__remove"
                  aria-label={`Stop rolling up ${f.fieldName}`}
                  onClick={() =>
                    onRollupsChange(
                      rollupFields.filter(
                        (r) => r.fieldName !== f.fieldName,
                      ),
                    )
                  }
                >
                  <X size={12} strokeWidth={2} aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
          {editable && addCandidates.length > 0 ? (
            <li className="rater-polgroup__rollup rater-polgroup__rollup--add">
              {addOpen ? (
                <select
                  className="rater-polgroup__select"
                  aria-label="Add a rolled field"
                  data-testid={`${testId}-add-rollup`}
                  autoFocus
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v !== "") {
                      onRollupsChange([
                        ...rollupFields,
                        { fieldName: v, reducer: "sum" },
                      ]);
                    }
                    setAddOpen(false);
                  }}
                  onBlur={() => setAddOpen(false)}
                >
                  <option value="">pick a field…</option>
                  {addCandidates.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <button
                  type="button"
                  className="rater-polgroup__add"
                  onClick={() => setAddOpen(true)}
                  data-testid={`${testId}-add-rollup-open`}
                >
                  <Plus size={12} strokeWidth={2} aria-hidden /> add a rolled
                  field
                </button>
              )}
            </li>
          ) : null}
        </ul>
      </div>

      {rowsMissingPolicyId !== null && rowsMissingPolicyId > 0 ? (
        <p
          className="rater-polgroup__honesty"
          data-testid={`${testId}-missing-ids`}
        >
          {rowsMissingPolicyId} book row
          {rowsMissingPolicyId === 1 ? " has" : "s have"} no{" "}
          <code>{grouping?.policy_id_column}</code> — each rates as its own
          single-location policy.
        </p>
      ) : null}
    </section>
  );
}
