import { describe, test, expect } from "bun:test";
import { buildRecentList, type RecentCandidate } from "~/lib/recent-docs";

function row(id: string, workspace = "My documents"): RecentCandidate {
  return { id, title: `Doc ${id}`, workspace_name: workspace, viewed_at: 100 };
}

describe("buildRecentList", () => {
  test("links a workspace member to the editor route", () => {
    const list = buildRecentList([row("a")], () => "member", 8);
    expect(list.length).toBe(1);
    expect(list[0].href).toBe("/w/doc/a");
  });

  test("links a share recipient to the shared route", () => {
    const list = buildRecentList([row("a")], () => "shared", 8);
    expect(list[0].href).toBe("/shared/doc/a");
  });

  test("drops docs the user can no longer open", () => {
    const list = buildRecentList([row("a"), row("b")], (r) => (r.id === "a" ? null : "member"), 8);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("b");
  });

  test("keeps order and stops at the limit", () => {
    const rows = ["a", "b", "c", "d"].map((id) => row(id));
    const list = buildRecentList(rows, () => "member", 2);
    expect(list.length).toBe(2);
    expect(list[0].id).toBe("a");
    expect(list[1].id).toBe("b");
  });

  test("an inaccessible row does not use up a slot of the limit", () => {
    const rows = ["a", "b", "c"].map((id) => row(id));
    const list = buildRecentList(rows, (r) => (r.id === "a" ? null : "member"), 2);
    expect(list.length).toBe(2);
    expect(list[0].id).toBe("b");
    expect(list[1].id).toBe("c");
  });
});
