import { test, expect, describe } from "bun:test";
import { canRestoreTrashItem, canPurgeTrashItem } from "~/lib/actions/trash-authz.server";

describe("canRestoreTrashItem", () => {
  test("viewer cannot restore", () => {
    expect(canRestoreTrashItem("viewer")).toBe(false);
  });

  test("editor can restore", () => {
    expect(canRestoreTrashItem("editor")).toBe(true);
  });

  test("admin can restore", () => {
    expect(canRestoreTrashItem("admin")).toBe(true);
  });

  test("owner can restore", () => {
    expect(canRestoreTrashItem("owner")).toBe(true);
  });

  test("non-member (null role) cannot restore", () => {
    expect(canRestoreTrashItem(null)).toBe(false);
  });
});

describe("canPurgeTrashItem", () => {
  const item = { created_by: "creator-1", deleted_by: "deleter-1" };

  test("owner can purge regardless of who created/deleted it", () => {
    expect(canPurgeTrashItem("owner", "someone-else", item)).toBe(true);
  });

  test("admin can purge regardless of who created/deleted it", () => {
    expect(canPurgeTrashItem("admin", "someone-else", item)).toBe(true);
  });

  test("editor who is the original creator can purge", () => {
    expect(canPurgeTrashItem("editor", "creator-1", item)).toBe(true);
  });

  test("editor who is the one who deleted it can purge", () => {
    expect(canPurgeTrashItem("editor", "deleter-1", item)).toBe(true);
  });

  test("viewer who is the original creator can purge", () => {
    expect(canPurgeTrashItem("viewer", "creator-1", item)).toBe(true);
  });

  test("plain editor with no special relation cannot purge", () => {
    expect(canPurgeTrashItem("editor", "someone-else", item)).toBe(false);
  });

  test("non-member (null role) with no special relation cannot purge", () => {
    expect(canPurgeTrashItem(null, "someone-else", item)).toBe(false);
  });

  test("handles a missing deleted_by (legacy row) without throwing", () => {
    expect(canPurgeTrashItem("editor", "someone-else", { created_by: "creator-1", deleted_by: null })).toBe(false);
    expect(canPurgeTrashItem("editor", "creator-1", { created_by: "creator-1", deleted_by: null })).toBe(true);
  });
});
