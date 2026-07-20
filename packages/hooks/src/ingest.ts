/**
 * Workbook-ingestion hooks — Brief 92.
 *
 * One read hook: the plan's persisted build report, or null when the
 * plan wasn't built from a workbook (the 404 is a normal answer here,
 * not an error — most plans are hand-authored).
 */

import { useQuery } from "@tanstack/react-query";
import {
  getBuildReport,
  RaterApiError,
  listBuildReports,
  type BuildReport,
} from "@openrater/api-client";

export const buildReportQueryKeys = {
  all: ["build-report"] as const,
  byPlan: (planId: string) => [...buildReportQueryKeys.all, planId] as const,
};

export function useBuildReport(planId: string) {
  return useQuery<BuildReport | null, Error>({
    queryKey: buildReportQueryKeys.byPlan(planId),
    queryFn: async () => {
      try {
        return await getBuildReport(planId);
      } catch (err) {
        if (err instanceof RaterApiError && err.status === 404) {
          return null; // hand-authored plan — no report, no error.
        }
        throw err;
      }
    },
  });
}

export const buildReportsQueryKeys = {
  all: ["build-reports"] as const,
  byPlan: (planId: string) => [...buildReportsQueryKeys.all, planId] as const,
};

/** Brief 92.R — the plan's full build history (newest first; empty for
 *  hand-authored plans — the endpoint has collection semantics). */
export function useBuildReports(planId: string) {
  return useQuery<BuildReport[], Error>({
    queryKey: buildReportsQueryKeys.byPlan(planId),
    queryFn: () => listBuildReports(planId),
  });
}
