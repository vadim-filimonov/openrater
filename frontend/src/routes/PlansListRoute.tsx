/**
 * /rate-lab — Plan Author landing.
 *
 * Lists rating plans from api-lab. Filters by status (default: "all"
 * so newly-created drafts are visible immediately — operators almost
 * always want to see what they just made). Empty state nudges toward
 * Create. Real data comes through @openrater/hooks/usePlansList →
 * TanStack Query → @openrater/api-client/listPlans → slice-2 backend.
 *
 * Surfaces handled:
 *   - loading (skeleton-style)
 *   - error (banner with the api error message; suggests api-lab not running)
 *   - empty (only-state with primary CTA)
 *   - populated (card-per-plan grid)
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MoreHorizontal, Plus, PlugZap } from "lucide-react";
import {
  Button,
  IconButton,
  Menu,
  Switch,
} from "@openrater/design-system";
import { useDeletePlan, useDiscardPlan, usePlansList } from "@openrater/hooks";
import type { PlanSummary } from "@openrater/api-client";
// Brief 84 — THE one derived headline status (Draft / Live · vN / Archived);
// the list renders the SAME chip the plan header shows, from the SAME
// derivation, so the two can never disagree again (F3).
import { derivePlanStatus } from "@openrater/contracts";
import {
  PlanDeleteDialog,
  PlanStatusChip,
  SurfaceHeader,
  fixAcronymCase,
  referencePlanNote,
  type PlanDeleteMode,
} from "@openrater/ui";
import { purgePlanLocalStorage } from "../integrations/planLocalStorage";
import { showApiLab } from "../integrations/apiLabFlag";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import "./PlansListRoute.css";

// I1 — Multi-LOB plans (e.g., D&O + GL) currently look identical to
// single-LOB CGL plans on the card grid. Surface the additional lines
// so a user filtering for D&O can spot it at a glance.
//
// Data source: `plan.coverages` (API D6.4+ — `/plans/from-template`
// stamps this from the template recipe). The legacy `plan-lines:v1`
// localStorage shim was removed in ADR-0033 gate 4 (multi-LOB-in-one-
// plan is retired; cross-product totals live on a Policy per ADR-0034).
//
// Returns the ADDITIONAL coverage tags only (the primary product is
// already shown in the main LOB row), deduped, with the primary stripped.
// Coverage tags are OPAQUE strings (ADR-0033 §0 — re-keyed off the closed
// LineCode vocabulary); we display them verbatim (titleized), never branch.
// V9 — client-side search across the visible fields, so a returning
// actuary can find a plan among many by name / jurisdiction / product / id.
export function matchesPlanQuery(plan: PlanSummary, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle === "") return true;
  const hay = [
    plan.display_name,
    plan.jurisdiction,
    plan.product,
    plan.line_of_business,
    plan.rating_plan_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

function readAdditionalCoverages(plan: PlanSummary): readonly string[] {
  const coverages = plan.coverages ?? [];
  if (coverages.length === 0) return [];
  // Strip any tag matching the plan's primary axis (shown in the main
  // row) so it isn't repeated — best-effort across both the real
  // `product` axis + the legacy `line_of_business` shim. Dedupe.
  const primaries = new Set(
    [plan.product, plan.line_of_business].filter(Boolean) as string[],
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of coverages) {
    if (!tag || primaries.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

// Titleize an opaque coverage tag for display: "premises_liability" →
// "Premises Liability", "professional" → "Professional".  —
// acronym tags keep their casing ("bpp" → "BPP", never "Bpp").
function coverageLabel(tag: string): string {
  return fixAcronymCase(
    tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  );
}

/** Route-level dialog state. Single dialog instance regardless of N
 * cards in the grid — clicking a card's menu item populates this and
 * the dialog mounts. */
interface DeleteIntent {
  readonly mode: PlanDeleteMode;
  readonly plan: PlanSummary;
}

/**
 * Turn a discard/delete mutation error into a calm, human sentence for
 * the dialog's inline error row. Before this, a failed mutation had no
 * onError handler at all — so a backend hiccup looked like "I clicked
 * Discard and nothing happened." The most common local-dev failure is
 * "API Lab isn't running" (fetch rejects with a network error, surfaced
 * by the client as code "network_error"); name that explicitly so the
 * fix is obvious. Every other failure shows the server's own message.
 */
function describeDeleteError(err: unknown, mode: PlanDeleteMode): string {
  const verb = mode === "discard" ? "discard" : "delete";
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: unknown }).code
      : undefined;
  const message = err instanceof Error ? err.message : String(err);
  const looksNetwork =
    code === "network_error" ||
    /failed to fetch|load failed|networkerror|fetch/i.test(message);
  if (looksNetwork) {
    return `Couldn't reach the server to ${verb} this plan. Check that API Lab is running, then try again.`;
  }
  return `Couldn't ${verb} this plan: ${message}`;
}

export function PlansListRoute() {
  useDocumentTitle("Rate Lab");
  const { data, isLoading, isError, error, refetch } = usePlansList({
    status: "all",
  });

  // K1.5 — "Show archived" toggle. Defaults OFF so the typical
  // "what plans do I have" view stays uncluttered. The data fetch
  // pulls every status (status: "all") so the toggle is a pure
  // client-side filter — instant, no extra request.
  const [showArchived, setShowArchived] = useState(false);

  // Two-stage delete state. Only ONE dialog is mounted at a time;
  // the menu item on each card writes intent here, then the dialog
  // reads `plan + mode` to render.
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  // Inline error for the delete dialog. Set by a mutation's onError so
  // a failed discard/delete never fails silently; cleared whenever a
  // new intent opens, a retry starts, or the dialog closes.
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const discardMutation = useDiscardPlan();
  const deleteMutation = useDeletePlan();

  // Open/close go through these so the error state is always cleared in
  // lockstep with the intent — no stale error leaking into the next
  // dialog open.
  const openDeleteIntent = (plan: PlanSummary, mode: PlanDeleteMode) => {
    setDeleteError(null);
    setDeleteIntent({ plan, mode });
  };
  const closeDeleteIntent = () => {
    setDeleteError(null);
    setDeleteIntent(null);
  };

  const visiblePlans = (data ?? []).filter(
    (p) => showArchived || p.status !== "archived",
  );
  const archivedCount = (data ?? []).filter(
    (p) => p.status === "archived",
  ).length;

  const handleConfirm = () => {
    if (!deleteIntent) return;
    const { mode, plan } = deleteIntent;
    // Clear any prior error so a retry starts clean. On success we close
    // the dialog; on error we keep it open and surface the message —
    // either way the user gets feedback instead of "nothing happened."
    setDeleteError(null);
    if (mode === "discard") {
      discardMutation.mutate(
        { planId: plan.rating_plan_id },
        {
          onSuccess: closeDeleteIntent,
          onError: (err) => setDeleteError(describeDeleteError(err, mode)),
        },
      );
    } else {
      deleteMutation.mutate(
        { planId: plan.rating_plan_id },
        {
          onSuccess: () => {
            // Hard-delete is the only path that purges localStorage —
            // discard preserves the row server-side, so the cached
            // shadow stays meaningful for a future rollback.
            purgePlanLocalStorage(plan.rating_plan_id);
            closeDeleteIntent();
          },
          onError: (err) => setDeleteError(describeDeleteError(err, mode)),
        },
      );
    }
  };

  const pending =
    discardMutation.isPending || deleteMutation.isPending;

  return (
    <div className="plans-page">
      {/* Brief 88 §3.3 (88.3) — the standardized greeting: the title is
          the nav word ("Rate Lab", not "Rating plans" — orientation
          loop), the working cluster rides the actions slot (search ·
          archived toggle · Connections · the page's ONE primary). The
          empty state still owns the CTA when no plans exist. */}
      <SurfaceHeader
        title="Rate Lab"
        actions={
          data && data.length > 0 ? (
            <>
              {/* The list's own search
                  box is gone: ⌘K already searches plans by the same
                  fields, so the toolbar carried two ways to do one
                  thing. Removing it deletes a state + a component from
                  the header row; `matchesPlanQuery` lives on for ⌘K
                  and the new-plan duplicate check. */}
              {archivedCount > 0 && (
                <Switch
                  className="plans-page__toggle"
                  size="sm"
                  checked={showArchived}
                  onChange={setShowArchived}
                  data-testid="plans-list-show-archived-toggle"
                  label={<>Show archived ({archivedCount})</>}
                />
              )}
              {/* Brief 88 P3 — API Lab's door in the room that owns
                  plans. It is flag-off for the cold
                  test — the room's code stays; the door leaves the
                  first-run story. */}
              {showApiLab() ? (
                <Link to="/api-lab" className="plans-page__cta-link">
                  <Button variant="ghost" icon={<PlugZap size={14} />}>
                    API Lab
                  </Button>
                </Link>
              ) : null}
              <Link to="/rate-lab/new" className="plans-page__cta-link">
                <Button variant="primary" icon={<Plus size={14} />}>
                  New plan
                </Button>
              </Link>
            </>
          ) : undefined
        }
      />

      <div className="plans-page__body">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState message={error instanceof Error ? error.message : String(error)} onRetry={() => refetch()} />
        ) : !data || data.length === 0 ? (
          <EmptyState />
        ) : visiblePlans.length === 0 ? (
          <p className="plans-page__no-match" data-testid="plans-list-no-match">
            No plans match the current filter.
          </p>
        ) : (
          <PlanTable
            plans={visiblePlans}
            onRequestDelete={openDeleteIntent}
          />
        )}
      </div>

      <PlanDeleteDialog
        open={deleteIntent !== null}
        mode={deleteIntent?.mode ?? "discard"}
        plan={deleteIntent?.plan ?? null}
        // Brief 84 D-E — archiving a LIVE plan turns its API off; the
        // confirm names it (backend clears the published pointer in the
        // same transaction).
        isLive={
          deleteIntent
            ? derivePlanStatus(deleteIntent.plan).kind === "live"
            : false
        }
        // Names the version being turned off ("live (v3)") so the
        // consequence is concrete, not abstract.
        publishedVersionName={
          deleteIntent?.plan.published_version?.display_name ?? null
        }
        liveIntegrationCount={deleteIntent?.plan.live_integration_count ?? 0}
        pending={pending}
        error={deleteError}
        onCancel={() => {
          if (pending) return; // Don't close mid-flight; user clicks Cancel only when idle.
          closeDeleteIntent();
        }}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

// ---- Subcomponents ----

interface PlanTableProps {
  readonly plans: PlanSummary[];
  readonly onRequestDelete: (plan: PlanSummary, mode: PlanDeleteMode) => void;
}

/**
 * V2_INTERFACE_SPEC mockup M3 — the list is ONE table (40px rows,
 * eyebrow header, hover ⋯), replacing the card grid. State is a
 * neutral chip whose 6px dot carries the status color (governance:
 * chips stay neutral; status rides the dot).
 */
function PlanTable({ plans, onRequestDelete }: PlanTableProps) {
  const navigate = useNavigate();
  return (
    <div className="plans-table" data-testid="plans-table">
      <table className="plans-table__table">
        <thead>
          <tr>
            <th scope="col">Plan</th>
            <th scope="col">Status</th>
            <th scope="col">Jurisdiction</th>
            <th scope="col">Product</th>
            <th scope="col">Effective</th>
            <th scope="col" className="plans-table__th-right">
              Last edited
            </th>
            <th scope="col" aria-label="Row actions" />
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <PlanRow
              key={p.rating_plan_id}
              plan={p}
              onOpen={() => navigate(`/rate-lab/${p.rating_plan_id}`)}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "2h ago" / "3d ago" / a date once it's old news. */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return iso.slice(0, 10);
}

function PlanRow({
  plan,
  onOpen,
  onRequestDelete,
}: {
  readonly plan: PlanSummary;
  readonly onOpen: () => void;
  readonly onRequestDelete: (plan: PlanSummary, mode: PlanDeleteMode) => void;
}) {
  // I1 — additional coverage lines beyond the primary product.
  const additionalLines = readAdditionalCoverages(plan);
  // ADR-0033 — the Product column shows the PRODUCT code (the real
  // axis). `line_of_business` is the deprecated 5-value shim — six
  // products shim onto 'cgl', so a D&O plan used to read "CGL" here.
  // Fall back to the shim only for rows predating the backfill. Codes
  // are opaque tags: display verbatim (uppercased, underscores spaced
  // — "inland_marine" → "INLAND MARINE"), never branch.
  const primaryCode = plan.product ?? plan.line_of_business;
  const primaryValue = primaryCode.replace(/_/g, " ").toUpperCase();
  const lobValue =
    additionalLines.length > 0
      ? `${primaryValue} + ${additionalLines.map(coverageLabel).join(" + ")}`
      : primaryValue;

  // K1.5 — destructive actions by status (draft→discard, archived→delete).
  const canDiscard = plan.status === "draft";
  const canHardDelete = plan.status === "archived";
  const hasDestructiveAction = canDiscard || canHardDelete;

  return (
    <tr
      className="plans-table__row"
      data-testid={`plan-row-${plan.rating_plan_id}`}
    >
      <td>
        <Link
          to={`/rate-lab/${plan.rating_plan_id}`}
          className="plans-table__name"
        >
          {plan.display_name}
        </Link>
        {referencePlanNote(plan.rating_plan_id) ? (
          <span className="plans-table__ref-note">
            {referencePlanNote(plan.rating_plan_id)}
          </span>
        ) : null}
      </td>
      <td>
        {/* Brief 84 — the derived chip (span variant: rows hold links,
            no nested interactives). Same word as the plan header. */}
        <PlanStatusChip status={derivePlanStatus(plan)} />
      </td>
      <td className="plans-table__muted">
        {plan.jurisdiction ?? "multistate"}
      </td>
      <td className="plans-table__muted">{lobValue}</td>
      <td className="plans-table__muted plans-table__num">
        {plan.effective_date}
      </td>
      <td className="plans-table__muted plans-table__num plans-table__right">
        {relativeTime(plan.last_edited_at ?? plan.created_at)}
      </td>
      <td className="plans-table__actions">
        {hasDestructiveAction ? (
          <Menu>
            <Menu.Trigger>
              <IconButton
                variant="plain"
                size="xs"
                aria-label={`Actions for ${plan.display_name}`}
                icon={<MoreHorizontal />}
                data-testid={`plan-card-menu-${plan.rating_plan_id}`}
              />
            </Menu.Trigger>
            <Menu.Items aria-label="Plan actions">
              <Menu.Item onSelect={onOpen}>Open</Menu.Item>
              {canDiscard && (
                <Menu.Item
                  onSelect={() => onRequestDelete(plan, "discard")}
                  data-testid={`plan-card-discard-${plan.rating_plan_id}`}
                >
                  Discard draft…
                </Menu.Item>
              )}
              {canHardDelete && (
                <Menu.Item
                  danger
                  onSelect={() => onRequestDelete(plan, "delete")}
                  data-testid={`plan-card-delete-${plan.rating_plan_id}`}
                >
                  Delete permanently…
                </Menu.Item>
              )}
            </Menu.Items>
          </Menu>
        ) : null}
      </td>
    </tr>
  );
}

function LoadingState() {
  return (
    <div className="plans-state plans-state--loading" aria-live="polite">
      Loading plans…
    </div>
  );
}

function EmptyState() {
  return (
    <div className="plans-state plans-state--empty">
      <h2 className="plans-state__title">No plans yet</h2>
      <p className="plans-state__body">
        Author your first rating plan. Pick a line of business + a jurisdiction
        and Rate Lab will set up the sections for you to fill in.
      </p>
      <Link to="/rate-lab/new">
        <Button variant="primary" icon={<Plus size={14} />}>
          Create your first plan
        </Button>
      </Link>
      <p className="plans-state__workbook-line">
        Have a filing?{" "}
        <Link to="/rate-lab/new?mode=workbook">Build from a workbook.</Link>
      </p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="plans-state plans-state--error" role="alert">
      <h2 className="plans-state__title">Couldn't load plans</h2>
      <p className="plans-state__body">{message}</p>
      <p className="plans-state__hint">
        If the API isn't running locally, start it from the repo root:{" "}
        <code>pnpm dev:api-lab</code> (or run <code>pnpm dev</code> to boot
        both servers).
      </p>
      <Button variant="ghost" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
