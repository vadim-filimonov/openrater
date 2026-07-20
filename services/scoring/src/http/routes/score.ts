/**
 * POST /score — single-risk scoring.
 *
 * Body: a discriminated request on `source` (plan | plan_stages |
 * plan_id) + inputs + options + views. Returns { outputs, views
 * (premium/perCoverage/tier), as_of, durationMs, trace? }. Fast (ms).
 *
 * The handler is deliberately thin: parse → core. Validation errors
 * (400) and unsupported sources (501) surface as typed ServiceErrors
 * via the app-level error handler. `plan_id` resolution rides the
 * injected PlanSourceDeps (snapshot-pinned API Lab fetch, ADR-0049 A8).
 */

import type { FastifyInstance } from "fastify";

import type { PlanBundleDeps } from "../../core/planSource";
import { parseScorePolicyRequest, parseScoreRequest } from "../../core/schema";
import { scoreOne } from "../../core/score";
import { scorePolicy } from "../../core/scorePolicy";

export function registerScoreRoutes(deps: PlanBundleDeps = {}) {
  return async function scoreRoutes(app: FastifyInstance): Promise<void> {
    app.post("/score", async (request, reply) => {
      const scoreRequest = parseScoreRequest(request.body);
      const result = await scoreOne(scoreRequest, deps);
      void reply.send(result);
    });

    // Brief 76 P4.1b — synchronous multi-location policy composition (the
    // policy quote's engine seam). N locations → one rolled-up FILED
    // premium, via the SAME evaluatePolicyBook the book path runs.
    app.post("/score-policy", async (request, reply) => {
      const policyRequest = parseScorePolicyRequest(request.body);
      const result = await scorePolicy(policyRequest, deps);
      void reply.send(result);
    });
  };
}
