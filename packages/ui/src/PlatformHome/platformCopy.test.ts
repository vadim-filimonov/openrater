/**
 * platformCopy tests — pins the Brief 88 §6 status-line contract, headlined
 * by CT-4: connector setup alone NEVER turns the front door amber.
 */

import { describe, it, expect } from "vitest";
import {
  statusLineFor,
  planRowNextStep,
  referencePlanNote,
  type AttentionSummary,
  type PlanRowFacts,
} from "./platformCopy";

function summary(o: Partial<AttentionSummary>): AttentionSummary {
  return {
    alarmGroupCount: 0,
    setupGroupCount: 0,
    needsYouGroupCount:
      (o.alarmGroupCount ?? 0) + (o.setupGroupCount ?? 0),
    keylessConnectorCount: 0,
    failedConnectorCount: 0,
    ...o,
  };
}

describe("statusLineFor", () => {
  it("all clear → green, calm", () => {
    expect(statusLineFor(summary({}))).toEqual({
      tone: "ok",
      title: "Everything's running smoothly.",
    });
  });

  it("one alarm → warn, singular", () => {
    expect(statusLineFor(summary({ alarmGroupCount: 1 }))).toEqual({
      tone: "warn",
      title: "One thing needs attention.",
    });
  });

  it("alarms + setup → warn, counting every listed group (mockup scene 1)", () => {
    expect(
      statusLineFor(
        summary({
          alarmGroupCount: 1,
          setupGroupCount: 1,
          keylessConnectorCount: 3,
        }),
      ),
    ).toEqual({ tone: "warn", title: "2 things need attention." });
  });

  it("CT-4 — keyless connectors alone stay GREEN with the honest suffix", () => {
    expect(
      statusLineFor(
        summary({ setupGroupCount: 1, keylessConnectorCount: 3 }),
      ),
    ).toEqual({
      tone: "ok",
      title: "Running smoothly — 3 API Lab connections could use keys.",
    });
  });

  it("a single keyless connector reads singular", () => {
    expect(
      statusLineFor(
        summary({ setupGroupCount: 1, keylessConnectorCount: 1 }),
      ),
    ).toEqual({
      tone: "ok",
      title: "Running smoothly — an API Lab connection could use a key.",
    });
  });

  it("failed-run connectors alone stay green too, named for what they are", () => {
    expect(
      statusLineFor(
        summary({ setupGroupCount: 1, failedConnectorCount: 2 }),
      ),
    ).toEqual({
      tone: "ok",
      title: "Running smoothly — 2 API Lab connections failed their last run.",
    });
  });

  it("mixed keyless + failed compounds into one honest suffix", () => {
    expect(
      statusLineFor(
        summary({
          setupGroupCount: 2,
          keylessConnectorCount: 3,
          failedConnectorCount: 1,
        }),
      ),
    ).toEqual({
      tone: "ok",
      title:
        "Running smoothly — 3 API Lab connections could use keys and 1 failed its last run.",
    });
  });

  // MVP-005 — with plan facts supplied, the line is about PLANS.
  it("leads with the plans clause when plans exist (arrival order)", () => {
    expect(
      statusLineFor(summary({}), { count: 1, liveCount: 0, readyCount: 1 }),
    ).toEqual({
      tone: "ok",
      title: "1 plan · compiles clean — ready to publish.",
    });
    expect(
      statusLineFor(summary({}), { count: 3, liveCount: 1, readyCount: 1 }),
    ).toEqual({ tone: "ok", title: "3 plans · 1 live · 1 ready to publish." });
  });

  it("connector setup demotes to a suffix behind the plans clause", () => {
    expect(
      statusLineFor(
        summary({ setupGroupCount: 1, keylessConnectorCount: 2 }),
        { count: 1, liveCount: 1, readyCount: 0 },
      ),
    ).toEqual({
      tone: "ok",
      title: "1 plan · live. 2 API Lab connections could use keys.",
    });
  });

  it("alarms keep the line — plans clause never masks a problem", () => {
    expect(
      statusLineFor(summary({ alarmGroupCount: 1 }), {
        count: 1,
        liveCount: 1,
        readyCount: 0,
      }).tone,
    ).toBe("warn");
  });
});

function row(o: Partial<PlanRowFacts>): PlanRowFacts {
  return { live: false, diverged: false, servingCount: 0, ...o };
}

describe("planRowNextStep (Brief 88 §3.2 Block 3)", () => {
  it("blocking errors headline the row", () => {
    expect(planRowNextStep(row({ errorCount: 3 }))).toBe(
      "Can't rate — 3 blocking errors.",
    );
  });

  it("live + diverged → review & publish (drift parity)", () => {
    expect(planRowNextStep(row({ live: true, diverged: true }))).toBe(
      "Draft is ahead of live — review & publish.",
    );
  });

  it("live + serving → names the app count", () => {
    expect(planRowNextStep(row({ live: true, servingCount: 2 }))).toBe(
      "Serving 2 apps.",
    );
    expect(planRowNextStep(row({ live: true, servingCount: 1 }))).toBe(
      "Serving 1 app.",
    );
  });

  it("live, in-sync, unserved → just 'Live.' (the nudge lives in attention)", () => {
    expect(planRowNextStep(row({ live: true }))).toBe("Live.");
  });

  it("ready draft → ready to publish (attention-row parity)", () => {
    expect(planRowNextStep(row({ compileReady: true }))).toBe(
      "Compiles clean — ready to publish.",
    );
  });

  it("incomplete draft speaks its blocking hint verbatim", () => {
    expect(
      planRowNextStep(
        row({ compileReady: false, blockingHint: "Build the algorithm first." }),
      ),
    ).toBe("Build the algorithm first.");
  });

  it("facts still loading → a calm empty cell, never a guess", () => {
    expect(planRowNextStep(row({}))).toBe("");
  });
});

describe("referencePlanNote (first-run §5.5)", () => {
  it("labels the seeded Meridian reference plan", () => {
    expect(referencePlanNote("meridian-shopfront-bop-ne-2026")).toBe(
      "Reference plan — built from the bundled sample filing",
    );
  });

  it("stays silent for user-created plans", () => {
    expect(referencePlanNote("acme-bop-tx-2027")).toBeNull();
  });
});
