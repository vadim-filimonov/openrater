/**
 * <DataSourcePicker> + <CsvDropzone> — Brief 38 PR 38.5.
 *
 * Two cooperating primitives:
 *
 *   <DataSourcePicker>  — segmented toggle ([⊞ CSV] [⇄ Webhook])
 *                          + status meta chip + optional Replace/Score
 *                          actions. The top bar of the workspace.
 *
 *   <CsvDropzone>       — drag-and-drop + click-to-upload + paste
 *                          target for raw CSV. Reads a File, passes
 *                          the text + filename + size to onParsed.
 *                          Drives the CSV-source variant of the Brief
 *                          38 source picker.
 *
 * Both are controlled. State (source kind, loaded CSV) lives in the
 * orchestrator (PR 38.8). These primitives expose
 *   - onSourceKindChange(next)         — toggle
 *   - onCsvLoaded({ text, filename })  — dropzone
 *   - onError(error)                   — parse / read failures
 *
 * Visual contract matches Frames 1 + 2 of the Brief 38 mockup.
 * BEM blocks: rater-dsp (data-source picker), rater-csvz (CSV
 * dropzone).
 */

// The v1 <DataSourcePicker>/<CsvDropzone>/<CsvLoadedSummary> primitives
// were deleted in the v2 cutover (2026-06-09); this module now exports
// only the reused types (SourceKind + SampleDataset).

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** Which source the workspace is wired to. */
export type SourceKind = "csv" | "webhook";

export interface SampleDataset {
  /** Display text for the link (e.g., "2000 nonprofit policies"). */
  readonly label: string;
  /**
   * URL to fetch. For Vite-served static files in `rate-lab/frontend/
   * public/`, this is the absolute path (e.g.,
   * `/nonprofit_990_2000_policies.csv`). For full URLs, pass a fully-
   * qualified absolute URL — fetch handles both.
   */
  readonly url: string;
  /**
   * Optional human-readable filename for the load event. Defaults to
   * the URL's basename. Surfaces in the CsvLoadedSummary chip after
   * a successful fetch.
   */
  readonly filename?: string;
}
