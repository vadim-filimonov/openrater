/**
 * Run staleness — ADR-0064.
 *
 * "Plan changed since this run" used to key on `plan_content_hash`
 * alone, and ADR-0015's content hash covers stages + metadata but NOT
 * factor-table cells — so a cells-only edit changed every scored
 * premium while every staleness line stayed silent. Runs now pin the
 * client scoring fingerprint (`computeScoringFingerprint`: stages +
 * dimensions + factor-table cells + policy tail) captured when the run
 * was requested; this comparator prefers the fingerprint pair and
 * falls back to the content-hash grammar for runs that predate the
 * pin (or were created by API consumers that don't send one).
 *
 * The fingerprint compare is strictly more truthful in both
 * directions: a cells edit flips it (content_hash can't see cells),
 * and a rename-only edit does NOT flip it (display_name is in the
 * content hash but changes no premium).
 */
export function isRunStale(
  run: {
    readonly plan_content_hash: string | null;
    readonly scoring_fingerprint?: string | null | undefined;
  },
  current: {
    /** The draft's `content_hash`, when loaded. */
    readonly contentHash: string | null;
    /**
     * The live substrate's scoring fingerprint — pass null while the
     * dims / factor-table queries are still hydrating, so a
     * half-hydrated substrate never flashes a false stale line.
     */
    readonly scoringFingerprint: string | null;
  },
): boolean {
  if (
    run.scoring_fingerprint != null &&
    current.scoringFingerprint !== null
  ) {
    return run.scoring_fingerprint !== current.scoringFingerprint;
  }
  return (
    run.plan_content_hash !== null &&
    current.contentHash !== null &&
    run.plan_content_hash !== current.contentHash
  );
}
