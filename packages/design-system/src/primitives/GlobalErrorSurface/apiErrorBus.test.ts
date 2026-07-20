import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiErrorBus, MAX_NOTICES } from "./apiErrorBus";

describe("apiErrorBus", () => {
  beforeEach(() => {
    apiErrorBus.clear();
  });

  it("starts empty with a stable snapshot reference", () => {
    const a = apiErrorBus.getSnapshot();
    const b = apiErrorBus.getSnapshot();
    expect(a).toEqual([]);
    expect(a).toBe(b); // stable identity — required by useSyncExternalStore
  });

  it("pushes a notice newest-first with count 1", () => {
    apiErrorBus.push({ id: "network_error:0", title: "T", message: "M" });
    apiErrorBus.push({ id: "server_error:500", title: "T2", message: "M2" });
    const snap = apiErrorBus.getSnapshot();
    expect(snap.map((n) => n.id)).toEqual([
      "server_error:500",
      "network_error:0",
    ]);
    expect(snap[0]?.count).toBe(1);
  });

  it("coalesces same-id errors with an incremented count (newest wins)", () => {
    apiErrorBus.push({ id: "network_error:0", title: "old", message: "M1" });
    apiErrorBus.push({ id: "network_error:0", title: "new", message: "M2" });
    const snap = apiErrorBus.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]?.count).toBe(2);
    expect(snap[0]?.title).toBe("new"); // newest title/message win
    expect(snap[0]?.message).toBe("M2");
  });

  it("caps distinct notices at MAX_NOTICES (keeps newest)", () => {
    for (let i = 0; i < MAX_NOTICES + 2; i += 1) {
      apiErrorBus.push({ id: `e${i}`, title: "T", message: "M" });
    }
    const snap = apiErrorBus.getSnapshot();
    expect(snap).toHaveLength(MAX_NOTICES);
    expect(snap[0]?.id).toBe(`e${MAX_NOTICES + 1}`); // newest retained
  });

  it("dismiss removes one and notifies subscribers", () => {
    const listener = vi.fn();
    const unsub = apiErrorBus.subscribe(listener);
    apiErrorBus.push({ id: "a", title: "T", message: "M" });
    expect(listener).toHaveBeenCalledTimes(1);
    apiErrorBus.dismiss("a");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(apiErrorBus.getSnapshot()).toEqual([]);
    unsub();
  });

  it("does not notify on a no-op clear (empty → empty)", () => {
    const listener = vi.fn();
    apiErrorBus.subscribe(listener);
    apiErrorBus.clear();
    expect(listener).not.toHaveBeenCalled();
  });
});
