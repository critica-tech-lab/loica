import { test, expect, describe } from "bun:test";
import { isAbortError } from "~/lib/abort-error";

describe("isAbortError", () => {
  test("recognizes an error named AbortError", () => {
    const err = new Error("anything");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
  });

  test("recognizes a DOMException AbortError", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  test("recognizes the message each browser uses, even without the name", () => {
    expect(isAbortError(new Error("The operation was aborted."))).toBe(true); // Safari
    expect(isAbortError(new Error("signal is aborted without reason"))).toBe(true); // Chrome
    expect(isAbortError(new Error("The user aborted a request."))).toBe(true); // Chrome, older
  });

  test("recognizes a bare message string, as the error reporter receives it", () => {
    expect(isAbortError("The operation was aborted.")).toBe(true);
  });

  test("does not swallow other failures", () => {
    expect(isAbortError(new Error("Failed to fetch"))).toBe(false);
    expect(isAbortError(new Error("Transaction aborted by user"))).toBe(false);
    expect(isAbortError(new TypeError("x is not a function"))).toBe(false);
  });

  test("ignores values that are not errors", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError(42)).toBe(false);
    expect(isAbortError({})).toBe(false);
  });
});
