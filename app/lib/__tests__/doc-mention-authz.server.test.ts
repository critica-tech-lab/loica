import { test, expect, describe } from "bun:test";
import { hasDocAccess, capMentionBody, MAX_MENTION_BODY_LENGTH } from "~/lib/doc-mention-authz.server";

describe("hasDocAccess", () => {
  test("workspace member has access", () => {
    expect(hasDocAccess({ role: "viewer", folderShared: false, docShared: false })).toBe(true);
  });

  test("folder-share recipient has access without membership", () => {
    expect(hasDocAccess({ role: null, folderShared: true, docShared: false })).toBe(true);
  });

  test("direct doc-share recipient has access without membership", () => {
    expect(hasDocAccess({ role: null, folderShared: false, docShared: true })).toBe(true);
  });

  test("a stranger with none of the three has no access", () => {
    expect(hasDocAccess({ role: null, folderShared: false, docShared: false })).toBe(false);
  });
});

describe("capMentionBody", () => {
  test("leaves a short body untouched", () => {
    expect(capMentionBody("hello")).toBe("hello");
  });

  test("truncates a body longer than the cap", () => {
    const body = "x".repeat(MAX_MENTION_BODY_LENGTH + 500);
    const capped = capMentionBody(body);
    expect(capped.length).toBe(MAX_MENTION_BODY_LENGTH);
  });
});
