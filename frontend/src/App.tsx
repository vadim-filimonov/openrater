/**
 * OpenRater — App shell.
 *
 * Top-level chrome: brand + nav + theme toggle. Routes mount via
 * react-router-dom's <Routes> tree below the header.
 *
 * The top nav is grouped by the business (Brief 88 P1): the cores
 * Rate Lab · Exhibits, a hairline, then Integrations. API Lab left
 * the bar (P3) but kept its room — reached from Rate Lab's "API Lab"
 * door, attention deep-links, and ⌘K. (MVP-031c — this comment now
 * describes the nav that ships, not the one that didn't.)
 */

import { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { HomeRoute } from "./routes/HomeRoute";
import { PlansListRoute } from "./routes/PlansListRoute";
import { PlanNewRoute } from "./routes/PlanNewRoute";
import { PlanDetailRoute } from "./routes/PlanDetailRoute";
// Brief: portfolio-redesign v2 — Exhibits, the one adaptive exhibit.
// The Portfolio book of record (Book/Map/Trends/Compose) was deleted
// with its substrate; /portfolio deep-links land on /exhibits.
import { ExhibitsRoute } from "./routes/ExhibitsRoute";
import { ClassificationRoute } from "./routes/ClassificationRoute";
// Brief 44 PR 44.12 — TerritoriesRoute removed. Geographic dims
// are authored inline in the Dimensions workspace; the legacy
// /territories route + TerritoryMapEditor surface no longer exist.
import { ApiLabRoute } from "./routes/ApiLabRoute";
// ADR-0057 / Brief 77 — the Integration Hub (L4: home + spine).
import { IntegrationsRoute } from "./routes/IntegrationsRoute";
import { IntegrationDetailRoute } from "./routes/IntegrationDetailRoute";
import { AppNavV2, type NavItemV2 } from "./components/AppNavV2/AppNavV2";
import { showApiLab } from "./integrations/apiLabFlag";
// V2_INTERFACE_SPEC §2.4 — the global ⌘K (the palette shipped in
// labs-ui unconsumed; this wires it).
import {
  CommandPalette,
  useCommandPaletteHotkey,
  type Command,
} from "@openrater/ui";
import { usePlansList } from "@openrater/hooks";
import { WORKSPACE_LABELS, WORKSPACE_ORDER } from "@openrater/contracts";
import "./App.css";

/**
 * Brief 34 PR 34.7 follow-up — Legacy /factor-tables/:tableId redirect.
 *
 * The Brief 18 standalone editor route is gone; factor tables load
 * INLINE. Since Brief 78 (P5.1) the inline home is the RATING
 * workspace (`workspace/assemble?table=`): the table opens in the
 * workspace inspector, expandable to the full-grid takeover.
 */
function FactorTableLegacyRedirect(): JSX.Element {
  const { id, tableId } = useParams<{ id: string; tableId: string }>();
  if (!id || !tableId) return <Navigate to="/rate-lab" replace />;
  return (
    <Navigate
      to={`/rate-lab/${id}/workspace/assemble?table=${tableId}`}
      replace
    />
  );
}

/**
 * Brief 78 (v4 P5.1, D-A) — Legacy workspace/parametrize redirect.
 *
 * The Factor Tables tab merged into the Rating workspace (internal id
 * `assemble`); `parametrize` left the PlanBuilderWorkspace union. Any
 * bookmark or stale in-app link lands here and forwards to the merged
 * surface WITH its query string — `?table=<id>` deep links keep
 * opening the same table (now in the inspector).
 */
function ParametrizeLegacyRedirect(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { search } = useLocation();
  if (!id) return <Navigate to="/rate-lab" replace />;
  return (
    <Navigate to={`/rate-lab/${id}/workspace/assemble${search}`} replace />
  );
}

type Theme = "dark" | "light";

// Brief 88 §3.4 — the theme finally remembers (F9b). Dark stays the default.
const THEME_KEY = "rater:theme";

// Brief 88 P1 — the bar is the org chart of the business: two cores,
// then the supporting rooms. One fixed order, reused verbatim by the
// ⌘K "Go to" group (and, from 88.2, the Home doors) so there is ONE
// map of the building (F8).
const V2_NAV_CORE: NavItemV2[] = [
  { label: "Rate Lab", to: "/rate-lab" },
  // Brief: portfolio-redesign v2 §2 — Exhibits, the plans presented.
  { label: "Exhibits", to: "/exhibits" },
];
const V2_NAV_SUPPORTING: NavItemV2[] = [
  // Detachment Brief 1 S2 — Model Lab + Data Lab are not part of this
  // platform; the supporting group carries Integrations only. TODO(S2):
  // proper two-core layout pass.
  // Brief 77 §9 Q1 (owner-locked) — Integrations stays a top-level tab:
  // a daily-glance surface once live (the pulse), not a setting.
  { label: "Integrations", to: "/integrations" },
];
// Brief 88 P3 — API Lab left the bar (a plan-scoped wiring tool holding
// a room slot) but kept its room: /api-lab is unchanged, reached from
// Rate Lab's "API Lab" door, every add-key attention row, and ⌘K.

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      if (localStorage.getItem(THEME_KEY) === "light") return "light";
    } catch {
      /* localStorage may be unavailable */
    }
    return "dark";
  });
  const location = useLocation();
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // ── V2_INTERFACE_SPEC §2.4 — the global command palette (⌘K) ──────
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteHotkey({ onOpen: () => setPaletteOpen(true) });
  // Inside a plan? Offer its sections as jump targets.
  const planMatch = location.pathname.match(/^\/rate-lab\/([^/]+)/);
  const planId =
    planMatch && planMatch[1] !== "new" ? planMatch[1] : null;
  const plansQuery = usePlansList({ status: "all" });
  const commands: Command[] = [
    // Brief 74 PR 74.1/74.2 — the cross-Lab Navigate group makes Home (and
    // every Lab) reachable from anywhere, so the "no fifth nav tab" trade is
    // safe and ⌘K is the platform spine.
    {
      id: "nav-home",
      label: "Home",
      group: "Go to",
      onSelect: () => navigate("/"),
    },
    ...[...V2_NAV_CORE, ...V2_NAV_SUPPORTING].map((item) => ({
      id: `nav-lab-${item.to}`,
      label: item.label,
      group: "Go to",
      onSelect: () => navigate(item.to),
    })),
    // MVP-027 (owner O2) — the API Lab ships flag-off for the cold
    // test: the ⌘K destination renders only when the flag is on. The
    // room's code + /api-lab URL stay; the door leaves the first-run
    // story. (MVP-006 — one name; "Connectors" stays inside the room.)
    ...(showApiLab()
      ? [
          {
            id: "nav-lab-/api-lab",
            label: "API Lab",
            group: "Go to",
            onSelect: () => navigate("/api-lab"),
          },
        ]
      : []),
    ...(planId
      ? [
          {
            id: "nav-overview",
            label: "Overview",
            group: "This plan",
            onSelect: () => navigate(`/rate-lab/${planId}`),
          },
          ...WORKSPACE_ORDER.map((ws) => ({
            id: `nav-${ws}`,
            label: WORKSPACE_LABELS[ws],
            group: "This plan",
            onSelect: () => navigate(`/rate-lab/${planId}/workspace/${ws}`),
          })),
        ]
      : []),
    ...(plansQuery.data ?? []).slice(0, 12).map((p) => ({
      id: `plan-${p.rating_plan_id}`,
      label: p.display_name,
      hint: [p.jurisdiction, p.status].filter(Boolean).join(" · "),
      group: "Plans",
      onSelect: () => navigate(`/rate-lab/${p.rating_plan_id}`),
    })),
    {
      id: "new-plan",
      label: "New plan",
      group: "Actions",
      onSelect: () => navigate("/rate-lab/new"),
    },
    {
      id: "new-plan-workbook",
      label: "Build from a workbook",
      group: "Actions",
      onSelect: () => navigate("/rate-lab/new?mode=workbook"),
    },
    {
      id: "toggle-theme",
      label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
      group: "Actions",
      onSelect: toggleTheme,
    },
  ];

  return (
    <div className="app">
      {/* V2_INTERFACE_SPEC §2.5 — ONE shell. The v1 header + the sticky
          ?v2 flag were deleted (v2 had been the default since
          2026-06-09); implementation preserved in git history. */}
      <AppNavV2
        coreItems={V2_NAV_CORE}
        supportingItems={V2_NAV_SUPPORTING}
        activePath={location.pathname}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSearchClick={() => setPaletteOpen(true)}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        placeholder="Jump to a plan or section…"
      />

      <main className="app__body">
        <Routes>
          {/* Brief 74 — OpenRater Home: the platform control plane. Replaces
              the bare "/" → /rate-lab redirect (the brand mark now lands
              here; AppNavV2 retargeted). */}
          <Route path="/" element={<HomeRoute />} />
          <Route path="/rate-lab" element={<PlansListRoute />} />
          <Route path="/rate-lab/new" element={<PlanNewRoute />} />
          {/* Brief: portfolio-redesign v2 — the one adaptive exhibit.
              Every legacy /portfolio deep-link (book/map/trends/compose)
              redirects here; the surfaces are gone, the bookmark isn't. */}
          <Route path="/exhibits" element={<ExhibitsRoute />} />
          <Route path="/portfolio" element={<Navigate to="/exhibits" replace />} />
          <Route
            path="/portfolio/*"
            element={<Navigate to="/exhibits" replace />}
          />
          {/* 24.F2 — workspace tab in URL. Without the segment, the
              route defaults to DEFAULT_WORKSPACE (inputs). The
              `workspace` slug is one of inputs / dimensions / gate /
              assemble / verify / analytics / ship. */}
          <Route path="/rate-lab/:id" element={<PlanDetailRoute />} />
          {/* Brief 78 (P5.1, D-A) — the Factor Tables tab merged into
              Rating (`assemble`). The static segment outranks the
              :workspace param, so legacy links land here first. */}
          <Route
            path="/rate-lab/:id/workspace/parametrize"
            element={<ParametrizeLegacyRedirect />}
          />
          <Route
            path="/rate-lab/:id/workspace/:workspace"
            element={<PlanDetailRoute />}
          />
          <Route
            path="/rate-lab/:id/classification"
            element={<ClassificationRoute />}
          />
          {/* Brief 34 PR 34.7 follow-up — Legacy editor route gone.
              Redirect any deep-link / bookmark to the inline-edit
              URL on the Parametrize canvas. */}
          <Route
            path="/rate-lab/:id/factor-tables/:tableId"
            element={<FactorTableLegacyRedirect />}
          />
          {/* Brief 34 PR 34.7 — /rate-lab/:id/curves/:curveId route
              removed. Curves are now 1-D banded factor tables
              rendered via FactorTableViz inline on the canvas.

              Brief 44 PR 44.12 — /rate-lab/:id/territories route removed.
              Geographic dims are authored inline in the Dimensions
              workspace via <GeoDimWizard> + <GeoDimEditor>. */}
          <Route path="/api-lab" element={<ApiLabRoute />} />
          {/* ADR-0057 / Brief 77 — Integrations (né Integration Hub). */}
          <Route path="/integrations" element={<IntegrationsRoute />} />
          <Route path="/integrations/:id" element={<IntegrationDetailRoute />} />
          {/* V2_INTERFACE_SPEC §2.5 — the /reference/tower §2B parity
              fixtures were removed from the shipped router (dev-only
              artifacts; preserved in git history). */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

