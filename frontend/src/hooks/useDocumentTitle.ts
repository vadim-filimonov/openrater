/**
 * useDocumentTitle — Brief 88 §3.4 (F9): per-route document titles.
 *
 * Before this, no route ever wrote `document.title`, so every browser
 * tab, bookmark, and history entry read "OpenRater". Each route now
 * declares its place: `useDocumentTitle("Rate Lab")` →
 * "Rate Lab · OpenRater"; `useDocumentTitle(plan?.display_name, "Rate
 * Lab")` → "Meridian BOP — Kansas — 2025 · Rate Lab · OpenRater".
 *
 * The orientation loop (brief §3.3): the nav word, the surface title,
 * and the document title are the same word.
 *
 * Nullish/empty parts are skipped (a plan title renders "Rate Lab ·
 * OpenRater" until the plan loads, then upgrades). Restores the brand
 * default on unmount, so Home — which mounts no hook — always reads
 * plain "OpenRater".
 */

import { useEffect } from "react";

const BRAND = "OpenRater";

export function useDocumentTitle(
  ...parts: ReadonlyArray<string | null | undefined>
): void {
  const title = [...parts.filter((p): p is string => !!p && p.trim() !== ""), BRAND].join(
    " · ",
  );
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = BRAND;
    };
  }, [title]);
}
