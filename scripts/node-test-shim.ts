/**
 * Minimal `bun:test` stand-in on top of node:test, used only by
 * scripts/test-db.mjs. It covers the matchers the *.dbtest.ts files use,
 * nothing more: add one here when a test needs it.
 *
 * Registrations are queued while the test files load and only handed to
 * node:test by replayAll(). node:test starts running at the first
 * registration, which would otherwise race with the files still loading.
 */
import assert from "node:assert/strict";
import * as nodeTest from "node:test";

type ErrorClass = new (...args: never[]) => Error;

interface Matchers {
  toBe(expected: unknown): void;
  toBeNull(): void;
  toBeDefined(): void;
  toThrow(expected?: ErrorClass): void;
}

function matchersFor(actual: unknown, negate: boolean): Matchers {
  return {
    toBe(expected) {
      if (negate) {
        assert.notStrictEqual(actual, expected);
        return;
      }
      assert.strictEqual(actual, expected);
    },
    toBeNull() {
      if (negate) {
        assert.notStrictEqual(actual, null);
        return;
      }
      assert.strictEqual(actual, null);
    },
    toBeDefined() {
      if (negate) {
        assert.strictEqual(actual, undefined);
        return;
      }
      assert.notStrictEqual(actual, undefined);
    },
    toThrow(expected) {
      if (negate) {
        assert.doesNotThrow(actual as () => unknown);
        return;
      }
      if (expected) {
        assert.throws(actual as () => unknown, expected);
        return;
      }
      assert.throws(actual as () => unknown);
    },
  };
}

export function expect(actual: unknown): Matchers & { not: Matchers } {
  return { ...matchersFor(actual, false), not: matchersFor(actual, true) };
}

const queued: Array<() => void> = [];
let replaying = false;

/** Queue a top-level registration; once replaying, pass nested ones straight through. */
function deferred<A extends unknown[]>(register: (...args: A) => unknown) {
  return (...args: A): void => {
    if (replaying) {
      register(...args);
      return;
    }
    queued.push(() => register(...args));
  };
}

export const describe = deferred(nodeTest.describe as (...args: unknown[]) => unknown);
export const test = deferred(nodeTest.test as (...args: unknown[]) => unknown);
export const afterAll = deferred(nodeTest.after as (...args: unknown[]) => unknown);
export const beforeAll = deferred(nodeTest.before as (...args: unknown[]) => unknown);

/** Hand every queued registration to node:test, in file order. */
export function replayAll(): void {
  replaying = true;
  for (const register of queued) {
    register();
  }
  queued.length = 0;
}
