import { test, expect, describe } from "bun:test";
import {
  resolveUserSearchMode,
  isSearchQueryTooShort,
  MIN_USER_SEARCH_QUERY_LENGTH,
} from "~/lib/user-search-authz.server";

describe("resolveUserSearchMode", () => {
  test("admin always gets the unrestricted search, scope/groupId notwithstanding", () => {
    expect(resolveUserSearchMode(true)).toBe("all");
    expect(resolveUserSearchMode(true, "mygroups")).toBe("all");
    expect(resolveUserSearchMode(true, undefined, "g1")).toBe("all");
  });

  test("non-admin with no scope and no groupId is restricted to shared context, not full search", () => {
    // This is the gap: previously fell through to the unrestricted query.
    expect(resolveUserSearchMode(false)).toBe("shared-context");
  });

  test("non-admin with explicit mygroups scope is restricted to their groups", () => {
    expect(resolveUserSearchMode(false, "mygroups")).toBe("my-groups");
  });

  test("non-admin with a groupId (add-to-group picker) is restricted to their groups", () => {
    expect(resolveUserSearchMode(false, undefined, "g1")).toBe("my-groups");
  });
});

describe("isSearchQueryTooShort", () => {
  test("rejects queries shorter than the minimum", () => {
    expect(isSearchQueryTooShort("")).toBe(true);
    expect(isSearchQueryTooShort("a")).toBe(true);
  });

  test("accepts queries at or above the minimum", () => {
    expect(isSearchQueryTooShort("ab")).toBe(false);
    expect(isSearchQueryTooShort("abc")).toBe(false);
  });

  test("minimum is 2", () => {
    expect(MIN_USER_SEARCH_QUERY_LENGTH).toBe(2);
  });
});
