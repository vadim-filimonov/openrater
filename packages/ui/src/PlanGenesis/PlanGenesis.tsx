/**
 * <PlanGenesis> — the two-door first-landing block (Brief 89 §2.1, R2–R4).
 *
 * A fully-empty plan's first 30 seconds: the author arrives holding either
 * DATA (a book export, an API) or AN ALGORITHM (a filing, a rate manual) —
 * rarely both. This block says: both are valid first moves, here is what
 * each needs, here is what each gives you. It replaces the empty-Inputs
 * "stranger stack" (dictionary empty card + score-a-book dropzone).
 *
 * Not a wizard (R1): nothing is stored, there is no mode. The CONSUMER
 * (InputsPanelV2) renders it only while the plan is fully empty and no
 * door has been taken; any authoring act dissolves it into the normal
 * surfaces (R2).
 *
 * R3 — neither door is the azure primary; the whole card is the
 * affordance (the /new template-radio idiom, cf. ModelStudio
 * StartSurface's row selectors). Azure appears only inside the taken
 * door. The duplicate path is a quiet tertiary link, present only when
 * another plan exists to copy (R4) — this is NOT a template gallery.
 */

import { useId, type JSX } from "react";
import { Table2, Upload } from "lucide-react";
import { Button } from "@openrater/design-system";
import "./plan-genesis.css";

export interface PlanGenesisProps {
  /** Take the data door — the consumer reveals the source act in place. */
  readonly onDataDoor: () => void;
  /** Take the algorithm door — the consumer navigates to Rating (R4). */
  readonly onAlgorithmDoor: () => void;
  /** Present only when ≥1 other plan exists (R4). Quiet link, no door. */
  readonly onDuplicate?: (() => void) | undefined;
  /** Draft plans get live doors; read-only plans a disabled block (§7). */
  readonly editable: boolean;
  readonly testId?: string | undefined;
}

export function PlanGenesis({
  onDataDoor,
  onAlgorithmDoor,
  onDuplicate,
  editable,
  testId = "rater-genesis",
}: PlanGenesisProps): JSX.Element {
  const titleId = useId();
  const ledeId = useId();
  const needDataId = useId();
  const needAlgId = useId();
  return (
    <section
      className="rater-genesis"
      role="group"
      aria-labelledby={titleId}
      aria-describedby={ledeId}
      data-testid={testId}
    >
      <h3 className="rater-genesis__title" id={titleId}>
        Start where your material is.
      </h3>
      <p className="rater-genesis__lede" id={ledeId}>
        Both doors end in the same place — a plan whose inputs, data, and
        algorithm agree. Pick the one you have.
      </p>

      <div className="rater-genesis__doors">
        <button
          type="button"
          className="rater-genesis__door"
          onClick={onDataDoor}
          disabled={!editable}
          aria-describedby={needDataId}
          data-testid={`${testId}-door-data`}
        >
          <span className="rater-genesis__glyph" aria-hidden>
            <Upload size={20} />
          </span>
          <span className="rater-genesis__name">Start from your data</span>
          <span className="rater-genesis__body">
            Drop a book of business or pull a sample from an API. Every
            column becomes a typed plan input in one click; real rows
            preview premiums as you build the algorithm against them.
          </span>
          <span className="rater-genesis__need" id={needDataId}>
            <b>You'll need</b> a CSV with a header row, or a JSON endpoint
            URL.
          </span>
        </button>

        <button
          type="button"
          className="rater-genesis__door"
          onClick={onAlgorithmDoor}
          disabled={!editable}
          aria-describedby={needAlgId}
          data-testid={`${testId}-door-algorithm`}
        >
          <span className="rater-genesis__glyph" aria-hidden>
            <Table2 size={20} />
          </span>
          <span className="rater-genesis__name">Start from the algorithm</span>
          <span className="rater-genesis__body">
            Sketch the premium build-up from your rate manual — base rate,
            factors, adjustments. Any variable a step needs surfaces back
            here in Inputs to declare with one click.
          </span>
          <span className="rater-genesis__need" id={needAlgId}>
            <b>You'll need</b> nothing but the manual. Connect data later to
            test.
          </span>
        </button>
      </div>

      {onDuplicate ? (
        <p className="rater-genesis__alt">
          or{" "}
          <Button
            variant="plain"
            size="xs"
            onClick={onDuplicate}
            disabled={!editable}
            data-testid={`${testId}-duplicate`}
          >
            duplicate an existing plan
          </Button>
        </p>
      ) : null}

      {!editable ? (
        <p className="rater-genesis__readonly" role="status">
          This plan is read-only — reopen a draft to start building.
        </p>
      ) : null}
    </section>
  );
}
