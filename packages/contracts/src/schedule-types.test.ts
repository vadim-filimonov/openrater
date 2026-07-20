/**
 * Schedule rating shape tests (M1.3, Brief 15).
 *
 * Pure-type modules don't have runtime behavior of their own —
 * the kind (modifier-schedule.test.ts) covers all behavior. This
 * file just verifies the immutability invariant on the closed
 * vocabularies and that all sources are accounted for.
 */

import { describe, it, expect } from "vitest";
import { SCHEDULE_APPLICATION_SOURCES } from "./schedule-types";
import type { ScheduleApplicationSource } from "./schedule-types";

describe("SCHEDULE_APPLICATION_SOURCES", () => {
  it("includes the 3 canonical sources", () => {
    const expected: ScheduleApplicationSource[] = [
      "underwriter",
      "uw_report",
      "default_zero",
    ];
    expect([...SCHEDULE_APPLICATION_SOURCES].sort()).toEqual(
      [...expected].sort(),
    );
  });

  it("is frozen — accidental mutation throws in strict mode", () => {
    expect(Object.isFrozen(SCHEDULE_APPLICATION_SOURCES)).toBe(true);
  });
});
