import { hash, verify } from "@node-rs/argon2";
import { nanoid } from "nanoid";
import { db, prep } from "./db.server";
import { createWorkspace } from "./workspace.server";

// ─── Types ────────────────────────────────────────────────

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
};

// ─── Password validation ─────────────────────────────────

const COMMON_PASSWORDS = new Set([
  "password", "12345678", "123456789", "1234567890", "qwerty123",
  "password1", "iloveyou", "12341234", "abcdefgh", "abc12345",
  "qwertyui", "football", "baseball", "trustno1", "superman",
  "princess", "whatever", "sunshine", "passw0rd", "password123",
  "master12", "letmein1", "dragon12", "monkey12", "access14",
  "mustang1", "michael1", "shadow12", "charlie1", "welcome1",
  "abcd1234", "asdfghjk", "qwerty12", "1q2w3e4r", "aabbccdd",
]);

/**
 * Returns null if valid, or an error message string.
 * Rules: 8+ chars, at least one letter and one number, not a common password.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (!/[a-zA-Z]/.test(password)) {
    return "Password must contain at least one letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number.";
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "That password is too common. Please choose a different one.";
  }
  return null;
}

// ─── Cookie helpers ───────────────────────────────────────

const COOKIE_NAME = "__session";
const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days (seconds)

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq === -1) return [];
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      return [[key, decodeURIComponent(val)]];
    })
  );
}

// Only set Secure flag when explicitly enabled (i.e. behind HTTPS)
const useSecureCookie = process.env.SECURE_COOKIE === "true";

function makeSessionCookie(sessionId: string, expiresAt: number): string {
  const expires = new Date(expiresAt * 1000).toUTCString();
  const secure = useSecureCookie ? " Secure;" : "";
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax;${secure} Expires=${expires}`;
}

// ─── Session ──────────────────────────────────────────────

export function getSessionId(request: Request): string | null {
  const header = request.headers.get("Cookie") ?? "";
  const cookies = parseCookies(header);
  return cookies[COOKIE_NAME] ?? null;
}

export function invalidateOtherSessions(userId: string, keepSessionId?: string): void {
  if (keepSessionId) {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, keepSessionId);
  } else {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}

export function getSessionUser(request: Request): SessionUser | null {
  const header = request.headers.get("Cookie") ?? "";
  const cookies = parseCookies(header);
  const sessionId = cookies[COOKIE_NAME];
  if (!sessionId) return null;

  const now = Math.floor(Date.now() / 1000);

  const row = prep<{ id: string; email: string; name: string; is_admin: number }, [string, number]>(
      `SELECT u.id, u.email, u.name, u.is_admin
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`
    )
    .get(sessionId, now);

  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, is_admin: !!row.is_admin };
}

export function requireUser(request: Request): SessionUser {
  const user = getSessionUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

export function requireAdmin(request: Request): SessionUser {
  const user = getSessionUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  if (!user.is_admin) throw new Response("Forbidden", { status: 403 });
  return user;
}

// Probabilistic cleanup of expired sessions (runs ~1 in 20 calls)
function maybeCleanExpiredSessions() {
  if (Math.random() < 0.05) {
    db.prepare("DELETE FROM sessions WHERE expires_at < unixepoch()").run();
  }
}

export function createSession(userId: string): string {
  maybeCleanExpiredSessions();
  const id = nanoid(32);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL;
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(
    id,
    userId,
    expiresAt
  );
  return makeSessionCookie(id, expiresAt);
}

export function destroySession(request: Request): string {
  const header = request.headers.get("Cookie") ?? "";
  const cookies = parseCookies(header);
  const sessionId = cookies[COOKIE_NAME];
  if (sessionId) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
  const secure = useSecureCookie ? " Secure;" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=0`;
}

// ─── Users ────────────────────────────────────────────────

export async function createUser(
  email: string,
  name: string,
  password: string
): Promise<string> {
  const existing = prep<{ id: string }, [string]>("SELECT id FROM users WHERE email = ?")
    .get(email);
  if (existing) throw new Error("email_taken");

  const count = prep<{ c: number }, []>("SELECT COUNT(*) as c FROM users").get()!;
  const isAdmin = count.c === 0 ? 1 : 0;

  const id = nanoid(16);
  const passwordHash = await hash(password);
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)"
  ).run(id, email, name, passwordHash, isAdmin);
  return id;
}

export async function changeOwnPassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
  currentSessionId?: string
): Promise<void> {
  const row = prep<{ password_hash: string }, [string]>(
      "SELECT password_hash FROM users WHERE id = ?"
    )
    .get(userId);
  if (!row) throw new Error("not_found");

  const valid = await verify(row.password_hash, oldPassword);
  if (!valid) throw new Error("wrong_password");

  const newHash = await hash(newPassword);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, userId);
  invalidateOtherSessions(userId, currentSessionId);
}

export function updateProfile(
  userId: string,
  fields: { name?: string; email?: string }
): void {
  if (fields.email) {
    const existing = prep<{ id: string }, [string, string]>(
        "SELECT id FROM users WHERE email = ? AND id != ?"
      )
      .get(fields.email, userId);
    if (existing) throw new Error("email_taken");
  }

  if (fields.name !== undefined && fields.email !== undefined) {
    db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(
      fields.name,
      fields.email,
      userId
    );
  } else if (fields.name !== undefined) {
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(fields.name, userId);
  } else if (fields.email !== undefined) {
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(fields.email, userId);
  }
}

export async function verifyCredentials(
  email: string,
  password: string
): Promise<SessionUser | null> {
  const row = prep<
      { id: string; email: string; name: string; password_hash: string; is_admin: number },
      [string]
    >("SELECT id, email, name, password_hash, is_admin FROM users WHERE email = ?")
    .get(email);

  if (!row) {
    // Run hash anyway to prevent timing attacks on email enumeration
    await hash(password);
    return null;
  }

  const valid = await verify(row.password_hash, password);
  if (!valid) return null;

  return { id: row.id, email: row.email, name: row.name, is_admin: !!row.is_admin };
}

// ─── External auth providers (OIDC, OAuth, SAML…) ───────────

/** Profile returned by an auth-provider extension after a successful OIDC/OAuth flow. */
export interface ExternalAuthProfile {
  /** Stable extension id, e.g. "google", "saml". Used to namespace the `sub`. */
  provider: string;
  /** Stable subject identifier from the upstream IdP. */
  sub: string;
  /** Email claim (used for fallback matching when no link exists). */
  email: string;
  /** Display name (always populated; provider derives a sensible value). */
  name: string;
}

/**
 * Resolve an external-auth profile to a Loica user id, creating the user
 * the first time we see them. Auth-provider extensions call this from
 * their callback handler and pass the result to `createSession`.
 *
 * Lookup order: provider+sub → email → create new. Newly created users
 * become admin if they're the first user in the install (matches local
 * signup), and get a personal "My documents" workspace.
 */
export function findOrCreateUserViaExternalAuth(profile: ExternalAuthProfile): string {
  // 1. Match by provider+sub (existing linked user)
  const bySub = prep<{ id: string }, [string, string]>(
    "SELECT user_id as id FROM auth_links WHERE provider = ? AND sub = ?",
  ).get(profile.provider, profile.sub);
  if (bySub) {
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(profile.name, bySub.id);
    return bySub.id;
  }

  // 2. Match by email (link existing local-only user to provider)
  const byEmail = prep<{ id: string }, [string]>("SELECT id FROM users WHERE email = ?")
    .get(profile.email);
  if (byEmail) {
    db.prepare(
      "INSERT OR REPLACE INTO auth_links (user_id, provider, sub) VALUES (?, ?, ?)",
    ).run(byEmail.id, profile.provider, profile.sub);
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(profile.name, byEmail.id);
    return byEmail.id;
  }

  // 3. Create new user (first user becomes admin, gets a personal workspace)
  const count = prep<{ c: number }, []>("SELECT COUNT(*) as c FROM users").get()!;
  const isAdmin = count.c === 0 ? 1 : 0;

  const id = nanoid(16);
  const randomHash = nanoid(64); // Unmatchable placeholder — never a valid argon2 hash
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)",
  ).run(id, profile.email, profile.name, randomHash, isAdmin);
  db.prepare(
    "INSERT INTO auth_links (user_id, provider, sub) VALUES (?, ?, ?)",
  ).run(id, profile.provider, profile.sub);

  // Auto-create personal workspace.
  createWorkspace("My documents", id);

  return id;
}
