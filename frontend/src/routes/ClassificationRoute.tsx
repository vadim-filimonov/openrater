/**
 * /rate-lab/:id/classification — the writable per-plan class registry
 * (Brief 51). Replaces the read-only A5.5 browser.
 *
 * The actuary can now:
 *   · create / edit / delete classes
 *   · bulk-import a filing's class table (CSV paste / upload)
 *   · multi-select classes and "Add to plan" → registers the `class_code`
 *     classification dimension AND auto-creates the derived structural
 *     dimensions (prop_rate_number / liab_class_group / liab_exposure_base)
 *     so Parametrize factor tables can key off them (ADR-0035).
 *
 * Data path (real backend, no fixture):
 *   usePlanClassCodes / useUpsertClassCode / useDeleteClassCode /
 *   useBulkImportClassCodes  →  /api/v1/plans/:id/class-codes
 *   useUpsertDimension        →  /api/v1/plans/:id/dimensions
 */

import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@openrater/design-system";
import { ClassRegistry, type ClassDraft } from "@openrater/ui";
import type {
  ListDimensionsResponse,
  PlanDimension,
  UpsertClassCodeRequest,
  UpsertDimensionRequest,
} from "@openrater/api-client";
import {
  dimensionsQueryKeys,
  useBulkImportClassCodes,
  useDeleteClassCode,
  useDimensionsList,
  usePlanClassCodes,
  useUpsertClassCode,
  useUpsertDimension,
} from "@openrater/hooks";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import "./ClassificationRoute.css";

/** Human labels for the well-known BOP derived attributes. Unknown keys
 *  fall back to a title-cased slug. */
const ATTR_LABELS: Readonly<Record<string, string>> = {
  prop_rate_number: "Property rate number",
  liab_class_group: "Liability class group",
  liab_exposure_base: "Liability exposure base",
  liability_kind: "Liability kind",
  eq_grade: "Earthquake grade",
  eqsl_grade: "Earthquake sprinkler-leakage grade",
};

function labelForAttribute(key: string): string {
  return (
    ATTR_LABELS[key] ??
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Map the registry's editable draft to the write request. `exposure_bases`
 * isn't authored in this flow (Brief 16 owns class-conditional exposure),
 * so it's sent empty; the derived rating attributes ride in `attributes`.
 */
function draftToRequest(d: ClassDraft): UpsertClassCodeRequest {
  return {
    class_code: d.class_code.trim(),
    display_name: d.display_name,
    family: d.family,
    eligible_for: d.eligible_for,
    attributes: d.attributes,
    exposure_bases: [],
    source: d.source,
    ...(d.description ? { description: d.description } : {}),
    ...(d.naics_code ? { naics_code: d.naics_code } : {}),
    ...(d.sic_code ? { sic_code: d.sic_code } : {}),
    ...(d.note ? { note: d.note } : {}),
    ...(d.citation_rule ? { citation_rule: d.citation_rule } : {}),
    ...(d.citation_page ? { citation_page: d.citation_page } : {}),
  };
}

export function ClassificationRoute() {
  useDocumentTitle("Classification", "Rate Lab");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const planId = id ?? "";

  const classesQuery = usePlanClassCodes(planId || undefined);
  const dimsQuery = useDimensionsList(planId || undefined);

  const upsertClass = useUpsertClassCode(planId);
  const deleteClass = useDeleteClassCode(planId);
  const bulkImport = useBulkImportClassCodes(planId);
  const upsertDim = useUpsertDimension(planId);
  const queryClient = useQueryClient();

  const classes = classesQuery.data?.class_codes ?? [];
  const dims = dimsQuery.data?.dimensions ?? [];
  const classDimensionExists = dims.some(
    (d) => d.dimension_type === "classification",
  );
  // FCA #30 (finding 147) — the registry and the dimension are
  // separate stores; a workbook build populates the DIMENSION. When
  // it exists, the empty registry says so instead of "No classes yet"
  // (which read as data loss on a 30-class plan).
  const planClassDim = dims.find(
    (d) => d.dimension_type === "classification",
  );
  const planClassDimension = planClassDim
    ? {
        name: planClassDim.display_name || planClassDim.slug,
        levelCount: (planClassDim.levels ?? []).length,
      }
    : null;

  // ── add-to-plan: register the class_code dim + derived structural dims ──
  // The writes are additive PUTs (idempotent on dim_id). AFTER them we make
  // the SHARED dims-list cache authoritative before navigating — Brief 60:
  // each PUT's onSuccess invalidates that query, firing background refetches;
  // navigation to the Dimensions Workspace aborts the final (full-set) one,
  // leaving the cache at a stale mid-sequence snapshot that the workspace's
  // steady-state bulk replace-all then persists — dropping the last derived
  // dim (prop_rate_number) and nulling every derived_from. cancelQueries kills
  // those in-flight refetches; setQueryData seeds the verified full set.
  const handleAddToPlan = async (classCodes: string[]): Promise<void> => {
    const selected = classes.filter((c) => classCodes.includes(c.class_code));
    if (selected.length === 0) return;

    // Preserve any non-class dims the plan already has (e.g. territory / zip)
    // so the authoritative cache we seed below doesn't drop them.
    const preserved = dims.filter(
      (d) =>
        d.slug !== "class_code" && d.derived_from?.source_dim !== "class_code",
    );

    // 1. The class_code classification dimension. Each level snapshots the
    //    class's derived `attributes` so the projector can build the
    //    derive.class_attribute table without re-reading the registry
    //    (same snapshot contract as derive.territory's geo_territories).
    const classDim: UpsertDimensionRequest = {
      dim_id: "class_code",
      display_name: "Class code",
      slug: "class_code",
      data_type: "string",
      role: "rating-input",
      dimension_type: "classification",
      shape: "categorical",
      class_library_id: planId,
      levels: selected.map((c) => ({
        kind: "categorical",
        id: c.class_code,
        label: c.display_name,
        aliases: [c.naics_code, c.sic_code].filter(
          (v): v is string => Boolean(v),
        ),
        attributes: c.attributes ?? {},
      })),
    };
    const written: PlanDimension[] = [await upsertDim.mutateAsync(classDim)];

    // 2. One derived structural dimension per attribute key present across
    //    the selection (generic — BOP yields rate-number / class-group /
    //    exposure-base; another LOB yields whatever its classes carry).
    const attrKeys = new Set<string>();
    for (const c of selected) {
      for (const k of Object.keys(c.attributes ?? {})) attrKeys.add(k);
    }
    for (const attrKey of Array.from(attrKeys).sort()) {
      const values = new Set<string>();
      for (const c of selected) {
        const v = c.attributes?.[attrKey];
        if (v) values.add(v);
      }
      const derivedDim: UpsertDimensionRequest = {
        dim_id: attrKey,
        display_name: labelForAttribute(attrKey),
        slug: attrKey,
        data_type: "string",
        role: "structural",
        dimension_type: "standard",
        shape: "categorical",
        derived_from: { source_dim: "class_code", attribute: attrKey },
        levels: Array.from(values)
          .sort()
          .map((v) => ({ kind: "categorical", id: v, label: v, aliases: [] })),
      };
      written.push(await upsertDim.mutateAsync(derivedDim));
    }

    // Reconcile the shared dims-list cache to the authoritative full set
    // BEFORE navigating, so the Dimensions Workspace hydrates the complete
    // set (every derived dim, with derived_from) instead of a stale refetch
    // its bulk replace-all would otherwise persist. (Brief 60)
    const dimsKey = dimensionsQueryKeys.list(planId);
    await queryClient.cancelQueries({ queryKey: dimsKey });
    queryClient.setQueryData<ListDimensionsResponse>(dimsKey, {
      rating_plan_id: planId,
      dimensions: [...preserved, ...written],
    });

    // Land back on the Dimensions workspace so the new dims are visible.
    navigate(`/rate-lab/${planId}/workspace/dimensions`);
  };

  const handleUpsertClass = async (draft: ClassDraft): Promise<void> => {
    await upsertClass.mutateAsync(draftToRequest(draft));
  };
  const handleDeleteClass = async (classCode: string): Promise<void> => {
    await deleteClass.mutateAsync(classCode);
  };
  const handleBulkImport = async (
    rows: ClassDraft[],
    mode: "merge" | "replace",
  ): Promise<void> => {
    await bulkImport.mutateAsync({ classes: rows.map(draftToRequest), mode });
  };

  return (
    <div className="classification-route">
      <header className="classification-route__header">
        <Link
          to={`/rate-lab/${planId}/workspace/dimensions`}
          className="classification-route__back"
          aria-label="Back to plan"
        >
          <ArrowLeft size={14} aria-hidden />
          <span>Back to plan</span>
        </Link>
        <div className="classification-route__title-group">
          <h1 className="classification-route__title">Classification</h1>
          <p className="classification-route__subtitle">
            The plan&rsquo;s class registry. Import or author classes, then
            select them and add the <code>class_code</code> dimension &mdash; its
            derived rate-number / class-group / exposure-base axes come with it.
          </p>
        </div>
      </header>

      {classesQuery.isPending ? (
        <div className="classification-route__loading" role="status">
          <Loader2
            className="classification-route__loading-icon"
            aria-hidden
            size={20}
          />
          <span>Loading class registry…</span>
        </div>
      ) : classesQuery.error ? (
        <div className="classification-route__error" role="alert">
          <div className="classification-route__error-icon" aria-hidden>
            <AlertTriangle size={20} />
          </div>
          <div className="classification-route__error-body">
            <div className="classification-route__error-title">
              Couldn&rsquo;t load the class registry
            </div>
            <div className="classification-route__error-text">
              {classesQuery.error instanceof Error
                ? classesQuery.error.message
                : "Unknown error"}
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={() => classesQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <ClassRegistry
          classes={classes}
          onUpsertClass={handleUpsertClass}
          onDeleteClass={handleDeleteClass}
          onBulkImport={handleBulkImport}
          onAddToPlan={handleAddToPlan}
          classDimensionExists={classDimensionExists}
          planClassDimension={planClassDimension}
        />
      )}
    </div>
  );
}
