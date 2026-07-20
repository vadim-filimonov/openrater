/**
 * <ImpactDeletePrompt> — Brief 70 Phase 1 (the one armed delete).
 *
 * The platform grew three sibling prompts with the same soul
 * (DimensionDeletePrompt / NodeDeletePrompt / FactorTableDeletePrompt):
 * name the artifact, state the loss concretely, list what depends on
 * it, and make the load-bearing case say "Delete anyway". This is the
 * merged primitive; the siblings re-skin onto it as their sections
 * rebuild (FactorTableDeletePrompt delegates today — its tests pin
 * parity).
 *
 * Outcome language belongs to the CONSUMER: `lossStatement` should say
 * what stops being true ("Risks matching TIV ≥ $1,000,000 will no
 * longer be declined"), not just what gets removed.
 */

import type { JSX, ReactNode } from "react";
import { GitBranch, TriangleAlert } from "lucide-react";
import { Button, Modal } from "@openrater/design-system";
import "./ImpactDeletePrompt.css";

export interface ImpactReference {
  /** "Construction factor · Building chain" — where it's read. */
  readonly label: string;
  readonly context?: string | undefined;
  /** Optional icon override (default: GitBranch). */
  readonly icon?: ReactNode;
}

export interface ImpactDeletePromptProps {
  readonly open: boolean;
  /** The artifact's display name (drives the title). */
  readonly artifactName: string;
  /** What the artifact is, for the title ("table", "rule", "step"). */
  readonly artifactKind?: string;
  /**
   * The concrete loss, in outcome language. Rendered before
   * "There is no undo."
   */
  readonly lossStatement: ReactNode;
  /** What reads this artifact. Non-empty = load-bearing. */
  readonly references?: readonly ImpactReference[];
  /** The sentence above the reference list. */
  readonly referencesIntro?: ReactNode;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly testId?: string;
}

export function ImpactDeletePrompt({
  open,
  artifactName,
  artifactKind = "item",
  lossStatement,
  references = [],
  referencesIntro,
  onConfirm,
  onCancel,
  testId = "rater-impact-delete",
}: ImpactDeletePromptProps): JSX.Element | null {
  if (!open) return null;
  const loadBearing = references.length > 0;
  return (
    <Modal open={open} onClose={onCancel} title={`Delete “${artifactName}”?`}>
      <Modal.Body>
        <div className="rater-impactdel" data-testid={testId}>
          <p className="rater-impactdel__intro">
            {lossStatement} There is no undo.
          </p>
          {loadBearing ? (
            <>
              <p className="rater-impactdel__warning" role="alert">
                <TriangleAlert size={14} aria-hidden />{" "}
                {referencesIntro ??
                  `${references.length === 1 ? "Something reads" : `${references.length} things read`} this ${artifactKind} — deleting it leaves them with nothing to resolve:`}
              </p>
              <ul className="rater-impactdel__refs">
                {references.map((ref, i) => (
                  <li key={i} className="rater-impactdel__ref">
                    {ref.icon ?? <GitBranch size={12} aria-hidden />}
                    <span className="rater-impactdel__ref-label">
                      {ref.label}
                    </span>
                    {ref.context ? (
                      <span className="rater-impactdel__ref-context">
                        {ref.context}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={onConfirm}
          data-testid={`${testId}-confirm`}
        >
          {loadBearing ? "Delete anyway" : `Delete ${artifactKind}`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
