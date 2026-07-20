import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { InputDictEntry } from "./types";
import {
  enqueuePendingDeclarations,
  peekPendingDeclarations,
  dequeuePendingDeclaration,
  clearPendingDeclarations,
  drainPendingDeclarations,
} from "./pendingQueue";

const PLAN = "plan_abc";

function entry(i: number): InputDictEntry {
  return {
    id: `input_${i}`,
    fieldName: `field_${i}`,
    displayName: `Field ${i}`,
    dataType: "float",
    source: "form",
    required: true,
  };
}

function batch(n: number): InputDictEntry[] {
  return Array.from({ length: n }, (_, i) => entry(i));
}

describe("inputDict pendingQueue", () => {
  // jsdom under vitest ships a partial localStorage (no clear); install a
  // clean Map-backed one (mirrors AnalyticsWorkspace/analytics-bridge.test).
  beforeAll(() => {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, String(v));
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => {
          store.clear();
        },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it("enqueues entries and reads them back FIFO", () => {
    const added = enqueuePendingDeclarations(PLAN, batch(3));
    expect(added).toHaveLength(3);
    expect(peekPendingDeclarations(PLAN).map((e) => e.id)).toEqual([
      "input_0",
      "input_1",
      "input_2",
    ]);
  });

  it("dedupes within the queue by id and fieldName", () => {
    enqueuePendingDeclarations(PLAN, batch(2));
    const added = enqueuePendingDeclarations(PLAN, [
      entry(1), // same id+field — skipped
      entry(2), // new
    ]);
    expect(added.map((e) => e.id)).toEqual(["input_2"]);
    expect(peekPendingDeclarations(PLAN)).toHaveLength(3);
  });

  it("dequeues a single committed entry; clear empties the queue", () => {
    enqueuePendingDeclarations(PLAN, batch(3));
    dequeuePendingDeclaration(PLAN, "input_1");
    expect(peekPendingDeclarations(PLAN).map((e) => e.id)).toEqual([
      "input_0",
      "input_2",
    ]);
    clearPendingDeclarations(PLAN);
    expect(peekPendingDeclarations(PLAN)).toHaveLength(0);
  });

  it("drains the whole queue, committing each exactly once", async () => {
    enqueuePendingDeclarations(PLAN, batch(28));
    const committed: string[] = [];
    const result = await drainPendingDeclarations(PLAN, async (e) => {
      committed.push(e.id);
    });
    expect(result).toEqual({ committed: 28, failed: false });
    expect(committed).toHaveLength(28);
    expect(new Set(committed).size).toBe(28); // each exactly once
    expect(peekPendingDeclarations(PLAN)).toHaveLength(0);
  });

  // THE regression: "navigate immediately after quick-add → work
  // persists." A drain interrupted by a save failure (the unmount /
  // network drop analogue) leaves the remainder queued, and the next
  // drain finishes the job — every declaration commits exactly once.
  it("resumes after an interruption with no work lost or duplicated", async () => {
    enqueuePendingDeclarations(PLAN, batch(28));
    const committed: string[] = [];

    // First pass fails on the 4th save (3 commit, then interrupted).
    let calls = 0;
    const r1 = await drainPendingDeclarations(PLAN, async (e) => {
      if (calls === 3) throw new Error("network dropped (navigated away)");
      calls += 1;
      committed.push(e.id);
    });
    expect(r1.failed).toBe(true);
    expect(r1.committed).toBe(3);
    // The 25 not-yet-committed declarations are still queued.
    expect(peekPendingDeclarations(PLAN)).toHaveLength(25);

    // Second pass (resume on remount / retry) finishes the rest.
    const r2 = await drainPendingDeclarations(PLAN, async (e) => {
      committed.push(e.id);
    });
    expect(r2).toEqual({ committed: 25, failed: false });
    expect(peekPendingDeclarations(PLAN)).toHaveLength(0);

    // All 28 persisted, each exactly once — nothing lost, nothing double.
    expect(committed).toHaveLength(28);
    expect(new Set(committed).size).toBe(28);
  });

  it("reports remaining count via onProgress as it drains", async () => {
    enqueuePendingDeclarations(PLAN, batch(3));
    const remaining: number[] = [];
    await drainPendingDeclarations(
      PLAN,
      async () => {},
      (n) => remaining.push(n),
    );
    expect(remaining).toEqual([2, 1, 0]);
  });

  it("keeps queues isolated per plan id", () => {
    enqueuePendingDeclarations("plan_a", batch(2));
    enqueuePendingDeclarations("plan_b", batch(1));
    expect(peekPendingDeclarations("plan_a")).toHaveLength(2);
    expect(peekPendingDeclarations("plan_b")).toHaveLength(1);
  });

  // P0.2 regression: NEW entries carry id "" (the backend assigns the
  // stage_id on add). Dedup + dequeue must key on fieldName for those —
  // otherwise a bulk declare of several fresh fields collapses to one
  // (enqueue), or the whole batch is wiped after the first commit
  // (dequeue). This also repairs v1's "declare all".
  describe("new (empty-id) entries", () => {
    const fresh = (field: string): InputDictEntry => ({
      id: "",
      fieldName: field,
      displayName: field,
      dataType: "string",
      source: "form",
      required: true,
    });

    it("enqueues several fresh fields despite a shared empty id", () => {
      const added = enqueuePendingDeclarations(PLAN, [
        fresh("a"),
        fresh("b"),
        fresh("c"),
      ]);
      expect(added).toHaveLength(3);
      expect(peekPendingDeclarations(PLAN).map((e) => e.fieldName)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    it("dequeues only the head, not the whole empty-id batch", () => {
      enqueuePendingDeclarations(PLAN, [fresh("a"), fresh("b"), fresh("c")]);
      dequeuePendingDeclaration(PLAN, ""); // commit the head
      expect(peekPendingDeclarations(PLAN).map((e) => e.fieldName)).toEqual([
        "b",
        "c",
      ]);
    });

    it("drains a fresh batch, committing every field exactly once", async () => {
      enqueuePendingDeclarations(PLAN, [fresh("a"), fresh("b"), fresh("c")]);
      const committed: string[] = [];
      const result = await drainPendingDeclarations(PLAN, async (e) => {
        committed.push(e.fieldName);
      });
      expect(result).toEqual({ committed: 3, failed: false });
      expect(committed).toEqual(["a", "b", "c"]);
      expect(peekPendingDeclarations(PLAN)).toHaveLength(0);
    });
  });
});
