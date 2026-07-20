import { describe, it, expect } from "vitest";
import { UnknownKind } from "./unknown";

describe("UnknownKind", () => {
  it("declares id=unknown, category=custom", () => {
    expect(UnknownKind.id).toBe("unknown");
    expect(UnknownKind.category).toBe("custom");
  });

  it("declares no inputs, no outputs", () => {
    expect(UnknownKind.inputs).toEqual([]);
    expect(UnknownKind.outputs).toEqual([]);
  });

  it("execute returns an empty object (no-op)", () => {
    expect(UnknownKind.execute({}, {})).toEqual({});
  });

  it("preserves original kind + params via UnknownParams shape", () => {
    // Type-level check: callers can stash the original kind/params
    const r = UnknownKind.execute(
      {},
      {
        originalKind: "future.kind.we.dont.know",
        originalParams: { lo: 0, hi: 100 },
      },
    );
    expect(r).toEqual({});
  });

  it("declares certainty=experimental (this kind should never run)", () => {
    expect(UnknownKind.certainty).toBe("experimental");
  });
});
