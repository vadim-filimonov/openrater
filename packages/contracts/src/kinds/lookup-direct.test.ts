import { describe, it, expect } from "vitest";
import { DirectLookupKind } from "./lookup-direct";

describe("DirectLookupKind", () => {
  it("declares one key input, one value output", () => {
    expect(DirectLookupKind.inputs).toHaveLength(1);
    expect(DirectLookupKind.inputs[0]?.name).toBe("key");
    expect(DirectLookupKind.outputs[0]?.name).toBe("value");
  });

  it("returns the table value when key is present", () => {
    const r = DirectLookupKind.execute(
      { key: "frame" },
      {
        table: { frame: 0.85, masonry: 0.7 },
        defaultValue: 1.0,
      },
    );
    expect(r.value).toBe(0.85);
  });

  it("returns defaultValue when key is absent", () => {
    const r = DirectLookupKind.execute(
      { key: "exotic" },
      { table: { frame: 0.85 }, defaultValue: 1.0 },
    );
    expect(r.value).toBe(1.0);
  });

  it("returns the table value of 0 (not defaultValue) when key maps to 0", () => {
    // Guard against `??` ambiguity: only nullish should fall through.
    const r = DirectLookupKind.execute(
      { key: "exempt" },
      { table: { exempt: 0 }, defaultValue: 1.0 },
    );
    expect(r.value).toBe(0);
  });

  it("validate flags NaN defaultValue", () => {
    const r = DirectLookupKind.validate!({
      table: { a: 1 },
      defaultValue: NaN,
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.field).toBe("defaultValue");
  });

  it("validate warns on empty table (but stays valid)", () => {
    const r = DirectLookupKind.validate!({
      table: {},
      defaultValue: 1.0,
    });
    expect(r.valid).toBe(true);
    expect(r.issues[0]?.severity).toBe("warning");
    expect(r.issues[0]?.field).toBe("table");
  });

  it("validate accepts a populated table", () => {
    const r = DirectLookupKind.validate!({
      table: { frame: 0.85 },
      defaultValue: 1.0,
    });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("explainStep distinguishes hit vs default", () => {
    const params = {
      table: { frame: 0.85, masonry: 0.7 },
      defaultValue: 1.0,
    };
    expect(
      DirectLookupKind.explainStep!({ key: "frame" }, params, { value: 0.85 }),
    ).toBe("Looked up `frame` → 0.85");
    expect(
      DirectLookupKind.explainStep!(
        { key: "exotic" },
        params,
        { value: 1.0 },
      ),
    ).toBe("`exotic` not in table → 1 (default)");
  });

  it("explainStep prefixes tableName when present", () => {
    expect(
      DirectLookupKind.explainStep!(
        { key: "frame" },
        {
          table: { frame: 0.85 },
          defaultValue: 1.0,
          tableName: "Construction",
        },
        { value: 0.85 },
      ),
    ).toBe("Construction: Looked up `frame` → 0.85");
  });
});
