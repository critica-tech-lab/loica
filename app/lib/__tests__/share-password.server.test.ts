import { test, expect, describe } from "bun:test";
import type Database from "better-sqlite3";
import { signSharePasswordCookie, verifySharePasswordCookie } from "~/lib/share-password.server";

// A minimal `app_settings` stand-in instead of a real better-sqlite3 handle:
// this environment's Bun crashes outright (NAPI fatal error) the moment any
// code constructs a real `new Database(...)`, for any file, including
// db.server.ts unmodified by this change — a pre-existing Bun/native-module
// issue, unrelated to this fix. The helper only ever does a keyed get/set
// against app_settings, so a tiny Map-backed fake exercises the exact same
// code path without touching the native driver.
function freshDb(): Database.Database {
  const store = new Map<string, string>();
  const fake = {
    prepare(sql: string) {
      if (sql.startsWith("SELECT")) {
        return { get: (key: string) => (store.has(key) ? { value: store.get(key)! } : undefined) };
      }
      if (sql.startsWith("INSERT OR IGNORE")) {
        return {
          run: (key: string, value: string) => {
            if (!store.has(key)) store.set(key, value);
          },
        };
      }
      throw new Error(`unexpected SQL in fake db: ${sql}`);
    },
  };
  return fake as unknown as Database.Database;
}

describe("share password cookie", () => {
  test("rejects the old forged '1' cookie", () => {
    const db = freshDb();
    expect(verifySharePasswordCookie(db, "tokenA", "hash1", "1")).toBe(false);
  });

  test("accepts a cookie it signed itself", () => {
    const db = freshDb();
    const cookie = signSharePasswordCookie(db, "tokenA", "hash1");
    expect(verifySharePasswordCookie(db, "tokenA", "hash1", cookie)).toBe(true);
  });

  test("rejects a cookie signed for a different token", () => {
    const db = freshDb();
    const cookie = signSharePasswordCookie(db, "tokenA", "hash1");
    expect(verifySharePasswordCookie(db, "tokenB", "hash1", cookie)).toBe(false);
  });

  test("rejects a cookie after the share password changes", () => {
    const db = freshDb();
    const cookie = signSharePasswordCookie(db, "tokenA", "hash1");
    expect(verifySharePasswordCookie(db, "tokenA", "hash2", cookie)).toBe(false);
  });

  test("rejects a cookie after the share password is removed", () => {
    const db = freshDb();
    const cookie = signSharePasswordCookie(db, "tokenA", "hash1");
    expect(verifySharePasswordCookie(db, "tokenA", "", cookie)).toBe(false);
  });

  test("rejects a missing cookie", () => {
    const db = freshDb();
    expect(verifySharePasswordCookie(db, "tokenA", "hash1", undefined)).toBe(false);
  });
});
