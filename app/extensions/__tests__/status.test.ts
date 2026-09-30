import { test, expect, describe } from "bun:test";
import { applyStatus, dropExpired, visibleStatus, type ActiveStatus } from "~/extensions/status";

const NOW = 1_000_000;

function add(list: ActiveStatus[], id: string, text: string | null, extra: Record<string, unknown> = {}, seq = list.length + 1) {
  return applyStatus(list, { id, text, ...extra }, NOW, seq);
}

describe("applyStatus", () => {
  test("adds a message", () => {
    const list = add([], "languagetool", "Check unavailable");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "languagetool", text: "Check unavailable", tone: "info", expiresAt: null });
  });

  test("the same id replaces its message instead of stacking", () => {
    let list = add([], "languagetool", "first");
    list = add(list, "languagetool", "second");
    expect(list.map((s) => s.text)).toEqual(["second"]);
  });

  test("null text removes the id's message", () => {
    let list = add([], "languagetool", "Check unavailable");
    list = add(list, "languagetool", null);
    expect(list).toEqual([]);
  });

  test("empty text also removes it", () => {
    let list = add([], "languagetool", "x");
    list = add(list, "languagetool", "");
    expect(list).toEqual([]);
  });

  test("other ids are left alone", () => {
    let list = add([], "languagetool", "a");
    list = add(list, "ai-proofreader", "b");
    list = add(list, "languagetool", null);
    expect(list.map((s) => s.id)).toEqual(["ai-proofreader"]);
  });

  test("ttl sets an expiry time, no ttl means it stays", () => {
    const list = add(add([], "a", "timed", { ttlMs: 5000 }), "b", "sticky");
    expect(list.find((s) => s.id === "a")!.expiresAt).toBe(NOW + 5000);
    expect(list.find((s) => s.id === "b")!.expiresAt).toBeNull();
  });

  test("keeps the tone and the tooltip", () => {
    const [s] = add([], "a", "Down", { tone: "error", title: "Full explanation" });
    expect(s.tone).toBe("error");
    expect(s.title).toBe("Full explanation");
  });
});

describe("dropExpired", () => {
  test("removes messages whose time has passed and keeps the rest", () => {
    let list = add([], "a", "timed", { ttlMs: 1000 });
    list = add(list, "b", "sticky");
    expect(dropExpired(list, NOW + 999).map((s) => s.id)).toEqual(["a", "b"]);
    expect(dropExpired(list, NOW + 1000).map((s) => s.id)).toEqual(["b"]);
  });
});

describe("visibleStatus", () => {
  test("nothing to show for an empty list", () => {
    expect(visibleStatus([])).toBeNull();
  });

  test("the most recent message wins", () => {
    let list = add([], "a", "old");
    list = add(list, "b", "new");
    expect(visibleStatus(list)!.text).toBe("new");
  });

  test("an error stays visible over a newer info message", () => {
    let list = add([], "a", "broken", { tone: "error" });
    list = add(list, "b", "fyi");
    expect(visibleStatus(list)!.text).toBe("broken");
  });
});
