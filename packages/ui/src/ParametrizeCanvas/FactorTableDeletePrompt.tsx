/**
 * <FactorTableDeletePrompt> — armed delete for a saved factor table
 * (Brief 67 §3.4). Since Brief 70.1 this is a thin delegation onto the
 * merged <ImpactDeletePrompt> (the one armed-delete primitive); the
 * props contract and testids are unchanged, so existing consumers and
 * tests pin the parity.
 */

import type { JSX } from "react";
import { ImpactDeletePrompt } from "../ImpactDeletePrompt";

export interface FactorTableDeleteConsumer {
  /** "Building chain · Construction factor" — where the table is read. */
  readonly label: string;
  readonly context?: string | undefined;
}

export interface FactorTableDeletePromptProps {
  readonly open: boolean;
  /** The table's display name (drives the title). */
  readonly tableName: string;
  /** Authored cell count — states the loss plainly. */
  readonly cellCount: number;
  /** Algorithm chains that read this table. Non-empty = load-bearing. */
  readonly consumers: readonly FactorTableDeleteConsumer[];
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly testId?: string;
}

export function FactorTableDeletePrompt({
  open,
  tableName,
  cellCount,
  consumers,
  onConfirm,
  onCancel,
  testId = "rater-ft-delete-prompt",
}: FactorTableDeletePromptProps): JSX.Element | null {
  return (
    <ImpactDeletePrompt
      open={open}
      artifactName={tableName}
      artifactKind="table"
      lossStatement={
        cellCount > 0
          ? `This removes the table and its ${cellCount.toLocaleString()} authored factor${cellCount === 1 ? "" : "s"}.`
          : "This removes the table from the catalog."
      }
      references={consumers}
      referencesIntro={
        <>
          The algorithm reads this table — deleting it leaves{" "}
          {consumers.length === 1
            ? "this lookup"
            : `${consumers.length} lookups`}{" "}
          with nothing to resolve:
        </>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId={testId}
    />
  );
}
