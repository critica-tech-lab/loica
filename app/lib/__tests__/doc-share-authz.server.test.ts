import { test, expect, describe } from "bun:test";
import { canShareDocWithGroup } from "~/lib/doc-share-authz.server";

describe("canShareDocWithGroup", () => {
  test("rejects a group that doesn't exist", () => {
    expect(
      canShareDocWithGroup({ group: null, docWorkspaceId: "w1", callerIsGroupMember: false })
    ).toBe(false);
  });

  test("allows a group that belongs to the doc's own workspace", () => {
    expect(
      canShareDocWithGroup({
        group: { workspace_id: "w1" },
        docWorkspaceId: "w1",
        callerIsGroupMember: false,
      })
    ).toBe(true);
  });

  test("rejects a group from a different workspace when the caller isn't a member", () => {
    expect(
      canShareDocWithGroup({
        group: { workspace_id: "w2" },
        docWorkspaceId: "w1",
        callerIsGroupMember: false,
      })
    ).toBe(false);
  });

  test("allows a group from a different workspace when the caller is a member of it", () => {
    expect(
      canShareDocWithGroup({
        group: { workspace_id: "w2" },
        docWorkspaceId: "w1",
        callerIsGroupMember: true,
      })
    ).toBe(true);
  });

  test("a workspace-less group requires caller membership", () => {
    expect(
      canShareDocWithGroup({
        group: { workspace_id: null },
        docWorkspaceId: "w1",
        callerIsGroupMember: false,
      })
    ).toBe(false);
    expect(
      canShareDocWithGroup({
        group: { workspace_id: null },
        docWorkspaceId: "w1",
        callerIsGroupMember: true,
      })
    ).toBe(true);
  });
});
