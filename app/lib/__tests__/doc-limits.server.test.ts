import { test, expect, describe } from "bun:test";
import { MAX_DOC_BYTES, assertDocSize } from "~/lib/doc-limits.server";

const HTTP_PAYLOAD_TOO_LARGE = 413;

function thrownStatus(fn: () => void): number | null {
  try {
    fn();
  } catch (err) {
    return err instanceof Response ? err.status : null;
  }
  return null;
}

describe("assertDocSize", () => {
  test("accepts content of exactly the limit", () => {
    expect(thrownStatus(() => assertDocSize("a".repeat(MAX_DOC_BYTES)))).toBeNull();
  });

  test("rejects content one byte over the limit with 413", () => {
    expect(thrownStatus(() => assertDocSize("a".repeat(MAX_DOC_BYTES + 1)))).toBe(
      HTTP_PAYLOAD_TOO_LARGE,
    );
  });

  test("measures bytes, not characters", () => {
    // "é" is 2 bytes in UTF-8: half the limit in characters is the limit in bytes.
    const atLimit = "é".repeat(MAX_DOC_BYTES / 2);
    expect(thrownStatus(() => assertDocSize(atLimit))).toBeNull();
    expect(thrownStatus(() => assertDocSize(atLimit + "a"))).toBe(HTTP_PAYLOAD_TOO_LARGE);
  });
});
