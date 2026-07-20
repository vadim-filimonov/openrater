/**
 * <Citation> — the single canonical citation rendering.
 *
 * Every surface uses this primitive so separators, page prefixes, and
 * source naming remain consistent.
 *
 * Format:
 *   <BookOpen /> <source> <rule> · p.<page>
 *
 * Examples:
 *   <Citation rule="Meridian BOP §11.A.1" page={108} />
 *     → "Meridian BOP Meridian BOP §11.A.1 · p.108"   (if source unspecified,
 *         the rule already carries the source prefix and we don't
 *         repeat it — see ruleAlreadyContainsSource()).
 *   <Citation rule="§11.A.1" source="Meridian BOP" page={108} />
 *     → "Meridian BOP §11.A.1 · p.108"
 *   <Citation rule="§7.B.1" source="Meridian BOP" page={[41, 44]} />
 *     → "Meridian BOP §7.B.1 · pp.41-44"
 *   <Citation rule="Crosswalk" source="Meridian BOP ↔ NAICS v2024" page={22} />
 *     → "Meridian BOP ↔ NAICS v2024 Crosswalk · p.22"
 *
 * Variants:
 *   inline (default) — single line, muted text, leading book icon
 *   block            — two-line stack with left hairline indent
 *
 * BEM:
 *   .rater-citation                        (root)
 *   .rater-citation--inline | --block      (variant)
 *   .rater-citation__icon                  (leading <BookOpen />)
 *   .rater-citation__source                (e.g. "Meridian BOP")
 *   .rater-citation__rule                  (e.g. "§11.A.1")
 *   .rater-citation__sep                   (the U+00B7 · between rule and page)
 *   .rater-citation__page                  (e.g. "p.108" or "pp.41-44")
 *
 * Tokens consumed:
 *   --rater-text-muted (default text)
 *   --rater-text-default (rule text — slightly stronger)
 *   --rater-t-12 (size)
 *   --rater-lh-snug (line height)
 *   --rater-font-sans (source text)
 *   --rater-font-mono (rule text — actuary tooling convention)
 *   --rater-s-{4,6,12} (gaps + padding)
 *   --rater-hairline-soft (block variant left rule)
 */

import { BookOpen } from "lucide-react";
import "./Citation.css";

/**
 * The page reference. A single number prints as "p.N"; a tuple as
 * "pp.A-B". `null` (or omitting `page`) suppresses the page block.
 */
export type CitationPage = number | readonly [number, number];

export interface CitationProps {
  /**
   * The rule itself — e.g. "§11.A.1", "Crosswalk", "Schedule III".
   * Verbatim — not normalized; the actuary's source format is the
   * canonical form.
   */
  readonly rule: string;
  /**
   * The source manual / standard / table the rule lives in. E.g.
   * "Meridian BOP", "Meridian BOP ↔ NAICS v2024". If omitted, the rule is
   * displayed alone (no source prefix). If the rule already
   * begins with the source name (the common case for `"Meridian BOP §..."`),
   * the source is detected and not duplicated.
   */
  readonly source?: string;
  /** Page reference; single number or [start, end] range. */
  readonly page?: CitationPage;
  /**
   * Layout variant. Default `inline`.
   * - `inline` — single line, muted
   * - `block`  — two-line stack with left hairline
   */
  readonly variant?: "inline" | "block";
  /**
   * Optional `aria-label` override. When omitted, the component
   * builds one from source + rule + page so screen-reader users
   * hear the structured form ("Citation: Meridian BOP, §11.A.1, page 108").
   */
  readonly ariaLabel?: string;
}

/**
 * Detects whether the rule string already begins with the named
 * source (avoiding duplication like "Meridian BOP Meridian BOP §3.1").
 */
function ruleAlreadyContainsSource(rule: string, source: string): boolean {
  const trimmedSource = source.trim();
  if (!trimmedSource) return false;
  return rule.trim().toLowerCase().startsWith(trimmedSource.toLowerCase());
}

function formatPage(page: CitationPage): string {
  if (typeof page === "number") return `p.${page}`;
  const [start, end] = page;
  if (start === end) return `p.${start}`;
  return `pp.${start}-${end}`;
}

function buildAriaLabel(
  source: string | undefined,
  rule: string,
  page: CitationPage | undefined,
): string {
  const parts: string[] = ["Citation:"];
  if (source) parts.push(source);
  parts.push(rule);
  if (page !== undefined) {
    const pageStr =
      typeof page === "number"
        ? `page ${page}`
        : `pages ${page[0]} to ${page[1]}`;
    parts.push(pageStr);
  }
  return parts.join(" ");
}

export function Citation({
  rule,
  source,
  page,
  variant = "inline",
  ariaLabel,
}: CitationProps) {
  // If the source is already embedded in the rule, don't repeat it.
  const showSource =
    source !== undefined && !ruleAlreadyContainsSource(rule, source);

  const label = ariaLabel ?? buildAriaLabel(source, rule, page);

  return (
    <span
      className={`rater-citation rater-citation--${variant}`}
      aria-label={label}
    >
      <span className="rater-citation__icon" aria-hidden>
        <BookOpen size={12} />
      </span>
      {showSource ? (
        <span className="rater-citation__source">{source}</span>
      ) : null}
      <span className="rater-citation__rule">{rule}</span>
      {page !== undefined ? (
        <>
          <span className="rater-citation__sep" aria-hidden>
            ·
          </span>
          <span className="rater-citation__page">{formatPage(page)}</span>
        </>
      ) : null}
    </span>
  );
}
