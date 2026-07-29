/**
 * <ClassBulkImportOverlay> — paste / upload a class table (Brief 51).
 *
 * The acceptance path for loading a real filing's `class_table`. Parses
 * the pasted/uploaded CSV with `parseClassTableCsv` (which routes unknown
 * columns into `attributes`), shows a live valid/skipped preview, and
 * imports via the parent's callback (merge | replace).
 *
 * States honor §7: the importer NEVER silently drops rows — invalid rows
 * are counted + surfaced.
 */

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FileUp } from "lucide-react";
import { Button, Checkbox, Drawer } from "@openrater/design-system";
import { parseClassTableCsv } from "./classCsv";
import type { ClassDraft } from "./types";
import "./ClassBulkImportOverlay.css";

export interface ClassBulkImportOverlayProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onImport: (rows: ClassDraft[], mode: "merge" | "replace") => void;
  readonly importing?: boolean;
  readonly testId?: string;
}

export function ClassBulkImportOverlay(
  props: ClassBulkImportOverlayProps,
): JSX.Element {
  const {
    open,
    onCancel,
    onImport,
    importing = false,
    testId = "rater-class-import",
  } = props;

  const [text, setText] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [markIso, setMarkIso] = useState(true);

  const parsed = useMemo(
    () => (text.trim() !== "" ? parseClassTableCsv(text) : null),
    [text],
  );

  const drafts = useMemo<ClassDraft[]>(() => {
    if (!parsed?.ok) return [];
    return parsed.rows
      .filter((r) => r.draft)
      .map((r) =>
        markIso ? { ...(r.draft as ClassDraft), source: "iso" as const } : (r.draft as ClassDraft),
      );
  }, [parsed, markIso]);

  const errorRows = parsed?.ok ? parsed.rows.filter((r) => r.error) : [];

  const onFile = (file: File | undefined): void => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const handleImport = (): void => {
    if (drafts.length > 0) onImport(drafts, mode);
  };

  return (
    <Drawer
      open={open}
      onClose={onCancel}
      title="Import class table"
      subtitle="Paste or upload a CSV"
    >
      <Drawer.Body>
        <p className="rater-class-import__intro">
          Paste your class table or upload a CSV. The first row is the header.
          Known columns (<code>class_code</code>, <code>display_name</code>/
          <code>description</code>, <code>family</code>, <code>naics_code</code>,
          <code>sic_code</code>, <code>eligible_for</code>) map to fields;{" "}
          <strong>every other column becomes a derived rating attribute</strong>{" "}
          (e.g. <code>prop_rate_number</code>, <code>liab_class_group</code>).
        </p>

        <label className="rater-class-import__file">
          <FileUp size={14} aria-hidden /> Upload CSV…
          <input
            type="file"
            accept=".csv,text/csv"
            className="rater-class-import__file-input"
            onChange={(e) => onFile(e.target.files?.[0])}
            aria-label="Upload CSV file"
          />
        </label>

        <textarea
          className="rater-class-import__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "class_code,description,naics_code,prop_rate_number,liab_class_group,liab_exposure_base\n53983,Army/Navy Retail,452990,09,cg_07,sales"
          }
          aria-label="Paste CSV"
          rows={6}
          spellCheck={false}
          data-testid={`${testId}-textarea`}
        />

        {parsed && !parsed.ok && (
          <div className="rater-class-import__alert" role="alert">
            <AlertCircle size={14} aria-hidden /> Couldn&rsquo;t parse: {parsed.error}
          </div>
        )}

        {parsed?.ok && (
          <div className="rater-class-import__preview" data-testid={`${testId}-preview`}>
            <div className="rater-class-import__summary">
              <span className="rater-class-import__stat rater-class-import__stat--ok">
                <CheckCircle2 size={14} aria-hidden /> {parsed.validCount} ready
              </span>
              {errorRows.length > 0 && (
                <span className="rater-class-import__stat rater-class-import__stat--skip">
                  <AlertCircle size={14} aria-hidden /> {errorRows.length} skipped
                </span>
              )}
              <span className="rater-class-import__cols">
                {parsed.columns.length} columns
              </span>
            </div>

            {drafts.length > 0 && (
              <ul className="rater-class-import__rows">
                {drafts.slice(0, 8).map((d) => (
                  <li className="rater-class-import__row" key={d.class_code}>
                    <span className="rater-class-import__row-code">{d.class_code}</span>
                    <span className="rater-class-import__row-name" title={d.display_name}>
                      {d.display_name}
                    </span>
                    <span className="rater-class-import__row-attrs">
                      {Object.keys(d.attributes).length > 0
                        ? `${Object.keys(d.attributes).length} attr`
                        : "—"}
                    </span>
                  </li>
                ))}
                {drafts.length > 8 && (
                  <li className="rater-class-import__more">
                    +{drafts.length - 8} more
                  </li>
                )}
              </ul>
            )}

            {errorRows.length > 0 && (
              <p className="rater-class-import__skipped">
                Skipped{" "}
                {errorRows.slice(0, 5).map((r) => `#${r.rowIndex}`).join(", ")}
                {errorRows.length > 5 ? "…" : ""} — {errorRows[0]!.error}.
              </p>
            )}
          </div>
        )}

        <div className="rater-class-import__opts">
          <Checkbox
            className="rater-class-import__opt"
            checked={markIso}
            onChange={setMarkIso}
            label="Mark all as ISO (filed)"
          />
          <Checkbox
            className="rater-class-import__opt"
            checked={mode === "replace"}
            onChange={(next) => setMode(next ? "replace" : "merge")}
            data-testid={`${testId}-replace`}
            label={<>Replace the plan&rsquo;s existing classes</>}
          />
        </div>
      </Drawer.Body>
      <Drawer.Footer>
        <div className="rater-class-import__footer-spacer" />
        <Button variant="ghost" onClick={onCancel} disabled={importing}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleImport}
          disabled={drafts.length === 0 || importing}
          loading={importing}
          data-testid={`${testId}-submit`}
        >
          Import {drafts.length > 0 ? drafts.length : ""}{" "}
          {drafts.length === 1 ? "class" : "classes"}
        </Button>
      </Drawer.Footer>
    </Drawer>
  );
}
