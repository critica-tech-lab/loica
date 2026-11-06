import { describe, expect, test } from "bun:test";
import { SECURITY_HEADERS } from "../security-headers";

describe("SECURITY_HEADERS", () => {
  test("forbids sniffing, framing and cross-site referrers", () => {
    expect(SECURITY_HEADERS).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Referrer-Policy": "same-origin",
    });
  });

  // With `no-referrer`, browsers may send `Origin: null` on same-origin form
  // POSTs, which breaks the origin check on actions.
  test("keeps same-origin referrers so action POSTs still carry Origin", () => {
    expect(SECURITY_HEADERS["Referrer-Policy"]).not.toBe("no-referrer");
  });
});
