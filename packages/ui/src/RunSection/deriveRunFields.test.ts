/**
 * deriveRunFields / buildSampleRisk — FCA fca-2026-07-25 finding #10.
 *
 * The regression shape mirrors the audited Prairie State GL plan: nine
 * declared inputs, six consumed by chains (so six seeded by the
 * representative synthesis), three read ONLY by the eligibility gate.
 * The old form rendered exactly the seeded six — the gate-only three
 * (work_above_three_stories, years_in_business, annual_gross_receipts)
 * had no control, yet results claimed "policy gates applied"; since
 * the §12.4 refusal landed, such runs refuse naming a field the form
 * never offered.
 */

import { describe, it, expect } from "vitest";
import type { InputDictEntry } from "../InputDictionary/types";
import {
  buildSampleRisk,
  buildWireSampleInputs,
  declaredRowKeys,
  deriveRunFields,
  overlayVerifiedCase,
} from "./deriveRunFields";

/** Entry factory — dictionary defaults, overridable per test. */
function entry(partial: Partial<InputDictEntry> & { fieldName: string }): InputDictEntry {
  return {
    id: `in_${partial.fieldName}`,
    displayName: partial.fieldName,
    dataType: "string",
    source: "form",
    required: true,
    ...partial,
  };
}

/** The Prairie-State-shaped dictionary: 6 chain-consumed + 3 gate-only. */
const ENTRIES: readonly InputDictEntry[] = [
  entry({ fieldName: "class_code", dataType: "class_code" }),
  entry({ fieldName: "territory", displayName: "Territory" }),
  entry({ fieldName: "annual_payroll", dataType: "money" }),
  entry({ fieldName: "limit_occurrence", dataType: "money" }),
  entry({ fieldName: "deductible", dataType: "money" }),
  entry({ fieldName: "premium_basis", dataType: "string" }),
  // Gate-only: declared, required, no default — the chains never read
  // them, so the synthesis never seeds them.
  entry({
    fieldName: "work_above_three_stories",
    displayName: "Work above three stories",
    dataType: "bool",
  }),
  entry({ fieldName: "years_in_business", dataType: "int" }),
  entry({ fieldName: "annual_gross_receipts", dataType: "money" }),
];

/** What synthesizeRepresentativeRisk seeds: the chain-consumed six. */
const SEEDED: Record<string, unknown> = {
  class_code: "91560",
  territory: "T1",
  annual_payroll: 250_000,
  limit_occurrence: 1_000_000,
  deductible: 500,
  premium_basis: "payroll",
};

describe("deriveRunFields — FCA #10: every declared input renders", () => {
  it("renders the gate-only declared-required inputs, not just the seeded chain fields", () => {
    const fields = deriveRunFields({ entries: ENTRIES, seeded: SEEDED, overrides: {} });
    const keys = fields.map((f) => f.key);
    // All nine declared inputs present, in dictionary (workbook) order.
    expect(keys).toEqual([
      "class_code",
      "territory",
      "annual_payroll",
      "limit_occurrence",
      "deductible",
      "premium_basis",
      "work_above_three_stories",
      "years_in_business",
      "annual_gross_receipts",
    ]);
  });

  it("a declared bool renders the boolean control; others stay text", () => {
    const fields = deriveRunFields({ entries: ENTRIES, seeded: SEEDED, overrides: {} });
    const byKey = new Map(fields.map((f) => [f.key, f]));
    expect(byKey.get("work_above_three_stories")?.control).toBe("boolean");
    expect(byKey.get("years_in_business")?.control).toBeUndefined();
    expect(byKey.get("class_code")?.control).toBeUndefined();
  });

  it("gate-only fields start unset (no fabricated eligibility answer); seeded fields carry their seed", () => {
    const fields = deriveRunFields({ entries: ENTRIES, seeded: SEEDED, overrides: {} });
    const byKey = new Map(fields.map((f) => [f.key, f]));
    expect(byKey.get("work_above_three_stories")?.value).toBe("");
    expect(byKey.get("years_in_business")?.value).toBe("");
    expect(byKey.get("annual_payroll")?.value).toBe("250000");
  });

  it("a declared default seeds the field (and its reset placeholder)", () => {
    const entries = [
      ...ENTRIES.slice(0, 6),
      entry({ fieldName: "years_in_business", dataType: "int", defaultValue: "5" }),
    ];
    const fields = deriveRunFields({ entries, seeded: SEEDED, overrides: {} });
    const f = fields.find((x) => x.key === "years_in_business");
    expect(f?.value).toBe("5");
    expect(f?.placeholder).toBe("5");
  });

  it("derived entries never render — the graph computes them", () => {
    const entries = [
      ...ENTRIES,
      entry({ fieldName: "tiv", source: "derived", dataType: "money" }),
    ];
    const fields = deriveRunFields({ entries, seeded: SEEDED, overrides: {} });
    expect(fields.some((f) => f.key === "tiv")).toBe(false);
  });

  it("an UNDECLARED seeded chain field still renders (Brief 83.2 grace), after the dictionary", () => {
    const seeded = { ...SEEDED, sprinkler_credit: "sprinklered" };
    const fields = deriveRunFields({ entries: ENTRIES, seeded, overrides: {} });
    expect(fields[fields.length - 1]?.key).toBe("sprinkler_credit");
  });

  it("overrides win over seeds; labels prefer the map, then displayName, then humanized", () => {
    const labelByField = new Map([["territory", "Rating territory"]]);
    const fields = deriveRunFields({
      entries: ENTRIES,
      seeded: SEEDED,
      overrides: { territory: "T3" },
      labelByField,
    });
    const byKey = new Map(fields.map((f) => [f.key, f]));
    expect(byKey.get("territory")?.value).toBe("T3");
    expect(byKey.get("territory")?.label).toBe("Rating territory");
    expect(byKey.get("work_above_three_stories")?.label).toBe(
      "Work above three stories",
    );
    expect(byKey.get("years_in_business")?.label).toBe("Years in business");
  });
});

describe("buildSampleRisk — the payload half", () => {
  it("OMITS unset declared fields so the engine's refusal can name them", () => {
    const risk = buildSampleRisk({ entries: ENTRIES, seeded: SEEDED, overrides: {} });
    expect("work_above_three_stories" in risk).toBe(false);
    expect("years_in_business" in risk).toBe(false);
    expect(risk["class_code"]).toBe("91560");
  });

  it("a field edited to empty is omitted too — '' must not read as supplied", () => {
    const risk = buildSampleRisk({
      entries: ENTRIES,
      seeded: SEEDED,
      overrides: { premium_basis: "  " },
    });
    expect("premium_basis" in risk).toBe(false);
  });

  it("types declared values by the dictionary dtype (bool → boolean, money strips $ and commas)", () => {
    const risk = buildSampleRisk({
      entries: ENTRIES,
      seeded: SEEDED,
      overrides: {
        work_above_three_stories: "true",
        years_in_business: "12",
        annual_gross_receipts: "$1,250,000",
      },
    });
    expect(risk["work_above_three_stories"]).toBe(true);
    expect(risk["years_in_business"]).toBe(12);
    expect(risk["annual_gross_receipts"]).toBe(1_250_000);
  });

  it("'false' answers travel as boolean false, not the string", () => {
    const risk = buildSampleRisk({
      entries: ENTRIES,
      seeded: SEEDED,
      overrides: { work_above_three_stories: "false" },
    });
    expect(risk["work_above_three_stories"]).toBe(false);
  });

  it("typed seeds pass verbatim; a string override on a declared money field re-types", () => {
    const risk = buildSampleRisk({
      entries: ENTRIES,
      seeded: SEEDED,
      overrides: { annual_payroll: "300000" },
    });
    expect(risk["annual_payroll"]).toBe(300_000);
    expect(risk["limit_occurrence"]).toBe(1_000_000);
  });

  it("a declared default fills the payload when the user leaves the seed alone", () => {
    const entries = [
      ...ENTRIES.slice(0, 6),
      entry({ fieldName: "years_in_business", dataType: "int", defaultValue: "5" }),
    ];
    const risk = buildSampleRisk({ entries, seeded: SEEDED, overrides: {} });
    expect(risk["years_in_business"]).toBe(5);
  });

  it("undeclared seeded fields keep the legacy pass-through (numeric seed re-coerces its override)", () => {
    const seeded = { ...SEEDED, square_feet: 4_000 };
    const risk = buildSampleRisk({
      entries: ENTRIES,
      seeded,
      overrides: { square_feet: "5200" },
    });
    expect(risk["square_feet"]).toBe(5_200);
  });

  it("derived entries never enter the payload", () => {
    const entries = [
      ...ENTRIES,
      entry({
        fieldName: "tiv",
        source: "derived",
        dataType: "money",
        defaultValue: "9",
      }),
    ];
    const risk = buildSampleRisk({ entries, seeded: SEEDED, overrides: {} });
    expect("tiv" in risk).toBe(false);
  });
});

describe("overlayVerifiedCase — the shared Run/Ship seed rule", () => {
  const KEYS = declaredRowKeys(ENTRIES);

  it("verified case values beat synthesis; declared gate-only keys seed too", () => {
    const seeded = overlayVerifiedCase(
      SEEDED,
      { annual_payroll: 480_000, work_above_three_stories: false },
      KEYS,
    );
    expect(seeded["annual_payroll"]).toBe(480_000);
    // The verified eligibility answer reaches a key synthesis never
    // seeds — the whole point of measuring against the dictionary.
    expect(seeded["work_above_three_stories"]).toBe(false);
  });

  it("workbook-only keys stay out; null case values never erase a seed", () => {
    const seeded = overlayVerifiedCase(
      SEEDED,
      { expected_premium: 1898, territory: null },
      KEYS,
    );
    expect("expected_premium" in seeded).toBe(false);
    expect(seeded["territory"]).toBe("T1");
  });

  it("no case (hand-authored plan) → the representative, untouched", () => {
    expect(overlayVerifiedCase(SEEDED, null, KEYS)).toEqual(SEEDED);
  });
});

describe("buildWireSampleInputs — the Ship try-it's wire shape", () => {
  it("shows every declared required key: unanswerable gate-only fields carry null, and are named", () => {
    const { inputs, placeholders } = buildWireSampleInputs({
      entries: ENTRIES,
      seeded: SEEDED,
    });
    // The wire shape shows the keys the old sample omitted…
    expect(inputs["work_above_three_stories"]).toBeNull();
    expect(inputs["years_in_business"]).toBeNull();
    expect(inputs["annual_gross_receipts"]).toBeNull();
    // …without fabricating an eligibility answer, and names them.
    expect(placeholders).toEqual([
      "work_above_three_stories",
      "years_in_business",
      "annual_gross_receipts",
    ]);
  });

  it("the value-carrying part IS the Run form's untouched payload (Law 1)", () => {
    const { inputs, placeholders } = buildWireSampleInputs({
      entries: ENTRIES,
      seeded: SEEDED,
    });
    const valueCarrying = Object.fromEntries(
      Object.entries(inputs).filter(([k]) => !placeholders.includes(k)),
    );
    expect(valueCarrying).toEqual(
      buildSampleRisk({ entries: ENTRIES, seeded: SEEDED, overrides: {} }),
    );
  });

  it("a workbook default answers the field — typed, no placeholder", () => {
    const entries = [
      ...ENTRIES.slice(0, 7),
      entry({ fieldName: "years_in_business", dataType: "int", defaultValue: "5" }),
      ...ENTRIES.slice(8),
    ];
    const { inputs, placeholders } = buildWireSampleInputs({
      entries,
      seeded: SEEDED,
    });
    expect(inputs["years_in_business"]).toBe(5);
    expect(placeholders).toEqual([
      "work_above_three_stories",
      "annual_gross_receipts",
    ]);
  });

  it("a verified case value answers the field — the overlay feeds the wire", () => {
    const seeded = overlayVerifiedCase(
      SEEDED,
      { work_above_three_stories: false, years_in_business: 12 },
      declaredRowKeys(ENTRIES),
    );
    const { inputs, placeholders } = buildWireSampleInputs({
      entries: ENTRIES,
      seeded,
    });
    expect(inputs["work_above_three_stories"]).toBe(false);
    expect(inputs["years_in_business"]).toBe(12);
    expect(placeholders).toEqual(["annual_gross_receipts"]);
  });

  it("unset OPTIONAL fields stay omitted — null would imply a demand", () => {
    const entries = [
      ...ENTRIES,
      entry({ fieldName: "sprinkler_credit", required: false }),
    ];
    const { inputs, placeholders } = buildWireSampleInputs({
      entries,
      seeded: SEEDED,
    });
    expect("sprinkler_credit" in inputs).toBe(false);
    expect(placeholders).not.toContain("sprinkler_credit");
  });

  it("derived entries never appear — the graph computes them", () => {
    const entries = [
      ...ENTRIES,
      entry({ fieldName: "tiv", source: "derived", dataType: "money" }),
    ];
    const { inputs } = buildWireSampleInputs({ entries, seeded: SEEDED });
    expect("tiv" in inputs).toBe(false);
  });
});

// FCA fca-2026-07-25 #12 — the schedule-rating door. The engine
// consumed `schedule_app_{id}` on every row while no screen or form
// accepted the judgments; the Run form now renders one signed-percent
// field per category and assembles the engine's exact envelope.
describe("schedule-rating judgments (FCA #12)", () => {
  const SCHEDULES = [
    {
      scheduleId: "psm_schedule",
      displayName: "Schedule rating",
      totalCapPct: 25,
      categories: [
        { categoryId: "mgmt", name: "Management", rangePct: 10 },
        { categoryId: "premises", name: "Premises", rangePct: 5 },
      ],
    },
  ];

  it("each category renders a judgment field naming the filed range + cap", () => {
    const fields = deriveRunFields({
      entries: [],
      seeded: {},
      overrides: {},
      schedules: SCHEDULES,
    });
    const mgmt = fields.find(
      (f) => f.key === "schedule:psm_schedule:mgmt",
    );
    expect(mgmt).toBeDefined();
    expect(mgmt!.label).toBe("Schedule rating · Management (±10%)");
    expect(mgmt!.placeholder).toContain("cap ±25%");
    expect(mgmt!.value).toBe("");
  });

  it("judgments assemble into the engine's schedule_app envelope — zeros omitted", () => {
    const risk = buildSampleRisk({
      entries: [],
      seeded: {},
      overrides: {
        "schedule:psm_schedule:mgmt": "-5",
        "schedule:psm_schedule:premises": "0",
      },
      schedules: SCHEDULES,
    });
    expect(risk["schedule_app_psm_schedule"]).toEqual({
      schedule_id: "psm_schedule",
      values: { mgmt: { value_pct: -5, source: "underwriter" } },
    });
  });

  it("no judgments → no envelope on the wire (absence is the filed neutral)", () => {
    const risk = buildSampleRisk({
      entries: [],
      seeded: {},
      overrides: {},
      schedules: SCHEDULES,
    });
    expect("schedule_app_psm_schedule" in risk).toBe(false);
  });

  it("a seeded raw envelope stays machinery: hidden from the form, overridden by judgments", () => {
    const seeded = {
      schedule_app_psm_schedule: {
        schedule_id: "psm_schedule",
        values: { mgmt: { value_pct: 3, source: "uw_report" } },
      },
    };
    const fields = deriveRunFields({
      entries: [],
      seeded,
      overrides: {},
      schedules: SCHEDULES,
    });
    expect(
      fields.some((f) => f.key === "schedule_app_psm_schedule"),
    ).toBe(false);
    // Untouched form → the seeded envelope passes through…
    const passthrough = buildSampleRisk({
      entries: [],
      seeded,
      overrides: {},
      schedules: SCHEDULES,
    });
    expect(passthrough["schedule_app_psm_schedule"]).toEqual(
      seeded.schedule_app_psm_schedule,
    );
    // …and an entered judgment WINS over it.
    const edited = buildSampleRisk({
      entries: [],
      seeded,
      overrides: { "schedule:psm_schedule:mgmt": "7%" },
      schedules: SCHEDULES,
    });
    expect(edited["schedule_app_psm_schedule"]).toEqual({
      schedule_id: "psm_schedule",
      values: { mgmt: { value_pct: 7, source: "underwriter" } },
    });
  });
});
