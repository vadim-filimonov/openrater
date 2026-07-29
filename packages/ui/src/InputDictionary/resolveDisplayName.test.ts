/**
 * resolveInputDisplayName tests — pins the MVP-012 rule: both writers
 * (hand editor: display name in config.name; workbook builder: slug in
 * config.name, label on the stage) resolve to the human name, and a
 * degenerate name never shadows a real one.
 */

import { describe, it, expect } from "vitest";
import { resolveInputDisplayName } from "./resolveDisplayName";

describe("resolveInputDisplayName", () => {
  it("workbook shape: config.name is the slug → the stage label wins", () => {
    expect(
      resolveInputDisplayName({
        fieldKey: "annual_gross_sales",
        configName: "annual_gross_sales",
        stageDisplayName: "Annual gross sales",
      }),
    ).toBe("Annual gross sales");
  });

  it("editor shape: an authored config.name wins over a stale stage name", () => {
    expect(
      resolveInputDisplayName({
        fieldKey: "tiv",
        configName: "Total insured value",
        stageDisplayName: "tiv",
      }),
    ).toBe("Total insured value");
  });

  it("no display information anywhere → the slug, honestly", () => {
    expect(
      resolveInputDisplayName({
        fieldKey: "sq_ft",
        configName: "sq_ft",
        stageDisplayName: "sq_ft",
      }),
    ).toBe("sq_ft");
    expect(
      resolveInputDisplayName({ fieldKey: "sq_ft" }),
    ).toBe("sq_ft");
  });

  it("whitespace names carry nothing", () => {
    expect(
      resolveInputDisplayName({
        fieldKey: "zip",
        configName: "  ",
        stageDisplayName: "Location ZIP",
      }),
    ).toBe("Location ZIP");
  });
});
