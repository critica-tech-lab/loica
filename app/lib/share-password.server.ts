/**
 * Signs and verifies the `__share_pwd_<token>` cookie set after a visitor
 * passes a share link's password check.
 *
 * The cookie used to be a bare "1" — unsigned, so anyone who learned the
 * cookie name (it's derived from the public token in the URL) could forge
 * it and skip the password entirely. The value is now
 * HMAC-SHA256(secret, token + ":" + share_password_hash), checked with a
 * timing-safe comparison. Binding the signature to the *current*
 * share_password_hash means changing or clearing the password changes or
 * clears that hash, which invalidates every cookie signed under the old
 * one — no separate revocation list needed.
 *
 * No `~` alias and no Bun-only APIs: ws/auth.ts (native Node, no Vite
 * resolver) imports this file via a relative path, so it only touches
 * node:crypto and a `better-sqlite3` handle passed in by the caller.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";

const SECRET_SETTING_KEY = "share_cookie_secret";

/**
 * Fetch the HMAC secret from `app_settings`, generating and persisting one
 * on first use. `INSERT OR IGNORE` plus a re-read makes this safe if the web
 * and ws processes both race to create it on first boot: whichever insert
 * wins, both processes end up reading the same persisted value.
 */
function getOrCreateSecret(db: Database.Database): string {
  const existing = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(SECRET_SETTING_KEY) as { value: string } | undefined;
  if (existing) return existing.value;

  const generated = randomBytes(32).toString("hex");
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run(
    SECRET_SETTING_KEY,
    generated
  );

  const persisted = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(SECRET_SETTING_KEY) as { value: string };
  return persisted.value;
}

function computeSignature(db: Database.Database, token: string, passwordHash: string): string {
  const secret = getOrCreateSecret(db);
  return createHmac("sha256", secret).update(`${token}:${passwordHash}`).digest("hex");
}

/** Cookie value to set after a successful password check for `token`. */
export function signSharePasswordCookie(
  db: Database.Database,
  token: string,
  passwordHash: string
): string {
  return computeSignature(db, token, passwordHash);
}

/**
 * Verify a cookie value against `token` and the share's current
 * `passwordHash`. False for a missing/forged cookie, one minted for a
 * different token, or one minted before the password changed or was removed.
 */
export function verifySharePasswordCookie(
  db: Database.Database,
  token: string,
  passwordHash: string,
  cookieValue: string | undefined
): boolean {
  if (!cookieValue) return false;

  const expected = computeSignature(db, token, passwordHash);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(cookieValue, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
