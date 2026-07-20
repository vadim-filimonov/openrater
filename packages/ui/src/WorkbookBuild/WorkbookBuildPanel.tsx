/**
 * WorkbookBuildPanel — Brief 92 scenes 2–5, the "Build from a workbook"
 * door's body on /rate-lab/new.
 *
 * The flow is a discriminated union (P-2), all deterministic:
 *
 *   drop → checking → checked (clean ⇒ the dry-run manifest;
 *   dirty ⇒ the cell-addressed check report) → building → built
 *   (the BuildReportView + "Open the plan")
 *
 * Nothing is created until "Build the plan"; a failed check is a
 * fix-and-re-drop loop, never a dead end. The zero-AI posture is
 * stated on the surface itself — the workbook is read exactly as
 * written.
 */

import { useRef, useState, type DragEvent } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { PRODUCT_LABELS, isProductCode } from "@openrater/contracts";
import { Button } from "@openrater/design-system";
import { BuildReportView } from "./BuildReportView";
import type {
  BuildWorkbookFn,
  BuildWorkbookResponseLike,
  CheckWorkbookFn,
  ReingestCheckResultLike,
  RevisionCandidateLike,
  WorkbookCheckIssue,
  WorkbookCheckResultLike,
} from "./types";
import { RevisionReview } from "./RevisionReview";
import "./workbook-build.css";

type Phase =
  | { kind: "drop" }
  | { kind: "checking"; filename: string }
  | { kind: "checked"; filename: string; bytes: ArrayBuffer; result: WorkbookCheckResultLike }
  | { kind: "building"; filename: string; bytes: ArrayBuffer; result: WorkbookCheckResultLike }
  // Brief 92.R — the revision loop: review what changes, then apply
  // to the SAME plan (never instead of building separately).
  | {
      kind: "revision-review";
      filename: string;
      bytes: ArrayBuffer;
      result: WorkbookCheckResultLike;
      target: RevisionCandidateLike;
      review: ReingestCheckResultLike;
    }
  | {
      kind: "revision-applying";
      filename: string;
      bytes: ArrayBuffer;
      result: WorkbookCheckResultLike;
      target: RevisionCandidateLike;
      review: ReingestCheckResultLike;
    }
  | { kind: "built"; response: BuildWorkbookResponseLike };

/** Group check issues by sheet for the scene-3 report (spec-voice:
 *  cite the sheet, then the cells inside it). */
export function groupIssuesBySheet(
  issues: readonly WorkbookCheckIssue[],
): Array<{ sheet: string; issues: WorkbookCheckIssue[] }> {
  const order: string[] = [];
  const bySheet = new Map<string, WorkbookCheckIssue[]>();
  for (const issue of issues) {
    const sheet = issue.sheet ?? "(workbook)";
    if (!bySheet.has(sheet)) {
      bySheet.set(sheet, []);
      order.push(sheet);
    }
    bySheet.get(sheet)!.push(issue);
  }
  return order.map((sheet) => ({ sheet, issues: bySheet.get(sheet)! }));
}

export function checkFailedHeadline(result: WorkbookCheckResultLike): string {
  const e = result.errors.length;
  const w = result.warnings.length;
  return (
    `The workbook didn't pass the check — ${e} error${e === 1 ? "" : "s"}` +
    (w > 0 ? `, ${w} warning${w === 1 ? "" : "s"}` : "") +
    "."
  );
}

/** `s(1, "chain", "chains")` — honest plurals everywhere (Brief 94 U9). */
function s(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Brief 94 (U5) — the citation-coverage line under the manifest. */
export function citationLine(cited: number, total: number): string {
  if (cited === total) {
    return `All ${total} factor ${s(total, "cell cites", "cells cite")} a filing page.`;
  }
  const uncited = total - cited;
  return (
    `${cited} of ${total} factor ${s(total, "cell", "cells")} cite a filing ` +
    `page — ${uncited} ${s(uncited, "doesn't", "don't")} (they ride the ` +
    "build report)."
  );
}

export function manifestTiles(
  result: WorkbookCheckResultLike,
): Array<{ value: string; label: string }> {
  const c = result.manifest?.counts;
  if (!c) return [];
  const tiles = [
    {
      value: String(c.dimensions),
      label: `${s(c.dimensions, "dimension", "dimensions")} · ${c.dimension_levels} ${s(c.dimension_levels, "level", "levels")}`,
    },
    {
      value: String(c.factor_tables),
      label: `${s(c.factor_tables, "factor table", "factor tables")} · ${c.factor_cells} ${s(c.factor_cells, "cell", "cells")}`,
    },
    {
      value: String(c.chains),
      label: `${s(c.chains, "chain", "chains")} · ${c.chain_stages} ${s(c.chain_stages, "stage", "stages")}`,
    },
    { value: String(c.gates), label: s(c.gates, "eligibility gate", "eligibility gates") },
    {
      value: String(c.inputs),
      label: `declared ${s(c.inputs, "input", "inputs")} · ${c.inputs_with_defaults} with ${s(c.inputs_with_defaults, "a default", "defaults")}`,
    },
    { value: String(c.outputs), label: s(c.outputs, "output", "outputs") },
    {
      value: String(c.test_cases),
      label: `${s(c.test_cases, "test vector", "test vectors")} from the filing`,
    },
    { value: String(c.declared_gaps), label: "flagged by the transcriber" },
  ];
  // Brief 94 (U5) — the dry-run states everything it parsed; constructs
  // a simple workbook doesn't file stay out of the way (render-if-nonzero).
  const extras: Array<readonly [number, string, string]> = [
    [c.endorsements, "endorsement", "endorsements"],
    [c.modifier_categories, "modifier category", "modifier categories"],
    [c.loadings, "loading", "loadings"],
    [c.final_adjustments, "final adjustment", "final adjustments"],
    [c.geo_rows, "geo row (ZIP/county)", "geo rows (ZIP/county)"],
  ];
  for (const [n, one, many] of extras) {
    if (n > 0) tiles.push({ value: String(n), label: s(n, one, many) });
  }
  return tiles;
}

export interface WorkbookBuildPanelProps {
  /** The check operation — the app layer passes api-client's
   *  `checkWorkbook`; @openrater/ui never talks HTTP itself. */
  readonly checkWorkbook: CheckWorkbookFn;
  /** The build operation — api-client's `buildWorkbookPlan`. */
  readonly buildWorkbook: BuildWorkbookFn;
  /** Back to the blank create card. */
  readonly onStartBlank: () => void;
  /** Leave /rate-lab/new entirely. */
  readonly onCancel: () => void;
  /** Navigate to a plan (the built one, or an already-built twin). */
  readonly onOpenPlan: (ratingPlanId: string) => void;
  /** Starter-kit download URLs (Brief 94 §2) — the app layer builds
   *  them from api-client's `ingestAssetUrl`; @openrater/ui never talks
   *  HTTP itself. The server's Content-Disposition drives the save. */
  readonly assetUrls: {
    readonly spec: string;
    readonly template: string;
    readonly example: string;
  };
  /** Brief 92.R — the revision loop's two operations (api-client's
   *  `reingestCheck` / `reingestApply`). Omit them and the panel
   *  behaves exactly as before (discovery renders data-less). */
  readonly reingestCheck?: (
    ratingPlanId: string,
    data: ArrayBuffer,
    filename?: string,
  ) => Promise<ReingestCheckResultLike>;
  readonly reingestApply?: (
    ratingPlanId: string,
    data: ArrayBuffer,
    opts: { filename?: string; ifMatch?: string },
  ) => Promise<BuildWorkbookResponseLike>;
}

/** `File.arrayBuffer()` with a FileReader fallback (jsdom's File has
 *  no arrayBuffer — the test environment exercises the fallback). */
function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(file);
  });
}

export function WorkbookBuildPanel({
  checkWorkbook,
  buildWorkbook,
  onStartBlank,
  onCancel,
  onOpenPlan,
  assetUrls,
  reingestCheck,
  reingestApply,
}: WorkbookBuildPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "drop" });
  const [failure, setFailure] = useState<string | null>(null);
  // Brief 94 (U3) — a non-.xlsx never round-trips to the server; the
  // zone itself explains, in its own voice.
  const [typeRefusal, setTypeRefusal] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const runCheck = async (file: File) => {
    setFailure(null);
    setPhase({ kind: "checking", filename: file.name });
    try {
      const bytes = await readFileBytes(file);
      const result = await checkWorkbook(bytes, file.name);
      setPhase({ kind: "checked", filename: file.name, bytes, result });
    } catch (err) {
      setFailure(
        err instanceof Error ? err.message : "Couldn't check the workbook.",
      );
      setPhase({ kind: "drop" });
    }
  };

  const runBuild = async () => {
    // Reachable from the manifest scene AND the revision review's
    // "Build a separate plan instead" (Brief 92.R D2 — the separate-
    // plan path is never taken away).
    if (phase.kind !== "checked" && phase.kind !== "revision-review") return;
    const { filename, bytes, result } = phase;
    setFailure(null);
    setPhase({ kind: "building", filename, bytes, result });
    try {
      const response = await buildWorkbook(bytes, filename);
      setPhase({ kind: "built", response });
    } catch (err) {
      setFailure(
        err instanceof Error ? err.message : "Couldn't build the plan.",
      );
      setPhase({ kind: "checked", filename, bytes, result });
    }
  };

  // Brief 92.R — review the revision against the plan it names.
  const runReviewRevision = async () => {
    if (phase.kind !== "checked" || !reingestCheck) return;
    const target = phase.result.revises;
    if (!target) return;
    setFailure(null);
    try {
      const review = await reingestCheck(
        target.rating_plan_id,
        phase.bytes,
        phase.filename,
      );
      setPhase({
        kind: "revision-review",
        filename: phase.filename,
        bytes: phase.bytes,
        result: phase.result,
        target,
        review,
      });
    } catch (err) {
      setFailure(
        err instanceof Error ? err.message : "Couldn't review the revision.",
      );
    }
  };

  const runApplyRevision = async () => {
    if (phase.kind !== "revision-review" || !reingestApply) return;
    setFailure(null);
    setPhase({ ...phase, kind: "revision-applying" });
    try {
      const response = await reingestApply(phase.target.rating_plan_id, phase.bytes, {
        filename: phase.filename,
        ...(phase.review.plan_content_hash
          ? { ifMatch: phase.review.plan_content_hash }
          : {}),
      });
      setPhase({ kind: "built", response });
    } catch (err) {
      setFailure(
        err instanceof Error ? err.message : "Couldn't apply the revision.",
      );
      setPhase({ ...phase, kind: "revision-review" });
    }
  };

  const acceptFile = (file: File) => {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx")) {
      const dot = name.lastIndexOf(".");
      setTypeRefusal(dot > 0 ? `a ${name.slice(dot)}` : "not an .xlsx");
      return;
    }
    setTypeRefusal(null);
    void runCheck(file);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  };

  const downloadReport = () => {
    if (phase.kind !== "built") return;
    const blob = new Blob(
      [JSON.stringify(phase.response.report, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${phase.response.rating_plan_id}-build-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const failureBanner = failure ? (
    <div className="rater-workbook-build__banner" role="alert">
      <TriangleAlert aria-hidden />
      <span>{failure}</span>
    </div>
  ) : null;

  // ── Scene 5 — the build report ──────────────────────────────────
  if (phase.kind === "built") {
    const { response } = phase;
    return (
      <div className="rater-workbook-build">
        <p className="rater-workbook-build__report-sub">
          Plan created as a draft. This report lives on the plan's
          Overview — you can come back to it anytime.
        </p>
        <BuildReportView report={response.report} />
        <div className="rater-workbook-build__foot">
          <Button variant="plain" onClick={downloadReport}>
            Download report (JSON)
          </Button>
          <div className="rater-workbook-build__actions">
            <Button
              variant="primary"
              onClick={() => onOpenPlan(response.rating_plan_id)}
            >
              Open the plan
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Scenes 3 + 4 — checked (dirty or clean) ─────────────────────
  if (phase.kind === "checked" || phase.kind === "building") {
    const { result, filename } = phase;
    const clean = result.ok;
    const prov = result.manifest?.provenance;
    // Brief 94 (U6) — the chip speaks the product's label; the raw
    // code stays reachable via the tooltip.
    const productLabel =
      prov?.product && isProductCode(prov.product)
        ? PRODUCT_LABELS[prov.product]
        : (prov?.product ?? null);
    const provenanceChips: Array<{
      label: string;
      value: string | null;
      title?: string | undefined;
    }> = prov
      ? [
          { label: "Carrier", value: prov.carrier },
          { label: "Product", value: productLabel, title: prov.product ?? undefined },
          { label: "State", value: prov.state },
          { label: "Effective", value: prov.effective_date },
          { label: "SERFF", value: prov.serff_tracking_number },
        ].filter((c) => c.value)
      : [];

    return (
      <div className="rater-workbook-build">
        {failureBanner}
        <div className="rater-workbook-build__filechip">
          <FileSpreadsheet aria-hidden />
          <code>{filename}</code>
          <span className="rater-workbook-build__filechip-meta">
            {result.sheet_count} sheets · spec {result.spec_version}
          </span>
        </div>

        {clean ? (
          <>
            {result.already_built ? (
              <div className="rater-workbook-build__notice" role="status">
                <span>
                  This exact workbook was already built
                  {" "}
                  ({result.already_built.created_at.slice(0, 10)}).
                </span>
                <Button
                  variant="plain"
                  size="xs"
                  onClick={() =>
                    onOpenPlan(result.already_built!.rating_plan_id)
                  }
                >
                  Open the existing plan →
                </Button>
              </div>
            ) : null}
            {result.revises && reingestCheck && reingestApply ? (
              <div className="rater-workbook-build__revises" role="status">
                <RefreshCw aria-hidden />
                <div>
                  <span className="rater-workbook-build__revises-title">
                    This workbook revises {result.revises.display_name}
                  </span>
                  <span className="rater-workbook-build__revises-sub">
                    Update it — read exactly what changes first — or build a
                    separate plan.
                  </span>
                  <span className="rater-workbook-build__revises-meta">
                    v{result.revises.version_from ?? "?"} → v
                    {result.revises.version_to ?? "?"} · built{" "}
                    {result.revises.built_at.slice(0, 10)}
                  </span>
                </div>
              </div>
            ) : null}
            {provenanceChips.length > 0 ? (
              <div className="rater-workbook-build__prov">
                {provenanceChips.map((chip) => (
                  <span
                    key={chip.label}
                    className="rater-workbook-build__chip"
                    title={chip.title}
                  >
                    {chip.label} <strong>{chip.value}</strong>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="rater-workbook-build__grid">
              {manifestTiles(result).map((tile) => (
                <div key={tile.label} className="rater-workbook-build__stat">
                  <span className="rater-workbook-build__stat-value">
                    {tile.value}
                  </span>
                  <span className="rater-workbook-build__stat-label">
                    {tile.label}
                  </span>
                </div>
              ))}
            </div>
            {(result.manifest?.counts.factor_cells ?? 0) > 0 ? (
              <p
                className={
                  "rater-workbook-build__citations" +
                  (result.manifest!.counts.factor_cells_cited ===
                  result.manifest!.counts.factor_cells
                    ? " rater-workbook-build__citations--full"
                    : "")
                }
              >
                <BadgeCheck aria-hidden />
                {citationLine(
                  result.manifest!.counts.factor_cells_cited,
                  result.manifest!.counts.factor_cells,
                )}
              </p>
            ) : null}
            {(result.manifest?.counts.declared_gaps ?? 0) > 0 ? (
              <div className="rater-workbook-build__ride">
                <TriangleAlert aria-hidden />
                <span>
                  {result.manifest!.counts.declared_gaps}{" "}
                  {s(result.manifest!.counts.declared_gaps, "item", "items")}{" "}
                  flagged by the transcriber{" "}
                  {s(result.manifest!.counts.declared_gaps, "rides", "ride")}{" "}
                  along to the build report.
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="rater-workbook-build__banner" role="alert">
              <TriangleAlert aria-hidden />
              <span>
                <strong>{checkFailedHeadline(result)}</strong> Nothing was
                created. Fix the rows below and drop it again.
              </span>
            </div>
            <div className="rater-workbook-build__lint">
              {groupIssuesBySheet([...result.errors, ...result.warnings]).map(
                (group) => (
                  <div key={group.sheet} className="rater-workbook-build__sheet">
                    <code className="rater-workbook-build__sheet-name">
                      {group.sheet}
                    </code>
                    {group.issues.map((issue, i) => (
                      <div key={i} className="rater-workbook-build__lint-row">
                        <span
                          className={`rater-workbook-build__dot rater-workbook-build__dot--${issue.severity}`}
                          aria-hidden
                        />
                        <code className="rater-workbook-build__cell">
                          {issue.cell ?? "—"}
                        </code>
                        <span className="rater-workbook-build__msg">
                          {issue.message}
                        </span>
                        <code className="rater-workbook-build__rule">
                          {issue.rule}
                        </code>
                      </div>
                    ))}
                  </div>
                ),
              )}
            </div>
          </>
        )}

        <div className="rater-workbook-build__foot">
          <Button
            variant="plain"
            icon={<ArrowLeft />}
            onClick={() => setPhase({ kind: "drop" })}
            disabled={phase.kind === "building"}
          >
            {clean ? "Different workbook" : "Drop a corrected workbook"}
          </Button>
          <div className="rater-workbook-build__actions">
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={phase.kind === "building"}
            >
              Cancel
            </Button>
            {clean && result.revises && reingestCheck && reingestApply ? (
              <>
                <Button
                  variant="ghost"
                  disabled={phase.kind === "building"}
                  onClick={() => void runBuild()}
                >
                  Build a separate plan
                </Button>
                <Button variant="primary" onClick={() => void runReviewRevision()}>
                  Review the revision
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                disabled={!clean}
                loading={phase.kind === "building"}
                onClick={() => void runBuild()}
              >
                Build the plan
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Brief 92.R scene 2 — the diff review ─────────────────────────
  if (phase.kind === "revision-review" || phase.kind === "revision-applying") {
    return (
      <div className="rater-workbook-build">
        {failureBanner}
        <div className="rater-workbook-build__filechip">
          <FileSpreadsheet aria-hidden />
          <code>{phase.filename}</code>
          <span className="rater-workbook-build__filechip-meta">
            what the revision changes
          </span>
        </div>
        <RevisionReview
          review={phase.review}
          planLabel={phase.target.display_name}
        />
        <div className="rater-workbook-build__foot">
          <Button
            variant="plain"
            icon={<ArrowLeft />}
            onClick={() => setPhase({ kind: "drop" })}
            disabled={phase.kind === "revision-applying"}
          >
            Different workbook
          </Button>
          <div className="rater-workbook-build__actions">
            <Button
              variant="ghost"
              disabled={phase.kind === "revision-applying"}
              onClick={() => void runBuild()}
            >
              Build a separate plan instead
            </Button>
            <Button
              variant="primary"
              loading={phase.kind === "revision-applying"}
              onClick={() => void runApplyRevision()}
            >
              Apply the revision
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Scenes 1–2 — the drop zone ──────────────────────────────────
  const checking = phase.kind === "checking";
  return (
    <div className="rater-workbook-build">
      {failureBanner}
      <button
        type="button"
        className={
          "rater-workbook-build__drop" +
          (dragOver ? " rater-workbook-build__drop--over" : "") +
          (typeRefusal && !checking ? " rater-workbook-build__drop--refused" : "")
        }
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
          setTypeRefusal(null);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        disabled={checking}
        aria-busy={checking}
        aria-label="Drop a rating workbook, or press Enter to browse"
      >
        <span className="rater-workbook-build__drop-icon" aria-hidden>
          {typeRefusal && !checking ? <TriangleAlert /> : <Upload />}
        </span>
        {typeRefusal && !checking ? (
          <span className="rater-workbook-build__drop-refusal" role="alert">
            <span className="rater-workbook-build__drop-title">
              That&apos;s {typeRefusal} — the workbook is an .xlsx
            </span>
            <span className="rater-workbook-build__drop-sub">
              If you have the filing PDF, hand it to your AI with the format
              spec; drop the workbook it produces.
            </span>
            <span className="rater-workbook-build__drop-sub">
              Drop the .xlsx here, or{" "}
              <span className="rater-workbook-build__browse">browse</span>
            </span>
          </span>
        ) : (
          <>
            <span className="rater-workbook-build__drop-title">
              {checking
                ? `Checking ${phase.filename}…`
                : "Drop the workbook here"}
            </span>
            {checking ? (
              <>
                {/* Brief 94 (U4) — honest progress: one call, one
                    indeterminate bar; reduced-motion gets a static tint. */}
                <span
                  className="rater-workbook-build__progress"
                  aria-hidden
                >
                  <i />
                </span>
                <span className="rater-workbook-build__drop-sub" role="status">
                  Read exactly as written — checking against the format spec.
                  Nothing is created.
                </span>
              </>
            ) : (
              <span className="rater-workbook-build__drop-sub">
                or <span className="rater-workbook-build__browse">browse</span>{" "}
                for the .xlsx
              </span>
            )}
          </>
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="rater-workbook-build__file-input"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) acceptFile(file);
        }}
      />

      <div className="rater-workbook-build__kit">
        <div className="rater-workbook-build__kit-title">
          What&apos;s a rating workbook?
        </div>
        <div className="rater-workbook-build__kit-grid">
          <a
            className="rater-workbook-build__kit-card"
            href={assetUrls.spec}
            aria-label="Download the format spec (markdown)"
          >
            <span className="rater-workbook-build__kit-name">
              <FileText aria-hidden />
              The format spec
            </span>
            <span className="rater-workbook-build__kit-desc">
              Hand it to your AI with the filing. It defines every sheet the
              platform reads.
            </span>
            <span className="rater-workbook-build__kit-meta">markdown · CC BY</span>
          </a>
          <a
            className="rater-workbook-build__kit-card"
            href={assetUrls.template}
            aria-label="Download the template workbook (xlsx)"
          >
            <span className="rater-workbook-build__kit-name">
              <FileSpreadsheet aria-hidden />
              Template workbook
            </span>
            <span className="rater-workbook-build__kit-desc">
              Every sheet with its headers, plus a tiny rated program inside —
              replace it with yours.
            </span>
            <span className="rater-workbook-build__kit-meta">.xlsx · checks clean</span>
          </a>
          <a
            className="rater-workbook-build__kit-card"
            href={assetUrls.example}
            aria-label="Download the worked example workbook (xlsx)"
          >
            <span className="rater-workbook-build__kit-name">
              <BadgeCheck aria-hidden />
              Worked example
            </span>
            <span className="rater-workbook-build__kit-desc">
              A complete program: 22 sheets, 20 filing examples, all green.
            </span>
            <span className="rater-workbook-build__kit-meta">
              .xlsx · nonprofit D&amp;O + GL
            </span>
          </a>
        </div>
      </div>
      <p className="rater-workbook-build__posture">
        <ShieldCheck aria-hidden />
        Checked before anything is created. The workbook is read exactly as
        written — no AI, no guessing.
      </p>

      <div className="rater-workbook-build__foot">
        <Button
          variant="plain"
          icon={<ArrowLeft />}
          onClick={onStartBlank}
          disabled={checking}
        >
          Start blank instead
        </Button>
        <div className="rater-workbook-build__actions">
          <Button variant="ghost" onClick={onCancel} disabled={checking}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
