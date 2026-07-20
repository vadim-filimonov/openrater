/**
 * formatTableCitation — : "where did this number come from"
 * as one quiet clause, from the table record's own provenance
 * (`source_page` + the rule reference the workbook's citation_rule
 * column carried, stored in `source_pdf_url`).
 *
 * "cited p. 6 — Rule C.5" · "cited p. 6" · "cited — Rule C.5" · null.
 */
export function formatTableCitation(t: {
  readonly source_page?: number | null | undefined;
  readonly source_pdf_url?: string | null | undefined;
}): string | null {
  const rule = t.source_pdf_url?.match(/Rule\s+\S+/)?.[0] ?? null;
  if (t.source_page != null && rule) {
    return `cited p. ${t.source_page} — ${rule}`;
  }
  if (t.source_page != null) return `cited p. ${t.source_page}`;
  return rule !== null ? `cited — ${rule}` : null;
}
