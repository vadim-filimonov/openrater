import { describe, it, expect } from "vitest";
import { MultiLookupKind } from "./lookup-multi";
import type { MultiLookupRow } from "./lookup-multi";

const RATING_ROWS: readonly MultiLookupRow[] = [
  { keys: ["00811", "01", "B"], factor: 1.1 },
  { keys: ["00811", "01", "C"], factor: 1.25 },
  { keys: ["00811", "02", "B"], factor: 0.95 },
  { keys: ["00812", "01", "B"], factor: 0.75 },
];

describe("MultiLookupKind", () => {
  it("declares one keys input (record), one value output", () => {
    expect(MultiLookupKind.inputs).toHaveLength(1);
    expect(MultiLookupKind.inputs[0]?.name).toBe("keys");
    expect(MultiLookupKind.inputs[0]?.type).toBe("record");
  });

  it("returns the factor of the row whose key tuple matches positionally", () => {
    const r = MultiLookupKind.execute(
      {
        keys: { class_code: "00811", territory: "01", protection: "C" },
      },
      {
        keyNames: ["class_code", "territory", "protection"],
        rows: RATING_ROWS,
        defaultValue: 1.0,
      },
    );
    expect(r.value).toBe(1.25);
  });

  it("returns defaultValue when no row matches the input tuple", () => {
    const r = MultiLookupKind.execute(
      {
        keys: { class_code: "99999", territory: "01", protection: "B" },
      },
      {
        keyNames: ["class_code", "territory", "protection"],
        rows: RATING_ROWS,
        defaultValue: 1.0,
      },
    );
    expect(r.value).toBe(1.0);
  });

  it("first positional match wins", () => {
    const rows: readonly MultiLookupRow[] = [
      { keys: ["A", "1"], factor: 0.5 },
      { keys: ["A", "1"], factor: 0.9 }, // duplicate; should never be returned
    ];
    const r = MultiLookupKind.execute(
      { keys: { x: "A", y: "1" } },
      { keyNames: ["x", "y"], rows, defaultValue: 1.0 },
    );
    expect(r.value).toBe(0.5);
  });

  it("supports numeric keys (positional value-equality)", () => {
    const r = MultiLookupKind.execute(
      { keys: { protection_class: 5, year_built: 2010 } },
      {
        keyNames: ["protection_class", "year_built"],
        rows: [{ keys: [5, 2010], factor: 0.92 }],
        defaultValue: 1.0,
      },
    );
    expect(r.value).toBe(0.92);
  });

  it("skips rows whose key count differs from keyNames", () => {
    const r = MultiLookupKind.execute(
      { keys: { x: "A", y: "1" } },
      {
        keyNames: ["x", "y"],
        rows: [
          // Wrong arity — should be skipped silently at execute-time.
          { keys: ["A"], factor: 0.5 },
          { keys: ["A", "1"], factor: 0.9 },
        ],
        defaultValue: 1.0,
      },
    );
    expect(r.value).toBe(0.9);
  });

  it("validate flags missing keyNames", () => {
    const r = MultiLookupKind.validate!({
      keyNames: [],
      rows: [],
      defaultValue: 1.0,
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.field).toBe("keyNames");
  });

  it("validate flags rows whose key count mismatches keyNames", () => {
    const r = MultiLookupKind.validate!({
      keyNames: ["x", "y"],
      rows: [{ keys: ["A"], factor: 1 }],
      defaultValue: 1.0,
    });
    expect(r.valid).toBe(false);
    expect(r.issues[0]?.message).toMatch(/row 0: key count/);
  });

  it("validate warns on empty rows (but stays valid)", () => {
    const r = MultiLookupKind.validate!({
      keyNames: ["x"],
      rows: [],
      defaultValue: 1.0,
    });
    expect(r.valid).toBe(true);
    expect(r.issues[0]?.severity).toBe("warning");
  });

  it("validate accepts well-formed params", () => {
    const r = MultiLookupKind.validate!({
      keyNames: ["x", "y"],
      rows: [{ keys: ["A", "1"], factor: 1 }],
      defaultValue: 1.0,
    });
    expect(r.valid).toBe(true);
  });

  // ── ADR-0044 — derived per-key input ports ──────────────────────────
  describe("derivedPorts (ADR-0044 — one port per key)", () => {
    it("exposes one input port per keyName when keyNames is set", () => {
      const ports = MultiLookupKind.derivedPorts!({
        keyNames: ["territory", "exposure_base"],
        rows: [],
        defaultValue: 1.0,
      });
      expect(ports.inputs.map((p) => p.name)).toEqual([
        "territory",
        "exposure_base",
      ]);
      expect(ports.outputs[0]?.name).toBe("value");
    });

    it("falls back to the single `keys` record port when keyNames is empty", () => {
      const ports = MultiLookupKind.derivedPorts!({
        keyNames: [],
        rows: [],
        defaultValue: 1.0,
      });
      expect(ports.inputs).toHaveLength(1);
      expect(ports.inputs[0]?.name).toBe("keys");
      expect(ports.inputs[0]?.type).toBe("record");
    });

    it("execute reads keys from per-key port inputs (no `keys` record)", () => {
      // The runtime gathers each per-key edge into inputs[keyName]; there
      // is no `keys` record. execute must still build the tuple.
      const r = MultiLookupKind.execute(
        { territory: "701", exposure_base: "sales" },
        {
          keyNames: ["territory", "exposure_base"],
          rows: [
            { keys: ["701", "sales"], factor: 1.518 },
            { keys: ["702", "sales"], factor: 1.577 },
            { keys: ["701", "loi"], factor: 0.025 },
          ],
          defaultValue: 1.0,
        },
      );
      expect(r.value).toBe(1.518);
    });

    it("execute still honors the legacy `keys` record (back-compat)", () => {
      const r = MultiLookupKind.execute(
        { keys: { territory: "702", exposure_base: "sales" } },
        {
          keyNames: ["territory", "exposure_base"],
          rows: [
            { keys: ["701", "sales"], factor: 1.518 },
            { keys: ["702", "sales"], factor: 1.577 },
          ],
          defaultValue: 1.0,
        },
      );
      expect(r.value).toBe(1.577);
    });
  });
});
describe("lookup.multi — numeric keys match string row keys (Brief 83.2)", () => {
  it("a number input meaning the same key matches ('1500' row, 1500 input)", () => {
    const params = {
      keyNames: ["ded", "band"],
      rows: [{ keys: ["1500", "band_lo"], factor: 0.95 }],
      defaultValue: 1.0,
    };
    const out = MultiLookupKind.execute(
      { ded: 1500 as unknown as string, band: "band_lo" },
      params,
    );
    expect(out.value).toBe(0.95);
  });

  it("an absent key still never matches", () => {
    const params = {
      keyNames: ["ded", "band"],
      rows: [{ keys: ["undefined", "band_lo"], factor: 9 }],
      defaultValue: 1.0,
    };
    const out = MultiLookupKind.execute(
      { band: "band_lo" } as unknown as { ded: string; band: string },
      params,
    );
    expect(out.value).toBe(1.0);
  });

  // ── ADR-0063 amendment — interpolateOn (2-D-axis interpolation, F14) ──
  describe("interpolateOn — interpolate one axis of a 2-D lookup", () => {
    // Building Limit relativity shape: (limit-band × construction-group).
    // group_c's curve: b1@100k=1.0, b2@250k=1.3, b3@500k=1.45, b4@1M=1.6.
    const params = {
      keyNames: ["band", "group"],
      rows: [
        { keys: ["b1", "group_a"], factor: 0.9 },
        { keys: ["b1", "group_c"], factor: 1.0 },
        { keys: ["b2", "group_c"], factor: 1.3 },
        { keys: ["b3", "group_c"], factor: 1.45 },
        { keys: ["b4", "group_c"], factor: 1.6 },
        { keys: ["b2", "group_a"], factor: 1.2 },
      ],
      defaultValue: 1.0,
      interpolateOn: {
        key: "band",
        breakpoints: { b1: 100_000, b2: 250_000, b3: 500_000, b4: 1_000_000 },
      },
    };

    it("interpolates the flagged axis, keying the other discretely", () => {
      // limit 315000 in group_c → between b2(250k,1.3) and b3(500k,1.45):
      // 1.3 + (65000/250000)*0.15 = 1.339
      const out = MultiLookupKind.execute(
        { band: 315_000 as unknown as string, group: "group_c" },
        params,
      );
      expect(out.value).toBeCloseTo(1.339, 6);
    });

    it("a raw value exactly ON a breakpoint returns that factor byte-exact", () => {
      const out = MultiLookupKind.execute(
        { band: 250_000 as unknown as string, group: "group_c" },
        params,
      );
      expect(out.value).toBe(1.3); // unchanged vs stepping
    });

    it("a pre-binned band id still matches discretely (idempotent)", () => {
      const out = MultiLookupKind.execute({ band: "b3", group: "group_c" }, params);
      expect(out.value).toBe(1.45);
    });

    it("clamps beyond the end breakpoints (tail = stepping)", () => {
      expect(
        MultiLookupKind.execute(
          { band: 50 as unknown as string, group: "group_c" },
          params,
        ).value,
      ).toBe(1.0);
      expect(
        MultiLookupKind.execute(
          { band: 9_000_000 as unknown as string, group: "group_c" },
          params,
        ).value,
      ).toBe(1.6);
    });

    it("interpolates within the OTHER group independently", () => {
      // group_a curve: b1@100k=0.9, b2@250k=1.2 → 175000 = 1.05
      const out = MultiLookupKind.execute(
        { band: 175_000 as unknown as string, group: "group_a" },
        params,
      );
      expect(out.value).toBeCloseTo(1.05, 6);
    });

    it("a non-numeric flagged-axis value misses (onMiss/default)", () => {
      const out = MultiLookupKind.execute(
        { band: "junk" as unknown as string, group: "group_c" },
        params,
      );
      expect(out.value).toBe(1.0); // default
    });

    it("WITHOUT interpolateOn, the same table steps (byte-identical baseline)", () => {
      // Omit the key entirely — under exactOptionalPropertyTypes an explicit
      // `interpolateOn: undefined` is not assignable to the optional param.
      const { interpolateOn: _omit, ...stepParams } = params;
      // a raw 315000 with no matching band id → miss → default (the pre-fix
      // behavior; the projector pairs interpolateOn with a raw-value wire).
      const out = MultiLookupKind.execute(
        { band: 315_000 as unknown as string, group: "group_c" },
        stepParams,
      );
      expect(out.value).toBe(1.0);
    });

    it("validate rejects a bad interpolateOn", () => {
      expect(
        MultiLookupKind.validate!({ ...params, interpolateOn: { key: "nope", breakpoints: { b1: 1 } } })
          .valid,
      ).toBe(false);
      expect(
        MultiLookupKind.validate!({ ...params, interpolateOn: { key: "band", breakpoints: {} } }).valid,
      ).toBe(false);
      expect(MultiLookupKind.validate!(params).valid).toBe(true);
    });
  });
});

