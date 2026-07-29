/**
 * /rate-lab/new — Create a plan.
 *
 * Brief 91 ("two questions, not six") — one centered card:
 *   - Plan name (autofocused) + Product are the only required
 *     questions. Product is the platform <Combobox>; the option hints
 *     carry PRODUCT_DESCRIPTIONS, so the field needs no helper line.
 *   - State is optional. "All states" (multistate) is the default AND
 *     an explicit first option, so clearing a picked state is one
 *     click. Its helper states the one real consequence: the publish
 *     slot (one ACTIVE plan per product + state, migration 039).
 *   - Effective date is gone from the surface. The rating path never
 *     reads it (quotes/runs take `as_of` from the request), so the
 *     backend defaults it to the creation date.
 *   - The note (description) hides behind "+ Add a note".
 *   - "Start from an existing plan" swaps the card to a copy picker;
 *     POST /plans/{id}/duplicate carries the whole substrate in one
 *     transaction (v4 G22), so the copy is a fresh independent draft.
 *   - "Build from a workbook" (Brief 92) swaps the card to the
 *     deterministic ingestion flow: drop the transcription workbook →
 *     the check (nothing created until it's clean) → the dry-run
 *     manifest → build → the build report → open the plan.
 *
 * Kept from the old form:
 *   - Server errors render as a top-of-form banner in place (Brief 58;
 *     useCreatePlan opts out of the global surface, and the copy path
 *     reports into the same banner slot)
 *   - Product starts UNSELECTED (F04 — picking is deliberate)
 *   - Create lands on workspace/inputs (V2 §2.3 — momentum; the Brief
 *     89 genesis doors live there). A copy lands on the twin itself.
 */

import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, FileSpreadsheet, Plus } from "lucide-react";
import {
  Button,
  Combobox,
  Input,
  Label,
  SearchField,
  type ComboboxOption,
} from "@openrater/design-system";
import {
  buildWorkbookPlan,
  checkWorkbook,
  duplicatePlan,
  ingestAssetUrl,
  reingestApply,
  reingestCheck,
  type CreatePlanRequest,
  type PlanSummary,
} from "@openrater/api-client";
import { useCreatePlan, usePlansList, describeApiError } from "@openrater/hooks";
import {
  PRODUCT_CODES,
  PRODUCT_DESCRIPTIONS,
  PRODUCT_LABELS,
  isProductCode,
} from "@openrater/contracts";
import {
  STATE_SEED,
  STATE_LABEL_BY_CODE,
  WorkbookBuildPanel,
} from "@openrater/ui";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { matchesPlanQuery } from "./PlansListRoute";
import "./PlanNewRoute.css";

/** The multistate default. An explicit option (not just a placeholder)
 *  so switching back from a picked state is a normal selection. */
export const ALL_STATES_VALUE = "";

export function buildProductOptions(): ComboboxOption[] {
  return PRODUCT_CODES.map((pc) => ({
    value: pc,
    label: PRODUCT_LABELS[pc],
    hint: PRODUCT_DESCRIPTIONS[pc],
  }));
}

export function buildStateOptions(): ComboboxOption[] {
  return [
    {
      value: ALL_STATES_VALUE,
      label: "All states",
      hint: "The plan isn't scoped to one state.",
    },
    ...STATE_SEED.map((s) => ({ value: s.id, label: s.label, hint: s.id })),
  ];
}

/**
 * Prefix filter for the State picker. The Combobox default is substring
 * on label/value/hint, which makes "kan" highlight ARkansas (alphabetical)
 * over Kansas — Enter then silently commits the wrong state (walk-caught,
 * same class as Brief 89's "fr"→Frame trap). Prefix on the name or the
 * USPS code is what state typing means.
 */
export function stateOptionFilter(
  option: ComboboxOption,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (
    option.label.toLowerCase().startsWith(q) ||
    option.value.toLowerCase().startsWith(q)
  );
}

/**
 * The POST body. No `effective_date` — the backend defaults it to the
 * creation date (Brief 91 §2; the rating path never reads it). Template
 * is hard-wired "blank" until /plan-templates serves a real recipe.
 */
export function buildCreatePlanBody(input: {
  name: string;
  product: string;
  stateCode: string;
  note: string;
}): CreatePlanRequest {
  const note = input.note.trim();
  return {
    display_name: input.name.trim(),
    product: input.product,
    jurisdiction: input.stateCode === ALL_STATES_VALUE ? null : input.stateCode,
    template: "blank",
    description: note.length > 0 ? note : null,
  };
}

/** The muted meta line under a copy-picker row. */
export function planCopyMeta(plan: PlanSummary): string {
  const product =
    plan.product && isProductCode(plan.product)
      ? PRODUCT_LABELS[plan.product]
      : (plan.product ?? plan.line_of_business);
  const state = plan.jurisdiction
    ? (STATE_LABEL_BY_CODE[plan.jurisdiction] ?? plan.jurisdiction)
    : "All states";
  return `${product} · ${state} · ${plan.status}`;
}

type FieldErrors = { name?: string; product?: string };

export function PlanNewRoute() {
  useDocumentTitle("New plan", "Rate Lab");
  const navigate = useNavigate();
  const createMutation = useCreatePlan();

  // Brief 94 (U2) — the workbook door is deep-linkable
  // (`/rate-lab/new?mode=workbook`); in-page swaps keep the URL in
  // sync so the mode survives refresh and can be shared.
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setModeState] = useState<"blank" | "copy" | "workbook">(
    searchParams.get("mode") === "workbook" ? "workbook" : "blank",
  );
  const setMode = (next: "blank" | "copy" | "workbook") => {
    setModeState(next);
    setSearchParams(next === "workbook" ? { mode: "workbook" } : {}, {
      replace: true,
    });
  };
  const [name, setName] = useState("");
  const [product, setProduct] = useState("");
  const [stateCode, setStateCode] = useState(ALL_STATES_VALUE);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Copy door state. Busy is route-local, not a react-query mutation —
  // the StrictMode remount can strand RQ mutation observers (the
  // Assemble-drawer freeze); PlanDetailRoute's duplicate uses the same
  // raw-await pattern.
  const [copyQuery, setCopyQuery] = useState("");
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const plansQuery = usePlansList({ status: "all" });

  const productOptions = useMemo(buildProductOptions, []);
  const stateOptions = useMemo(buildStateOptions, []);

  const clearFieldError = (key: keyof FieldErrors) => {
    setFieldErrors((prev) => {
      if (prev[key] === undefined) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    if (name.trim().length === 0) nextErrors.name = "Enter a plan name.";
    if (product.length === 0) nextErrors.product = "Pick a product.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      const result = await createMutation.mutateAsync(
        buildCreatePlanBody({ name, product, stateCode, note }),
      );
      // V2_INTERFACE_SPEC §2.3 — land in Inputs with momentum: a brand-
      // new plan's first decision is the genesis two-doors (Brief 89).
      navigate(`/rate-lab/${result.rating_plan_id}/workspace/inputs`);
    } catch {
      // Error is on createMutation.error — the banner below shows it.
    }
  };

  const handleCopy = async (planId: string) => {
    if (copyingId !== null) return;
    setCopyingId(planId);
    setCopyError(null);
    try {
      const copy = await duplicatePlan(planId);
      navigate(`/rate-lab/${copy.new_plan_id}`);
    } catch (err) {
      setCopyError(
        err instanceof Error
          ? describeApiError(err, "copy the plan").message
          : "Couldn't copy the plan.",
      );
      setCopyingId(null);
    }
  };

  const isCopy = mode === "copy";
  const isWorkbook = mode === "workbook";
  const createError = createMutation.error
    ? describeApiError(createMutation.error, "create the plan").message
    : null;
  const bannerError = isCopy ? copyError : isWorkbook ? null : createError;

  const allPlans = plansQuery.data ?? [];
  const copyRows = allPlans.filter((p) => matchesPlanQuery(p, copyQuery));

  return (
    <div className="plan-new-page">
      {/* key={mode} remounts the card on scene swap so the entrance
          motion + autoFocus re-fire; all values are controlled state
          on this component, so nothing typed is lost on a round trip. */}
      <section
        key={mode}
        className={
          "plan-new-page__card" +
          (isWorkbook ? " plan-new-page__card--wide" : "")
        }
        aria-label={
          isWorkbook
            ? "Build from a workbook"
            : isCopy
              ? "Copy a plan"
              : "Create plan"
        }
      >
        <header className="plan-new-page__header">
          <h1 className="plan-new-page__title">
            {isWorkbook
              ? "Build from a workbook"
              : isCopy
                ? "Copy a plan"
                : "Create plan"}
          </h1>
          <p className="plan-new-page__subtitle">
            {isWorkbook
              ? "A transcribed rating workbook — the tables, chains, and test cases of a filed program, in the platform format."
              : isCopy
                ? "The copy is a fresh, independent draft — dimensions, tables, chains, and mappings all come along."
                : "Name it and pick what it rates — everything else is built inside the plan."}
          </p>
        </header>

        {bannerError ? (
          <div className="plan-new-page__error" role="alert">
            <strong>
              {isCopy ? "Couldn't copy plan." : "Couldn't create plan."}
            </strong>
            <span>{bannerError}</span>
          </div>
        ) : null}

        {isWorkbook ? (
          <WorkbookBuildPanel
            checkWorkbook={checkWorkbook}
            buildWorkbook={buildWorkbookPlan}
            onStartBlank={() => setMode("blank")}
            onCancel={() => navigate("/rate-lab")}
            onOpenPlan={(planId) => navigate(`/rate-lab/${planId}`)}
            assetUrls={{
              spec: ingestAssetUrl("spec"),
              template: ingestAssetUrl("template"),
              example: ingestAssetUrl("example"),
            }}
            reingestCheck={reingestCheck}
            reingestApply={reingestApply}
          />
        ) : isCopy ? (
          <div className="plan-new-page__copy">
            <SearchField
              className="plan-new-page__copy-search"
              value={copyQuery}
              onChange={setCopyQuery}
              aria-label="Search plans"
              placeholder="Search plans…"
              autoFocus
            />
            {plansQuery.isPending ? (
              <p className="plan-new-page__copy-empty">Loading plans…</p>
            ) : allPlans.length === 0 ? (
              <p className="plan-new-page__copy-empty">
                No plans to copy yet — start blank instead.
              </p>
            ) : copyRows.length === 0 ? (
              <p className="plan-new-page__copy-empty">
                No plans match “{copyQuery.trim()}”.
              </p>
            ) : (
              <ul className="plan-new-page__copy-list">
                {copyRows.map((p) => (
                  <li key={p.rating_plan_id}>
                    <button
                      type="button"
                      className="plan-new-page__copy-row"
                      disabled={copyingId !== null}
                      aria-busy={copyingId === p.rating_plan_id}
                      onClick={() => void handleCopy(p.rating_plan_id)}
                    >
                      <span className="plan-new-page__copy-row-name">
                        {p.display_name}
                      </span>
                      <span className="plan-new-page__copy-row-meta">
                        {copyingId === p.rating_plan_id
                          ? "Copying…"
                          : planCopyMeta(p)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="plan-new-page__foot">
              <Button
                variant="plain"
                className="plan-new-page__flush-left"
                icon={<ArrowLeft />}
                onClick={() => setMode("blank")}
              >
                Start blank instead
              </Button>
              <div className="plan-new-page__actions">
                <Button variant="ghost" onClick={() => navigate("/rate-lab")}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Brief 92's door, promoted (owner, 2026-07-15): automatic
                ingestion is a flagship capability, so it reads as a
                first-class door card — the PlanGenesis whole-card idiom —
                not a footer text link. */}
            <button
              type="button"
              className="plan-new-page__ingest"
              onClick={() => setMode("workbook")}
              data-testid="plan-new-workbook-door"
            >
              <span className="plan-new-page__ingest-ico" aria-hidden>
                <FileSpreadsheet />
              </span>
              <span className="plan-new-page__ingest-body">
                <span className="plan-new-page__ingest-name">
                  Build from a workbook
                </span>
                <span className="plan-new-page__ingest-what">
                  Drop a transcribed filing — the plan builds itself, verified
                  against the workbook's test cases.
                </span>
              </span>
              <ChevronRight className="plan-new-page__ingest-go" aria-hidden />
            </button>

            <div className="plan-new-page__or" role="presentation">
              <span>or start blank</span>
            </div>

            <form
              className="plan-new-page__form"
              onSubmit={onSubmit}
              noValidate
            >
              <div className="plan-new-page__field">
                <Label
                  htmlFor="plan-name"
                  required
                  description="The name underwriters see in lists and quotes."
                >
                  Plan name
                </Label>
                <Input
                  id="plan-name"
                  autoFocus
                  placeholder="Q3 2026 commercial book — pilot"
                  hasError={Boolean(fieldErrors.name)}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clearFieldError("name");
                  }}
                />
                {fieldErrors.name ? (
                  <FieldError message={fieldErrors.name} />
                ) : null}
              </div>

              <div className="plan-new-page__field">
                <Label htmlFor="plan-product" required>
                  Product
                </Label>
                <Combobox
                  inputId="plan-product"
                  value={product}
                  onValueChange={(next) => {
                    setProduct(next);
                    clearFieldError("product");
                  }}
                  options={productOptions}
                  placeholder="Pick a product…"
                  hasError={Boolean(fieldErrors.product)}
                  ariaLabel="Product"
                />
                {fieldErrors.product ? (
                  <FieldError message={fieldErrors.product} />
                ) : null}
              </div>

              <div className="plan-new-page__field">
                <Label htmlFor="plan-state" optional>
                  State
                </Label>
                <Combobox
                  inputId="plan-state"
                  value={stateCode}
                  onValueChange={setStateCode}
                  options={stateOptions}
                  filter={stateOptionFilter}
                  ariaLabel="State"
                />
                <p className="plan-new-page__field-hint">
                  Where the plan applies. One plan per product and state can be
                  live at once.
                </p>
              </div>

              {noteOpen ? (
                <div className="plan-new-page__field">
                  <Label htmlFor="plan-note" optional>
                    Note
                  </Label>
                  <Input
                    id="plan-note"
                    autoFocus
                    placeholder="Pilot plan for Q3 2026 commercial property renewal book."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <p className="plan-new-page__field-hint">
                    Internal note about the plan's purpose.
                  </p>
                </div>
              ) : (
                <div>
                  <Button
                    variant="plain"
                    className="plan-new-page__flush-left"
                    icon={<Plus />}
                    onClick={() => setNoteOpen(true)}
                  >
                    Add a note
                  </Button>
                </div>
              )}

              <div className="plan-new-page__foot">
                <Button
                  variant="plain"
                  className="plan-new-page__flush-left"
                  onClick={() => setMode("copy")}
                >
                  Start from an existing plan
                </Button>
                <div className="plan-new-page__actions">
                  <Button variant="ghost" onClick={() => navigate("/rate-lab")}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={createMutation.isPending}
                  >
                    Create plan
                  </Button>
                </div>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <div className="plan-new-page__field-error">{message}</div>;
}
