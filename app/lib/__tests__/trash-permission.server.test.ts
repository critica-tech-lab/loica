import { describe, expect, test } from "bun:test";
import { canManageTrash } from "../trash-permission.server";

describe("canManageTrash", () => {
  test("rejects non-members", () => {
    expect(canManageTrash(null)).toBe(false);
  });

  test("rejects viewers, who are read-only", () => {
    expect(canManageTrash("viewer")).toBe(false);
  });

  test.each(["owner", "admin", "editor"] as const)("allows %s", (role) => {
    expect(canManageTrash(role)).toBe(true);
  });
});
