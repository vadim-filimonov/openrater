import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { RaterQueryProvider } from "@openrater/hooks";
import { ToastProvider, GlobalErrorSurface } from "@openrater/design-system";
import { registerBuiltinKinds } from "@openrater/contracts";
import { App } from "./App";
import "./index.css";

// ── Runtime: register built-in BlockKinds (PR 11a) ─────────────────
//
// `@openrater/contracts`'s `globalRegistry` starts empty. Until the kinds
// are registered, `executePlanBatch` rejects every plan with
// "Unknown block kind \"input\"" (or \"output\", \"chain.mult\", …)
// because `compilePlan` validates kinds against the registry.
//
// The runtime is consumed in two places today:
//   1. <ScoringPreviewPane> (Inputs workspace live scoring).
//   2. <TestRunner> ("Rate against sample") — also affected.
//
// Tests bootstrap the registry per-suite via `beforeAll`. The live
// app needs the same bootstrap at module-load time — that's this
// call. Idempotent: re-registering the same kind is a no-op.
registerBuiltinKinds();

// Detachment Brief 1 (Phase B) — client fixture mode retired with the
// bundled sample-plan cut (§3.2). The app always talks to the real
// backend; seeded demo content arrives server-side (S3, Phase D).

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    "Rate Lab failed to mount: #root not found in index.html. " +
      "Did the HTML template get edited?",
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RaterQueryProvider>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        {/* Brief 58 Pillar A — global save-failure surface. Reads the
            apiErrorBus that the QueryClient's MutationCache.onError
            pushes into, so no failed save is silent. */}
        <GlobalErrorSurface />
      </ToastProvider>
    </RaterQueryProvider>
  </React.StrictMode>,
);
