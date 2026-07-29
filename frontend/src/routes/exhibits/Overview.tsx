/**
 * <Overview> — the comparison's opening exhibit (P7).
 *
 * When a second plan arms, the stage opens on the WHOLE diff before
 * any one variable: a ledger of every variable across both plans,
 * grouped the way the rail groups them, one row each —
 *
 *   status · name · how much moved (n/m) · the biggest single move
 *   (level or cell, ×a → ×b, %) · the span pair when the envelope
 *   itself moved
 *
 * — followed by the QUESTIONS block: inputs one side asks that the
 * other doesn't, and levels that join or leave shared inputs (a
 * class code retiring is a plan change even when no factor moves).
 * Every row is a door: click it and that variable takes the stage.
 *
 * Counts, never enumerations — a 400-class table is one row here.
 * Templates over counted facts, like every sentence on this page.
 */

import type { JSX } from "react";
import type { CompareFacts } from "./compare";
import type { UnderwritingRow } from "./underwriting";

export type LedgerStatus = "same" | "changed" | "new" | "retired";

export interface LedgerRow {
  /** Rail entry id — the click target for onSelect. */
  readonly id: string;
  readonly name: string;
  readonly status: LedgerStatus;
  /** Cells (or levels) moved / total, for changed rows. */
  readonly moved: { readonly changed: number; readonly total: number } | null;
  /** FCA #24 — members reassigned between this row's territories
   *  (aliases collapsed). A membership move is a change even when
   *  every factor cell is identical. */
  readonly reassigned: number | null;
  /** The row's largest single move, labeled in plan language. */
  readonly biggest: {
    readonly label: string;
    readonly from: number;
    readonly to: number;
  } | null;
  /** "×0.89–1.12 → ×0.84–1.22" when the envelope itself moved. */
  readonly spanPair: string | null;
}

export interface LedgerGroup {
  readonly name: string;
  readonly rows: readonly LedgerRow[];
}

function pct(from: number, to: number): string {
  if (from === 0) return "";
  const p = (to / from - 1) * 100;
  return ` (${p >= 0 ? "+" : ""}${p.toFixed(1)}%)`;
}

const STATUS_MARK: Record<LedgerStatus, JSX.Element | null> = {
  same: null,
  changed: <span className="rater-exh__rail-dot" aria-hidden="true" />,
  new: <span className="rater-exh__ledger-add">＋</span>,
  retired: <span className="rater-exh__ledger-rm">−</span>,
};

export function Overview({
  aLabel,
  bLabel,
  aMeta,
  bMeta,
  facts,
  groups,
  underwriting = [],
  onSelect,
}: {
  readonly aLabel: string;
  readonly bLabel: string;
  readonly aMeta: { readonly inputs: number; readonly tables: number };
  readonly bMeta: { readonly inputs: number; readonly tables: number };
  readonly facts: CompareFacts;
  readonly groups: readonly LedgerGroup[];
  /** MVP-009 — the UNDERWRITING group (rules · modifiers ·
   *  endorsements · loadings), same row grammar. */
  readonly underwriting?: readonly UnderwritingRow[];
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  const uwChanged = underwriting.filter((r) => r.status !== "same").length;
  const reassignedTotal = facts.territoryReassignments.reduce(
    (sum, t) => sum + t.count,
    0,
  );
  const bits: string[] = [
    `${facts.changedTables} of ${facts.sharedTables} shared tables change`,
  ];
  // FCA #24 (findings 74/102) — membership movement leads the story;
  // the pre-fix lede could read "0 tables change" over real premium
  // movement when counties swapped territories.
  if (reassignedTotal > 0) {
    bits.push(
      `${reassignedTotal} member${reassignedTotal === 1 ? "" : "s"} reassigned between territories`,
    );
  }
  if (uwChanged > 0) {
    bits.push(
      `${uwChanged} underwriting change${uwChanged === 1 ? "" : "s"}`,
    );
  }
  if (facts.onlyACoverages.length > 0)
    bits.push(
      `${facts.onlyACoverages.length} coverage tower${facts.onlyACoverages.length === 1 ? "" : "s"} only in A`,
    );
  if (facts.onlyBCoverages.length > 0)
    bits.push(
      `${facts.onlyBCoverages.length} coverage tower${facts.onlyBCoverages.length === 1 ? "" : "s"} only in B`,
    );
  if (facts.newDims.length > 0)
    bits.push(
      `${facts.newDims.length} new question${facts.newDims.length === 1 ? "" : "s"}`,
    );
  if (facts.removedDims.length > 0)
    bits.push(
      `${facts.removedDims.length} question${facts.removedDims.length === 1 ? "" : "s"} retired`,
    );
  if (facts.onlyBTables.length > 0)
    bits.push(
      `${facts.onlyBTables.length} table${facts.onlyBTables.length === 1 ? "" : "s"} only in B`,
    );
  if (facts.onlyATables.length > 0)
    bits.push(
      `${facts.onlyATables.length} table${facts.onlyATables.length === 1 ? "" : "s"} only in A`,
    );
  const questions =
    facts.newDims.length > 0 ||
    facts.removedDims.length > 0 ||
    facts.addedLevels.length > 0 ||
    facts.removedLevels.length > 0 ||
    facts.territoryReassignments.length > 0 ||
    facts.onlyACoverages.length > 0 ||
    facts.onlyBCoverages.length > 0;

  return (
    <section className="rater-exh__stage" aria-label="What changed">
      <div className="rater-exh__stage-head">
        <h2 className="rater-exh__stage-name">What changed</h2>
        <span className="rater-exh__stage-badge">
          A {aMeta.inputs} variables · {aMeta.tables} tables
          <span className="rater-exh__ledger-vs"> — </span>
          <span className="rater-exh__tile-badge-b">
            B {bMeta.inputs} variables · {bMeta.tables} tables
          </span>
        </span>
      </div>
      <p className="rater-exh__stage-story">
        <span className="rater-exh__b">{bLabel}</span> against{" "}
        {aLabel}: {bits.join(" · ")}.
      </p>

      <div className="rater-exh__stage-chart">
        <div className="rater-exh__ledger">
          {groups.map((group) => (
            <div key={group.name}>
              <p className="rater-exh__ledger-glabel">{group.name}</p>
              {group.rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={
                    row.status === "same"
                      ? "rater-exh__ledger-row rater-exh__ledger-row--same"
                      : "rater-exh__ledger-row"
                  }
                  onClick={() => onSelect(row.id)}
                  title={`Open ${row.name} on the stage`}
                >
                  <span className="rater-exh__ledger-mark" aria-hidden="true">
                    {STATUS_MARK[row.status]}
                  </span>
                  <span className="rater-exh__ledger-name">
                    {row.name}
                    {row.status === "new" ? (
                      <span className="rater-exh__rail-new"> new in B</span>
                    ) : row.status === "retired" ? (
                      <span className="rater-exh__ledger-note"> only in A</span>
                    ) : null}
                  </span>
                  <span className="rater-exh__ledger-moved">
                    {[
                      row.moved !== null && row.moved.changed > 0
                        ? `${row.moved.changed}/${row.moved.total} move`
                        : "",
                      // FCA #24 — a moved county is a CHANGE even
                      // when the factor cells are byte-identical.
                      row.reassigned !== null && row.reassigned > 0
                        ? `${row.reassigned} reassigned`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") ||
                      (row.status === "same" ? "unchanged" : "")}
                  </span>
                  <span className="rater-exh__ledger-big">
                    {row.biggest !== null ? (
                      <>
                        <span className="rater-exh__ledger-big-label">
                          {row.biggest.label}
                        </span>
                        <span className="rater-exh__ledger-big-vals">
                          ×{row.biggest.from.toFixed(2)}
                          <span className="rater-exh__ledger-big-b">
                            {" "}
                            → ×{row.biggest.to.toFixed(2)}
                            {pct(row.biggest.from, row.biggest.to)}
                          </span>
                        </span>
                      </>
                    ) : null}
                  </span>
                  <span className="rater-exh__ledger-span">
                    {row.spanPair ?? ""}
                  </span>
                </button>
              ))}
            </div>
          ))}

          {/* MVP-009 — the compare sees underwriting: rules, modifiers,
              endorsements, loadings, one terse line each. Not doors —
              their home is the plan's Eligibility/Rating tabs. */}
          {underwriting.length > 0 ? (
            <div>
              <p className="rater-exh__ledger-glabel">Underwriting</p>
              {underwriting.map((row) => (
                <div
                  key={row.id}
                  className={
                    row.status === "same"
                      ? "rater-exh__ledger-row rater-exh__ledger-row--same rater-exh__ledger-row--static"
                      : "rater-exh__ledger-row rater-exh__ledger-row--static"
                  }
                >
                  <span className="rater-exh__ledger-mark" aria-hidden="true">
                    {STATUS_MARK[row.status === "new" ? "new" : row.status === "retired" ? "retired" : row.status]}
                  </span>
                  <span className="rater-exh__ledger-name">
                    <span className="rater-exh__ledger-note">
                      {row.kind}{" "}
                    </span>
                    {row.name}
                    {row.status === "new" ? (
                      <span className="rater-exh__rail-new"> new in B</span>
                    ) : row.status === "retired" ? (
                      <span className="rater-exh__ledger-note"> only in A</span>
                    ) : null}
                  </span>
                  <span className="rater-exh__ledger-uw-change">
                    {row.status === "same" ? "unchanged" : (row.change ?? "")}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {questions ? (
          <div className="rater-exh__ledger-q">
            <p className="rater-exh__ledger-glabel">Questions</p>
            {facts.newDims.map((name) => (
              <p key={`nd-${name}`}>
                <span className="rater-exh__ledger-add">＋</span>{" "}
                <span className="rater-exh__b">{name}</span> — a question only
                B asks
              </p>
            ))}
            {facts.removedDims.map((name) => (
              <p key={`rd-${name}`}>
                <span className="rater-exh__ledger-rm">−</span> {name} — a
                question only A asks
              </p>
            ))}
            {facts.addedLevels.map((entry) => (
              <p key={`al-${entry.dim}`}>
                <span className="rater-exh__ledger-add">＋</span>{" "}
                <span className="rater-exh__num">{entry.ids.length}</span>{" "}
                level{entry.ids.length === 1 ? "" : "s"} join {entry.dim} (
                {entry.ids.slice(0, 3).join(", ")}
                {entry.ids.length > 3 ? "…" : ""})
              </p>
            ))}
            {facts.removedLevels.map((entry) => (
              <p key={`rl-${entry.dim}`}>
                <span className="rater-exh__ledger-rm">−</span>{" "}
                <span className="rater-exh__num">{entry.ids.length}</span>{" "}
                level{entry.ids.length === 1 ? "" : "s"} leave {entry.dim} (
                {entry.ids.slice(0, 3).join(", ")}
                {entry.ids.length > 3 ? "…" : ""})
              </p>
            ))}
            {/* FCA #24 (findings 74/102) — moved members, named and
                deduplicated. The committee summary can no longer say
                "unchanged" over a territorial redraw. */}
            {facts.territoryReassignments.map((entry) => (
              <p key={`tr-${entry.dimSlug}`}>
                <span className="rater-exh__ledger-mv">⇄</span>{" "}
                <span className="rater-exh__num">{entry.count}</span> member
                {entry.count === 1 ? "" : "s"} reassigned in {entry.dim} (
                {entry.moves
                  .slice(0, 3)
                  .map(
                    (m) => `${m.member} ${m.fromTerritory}→${m.toTerritory}`,
                  )
                  .join(", ")}
                {entry.moves.length > 3 ? "…" : ""})
              </p>
            ))}
            {/* FCA #24 (finding 76) — a retired tower is a plan
                change; it used to appear nowhere on this page. */}
            {facts.onlyACoverages.map((name) => (
              <p key={`ca-${name}`}>
                <span className="rater-exh__ledger-rm">−</span> {name} — a
                coverage tower only A rates
              </p>
            ))}
            {facts.onlyBCoverages.map((name) => (
              <p key={`cb-${name}`}>
                <span className="rater-exh__ledger-add">＋</span>{" "}
                <span className="rater-exh__b">{name}</span> — a coverage tower
                only B rates
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
