import { test, expect, describe } from "bun:test";
import { pickForwardedHop, getClientIp, checkRateLimit } from "~/lib/rate-limit.server";

describe("pickForwardedHop", () => {
  // Each trusted proxy appends the address of whoever connected to IT
  // directly, so with a clean 1-proxy chain the header is "client, and
  // nothing else appended past it" — the value picked with 1 trusted hop
  // is the LAST entry (the one the sole trusted proxy actually observed).
  test("with 1 trusted hop, picks the last entry", () => {
    expect(pickForwardedHop("1.1.1.1, 10.0.0.1", 1)).toBe("10.0.0.1");
  });

  test("with 2 trusted hops, picks the 2nd-from-last entry", () => {
    expect(pickForwardedHop("1.1.1.1, 10.0.0.1, 10.0.0.2", 2)).toBe("10.0.0.1");
  });

  test("an attacker-prepended fake entry can't shift the trusted hop", () => {
    // Attacker connects straight to the (1) trusted proxy and sets their own
    // XFF header, prepending fake entries ("9.9.9.9, 1.1.1.1") hoping to
    // spoof a different client IP. The proxy still appends the attacker's
    // real observed IP ("10.0.0.1") as the LAST entry — counting from the
    // right always lands there, no matter how much junk is prepended.
    const spoofed = "9.9.9.9, 1.1.1.1, 10.0.0.1";
    expect(pickForwardedHop(spoofed, 1)).toBe("10.0.0.1");
  });

  test("returns null when the header has fewer hops than trusted", () => {
    expect(pickForwardedHop("10.0.0.1", 2)).toBeNull();
  });

  test("returns null when trustProxyHops is 0 or negative", () => {
    expect(pickForwardedHop("1.1.1.1, 10.0.0.1", 0)).toBeNull();
    expect(pickForwardedHop("1.1.1.1, 10.0.0.1", -1)).toBeNull();
  });

  test("tolerates irregular whitespace and empty segments", () => {
    expect(pickForwardedHop("1.1.1.1 ,, 10.0.0.1", 1)).toBe("10.0.0.1");
  });
});

describe("getClientIp", () => {
  // TRUST_PROXY_HOPS defaults to 0 in this process (no env var set), which
  // is the safe-by-default posture: never trust XFF unless explicitly
  // configured to. This is the behavior every deployment gets out of the box.
  test("ignores X-Forwarded-For entirely when no proxy is trusted", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.1.1.1, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("unproxied");
  });

  test("falls back to the shared bucket when the header is missing", () => {
    const req = new Request("http://x");
    expect(getClientIp(req)).toBe("unproxied");
  });
});

describe("checkRateLimit", () => {
  test("allows requests under the max, blocks once exceeded", () => {
    const opts = { windowMs: 60_000, max: 2, prefix: `test-${Date.now()}` };
    const ip = "203.0.113.1";
    expect(checkRateLimit(ip, opts).allowed).toBe(true);
    expect(checkRateLimit(ip, opts).allowed).toBe(true);
    const third = checkRateLimit(ip, opts);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("different prefixes/IPs don't share a bucket", () => {
    const windowMs = 60_000;
    const ip = "203.0.113.2";
    const a = checkRateLimit(ip, { windowMs, max: 1, prefix: `a-${Date.now()}` });
    const b = checkRateLimit(ip, { windowMs, max: 1, prefix: `b-${Date.now()}` });
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });
});
