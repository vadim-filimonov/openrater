/**
 * parseCsvAsync tests — Brief 45 K11.
 *
 * These run under jsdom, which does NOT execute module workers — so
 * every call here exercises the SYNCHRONOUS FALLBACK path (worker
 * construction succeeds but `onerror` fires when the module script
 * fails to load, OR `Worker` is shimmed/undefined). That's exactly the
 * contract we want to lock down: `parseCsvForInputsAsync` must always
 * resolve (never reject) with the same discriminated result shape as
 * the synchronous `parseCsvForInputs`, regardless of worker support.
 *
 * Live off-main-thread parsing (the actual worker doing the work) only
 * happens in a real browser with Vite's worker bundling — that's the
 * human's browser-verification step, not a unit test.
 */

import { describe, it, expect } from "vitest";

import { parseCsvForInputs } from "./parseCsv";
import { parseCsvForInputsAsync } from "./parseCsvAsync";

describe("parseCsvForInputsAsync — sync-fallback contract", () => {
  it("resolves with the same success shape as parseCsvForInputs for a valid CSV", async () => {
    const csv = "class_code,state,premium\n1234,CA,100\n5678,NY,250";

    const sync = parseCsvForInputs(csv);
    const asyncResult = await parseCsvForInputsAsync(csv);

    // Identical discriminant + payload — the async path is a transport
    // wrapper, not a different parser.
    expect(asyncResult).toEqual(sync);
    expect(asyncResult.ok).toBe(true);
    if (!asyncResult.ok) return;
    expect(asyncResult.snapshot.kind).toBe("csv");
    expect(asyncResult.snapshot.columns).toEqual([
      "class_code",
      "state",
      "premium",
    ]);
    expect(asyncResult.snapshot.totalRowCount).toBe(2);
    expect(asyncResult.snapshot.sample_rows).toEqual([
      { class_code: "1234", state: "CA", premium: "100" },
      { class_code: "5678", state: "NY", premium: "250" },
    ]);
  });

  it("forwards options (maxSampleRows) to the underlying parser", async () => {
    const csv = "a,b\n1,2\n3,4\n5,6";

    const asyncResult = await parseCsvForInputsAsync(csv, { maxSampleRows: 1 });

    expect(asyncResult.ok).toBe(true);
    if (!asyncResult.ok) return;
    // Sample is capped to 1 row, but the total count reflects all rows.
    expect(asyncResult.snapshot.sample_rows).toHaveLength(1);
    expect(asyncResult.snapshot.totalRowCount).toBe(3);
    // Matches the synchronous parser called with the same options.
    expect(asyncResult).toEqual(parseCsvForInputs(csv, { maxSampleRows: 1 }));
  });

  it("resolves with ok:false (not a rejection) for a malformed CSV", async () => {
    // Unterminated quoted field — parseCsv reports a structured error.
    const malformed = 'a,b\n"oops,2';

    const sync = parseCsvForInputs(malformed);
    const asyncResult = await parseCsvForInputsAsync(malformed);

    expect(sync.ok).toBe(false);
    expect(asyncResult).toEqual(sync);
    expect(asyncResult.ok).toBe(false);
    if (asyncResult.ok) return;
    expect(asyncResult.error.kind).toBe("unterminated_quote");
  });

  it("resolves with ok:false for empty input", async () => {
    const asyncResult = await parseCsvForInputsAsync("");

    expect(asyncResult.ok).toBe(false);
    if (asyncResult.ok) return;
    expect(asyncResult.error.kind).toBe("empty");
    expect(asyncResult).toEqual(parseCsvForInputs(""));
  });

  it("never rejects — always resolves with a result", async () => {
    // Whatever the input, the promise settles via resolve. Awaiting a
    // rejecting promise would throw here; reaching the assertion proves
    // it resolved.
    await expect(
      parseCsvForInputsAsync("garbage,with,no,problem\n1,2,3,4"),
    ).resolves.toBeDefined();
  });
});
