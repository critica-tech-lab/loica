// Generic OIDC (Authorization Code + PKCE) sign-in for Loica.
//
// Provider-agnostic: works with any compliant IdP (Authentik, Keycloak, Google,
// a platform OIDC addon, …). Configured purely via env. The security-critical
// id_token signature/claims validation is delegated to `jose` (audited); the
// rest of the flow (discovery, redirect, token exchange) is plain HTTP here.
//
// Config accepts both bare `OIDC_*` and `CLOUDRON_OIDC_*` names so the same
// build lights up on a platform that injects the latter with no glue.

import { createRemoteJWKSet, jwtVerify } from "jose";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getPublicOrigin } from "~/lib/url.server";
import { findOrCreateUserViaExternalAuth, createSession, safeNextPath } from "~/lib/auth.server";

export const PROVIDER_ID = "oidc";
const CALLBACK_PATH = "/auth/oidc/callback";
const TX_COOKIE = "oidc_tx";
const TX_MAX_AGE = 600; // 10 minutes to complete the round-trip

const env = (k: string) => process.env[k] ?? "";
const ISSUER = (env("OIDC_ISSUER") || env("CLOUDRON_OIDC_ISSUER")).replace(/\/+$/, "");
const CLIENT_ID = env("OIDC_CLIENT_ID") || env("CLOUDRON_OIDC_CLIENT_ID");
const CLIENT_SECRET = env("OIDC_CLIENT_SECRET") || env("CLOUDRON_OIDC_CLIENT_SECRET");
const SCOPES = env("OIDC_SCOPES") || "openid email profile";
export const LABEL = env("OIDC_LABEL") || "Sign in with SSO";

export function isConfigured(): boolean {
  return Boolean(ISSUER && CLIENT_ID && CLIENT_SECRET);
}

// ─── Discovery (cached) ──────────────────────────────────
interface OidcMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
let _meta: Promise<OidcMeta> | null = null;
function discover(): Promise<OidcMeta> {
  if (!_meta) {
    const url = `${ISSUER}/.well-known/openid-configuration`;
    _meta = fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
        return (await r.json()) as OidcMeta;
      })
      .catch((e) => {
        _meta = null; // allow retry on the next request
        throw e;
      });
  }
  return _meta;
}

// ─── JWKS (cached; jose handles key rotation) ────────────
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(jwksUri: string) {
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(jwksUri));
  return _jwks;
}

// ─── Signed transaction cookie (state/nonce/verifier) ────
// HMAC with the client secret so a tampered or forged cookie is rejected.
function sign(payload: string): string {
  const mac = createHmac("sha256", CLIENT_SECRET).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}
function unsign(value: string): string | null {
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = value.slice(0, dot);
  const mac = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(
    createHmac("sha256", CLIENT_SECRET).update(payload).digest("base64url"),
  );
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  return payload;
}

function secureFlag(): string {
  return process.env.SECURE_COOKIE === "true" ? " Secure;" : "";
}
function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

interface Tx {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  // Where to send the user after a successful login (same-site path only).
  next?: string;
}

// ─── Step 1: start the flow ──────────────────────────────
export async function beginLogin(request: Request): Promise<Response> {
  const meta = await discover();

  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = getPublicOrigin(request) + CALLBACK_PATH;
  const next = safeNextPath(new URL(request.url).searchParams.get("next")) ?? undefined;

  const tx: Tx = { state, nonce, verifier, redirectUri, next };
  const txValue = sign(Buffer.from(JSON.stringify(tx)).toString("base64url"));
  const cookie =
    `${TX_COOKIE}=${encodeURIComponent(txValue)}; Path=/auth/oidc; HttpOnly; ` +
    `SameSite=Lax;${secureFlag()} Max-Age=${TX_MAX_AGE}`;

  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl.toString(), "Set-Cookie": cookie },
  });
}

// ─── Step 2: handle the callback ─────────────────────────
const clearTx =
  `${TX_COOKIE}=; Path=/auth/oidc; HttpOnly; SameSite=Lax;${process.env.SECURE_COOKIE === "true" ? " Secure;" : ""} Max-Age=0`;

export type CallbackResult =
  | { ok: true; sessionCookie: string; clearTx: string; next?: string }
  | { ok: false; error: string };

export async function handleCallback(request: Request): Promise<CallbackResult> {
  const url = new URL(request.url);

  const idpError = url.searchParams.get("error");
  if (idpError) return { ok: false, error: idpError };

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return { ok: false, error: "missing_code" };

  const raw = parseCookies(request.headers.get("Cookie") ?? "")[TX_COOKIE];
  if (!raw) return { ok: false, error: "missing_tx" };
  const payloadB64 = unsign(decodeURIComponent(raw));
  if (!payloadB64) return { ok: false, error: "bad_tx_signature" };
  let tx: Tx;
  try {
    tx = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Tx;
  } catch {
    return { ok: false, error: "bad_tx" };
  }

  // CSRF: state from the IdP must match the one we stashed.
  if (tx.state !== state) return { ok: false, error: "state_mismatch" };

  const meta = await discover();

  // Exchange the code for tokens (with PKCE verifier + client secret).
  const tokenResp = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: tx.redirectUri,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: tx.verifier,
    }),
  });
  if (!tokenResp.ok) return { ok: false, error: "token_exchange_failed" };
  const tokens = (await tokenResp.json()) as { id_token?: string };
  if (!tokens.id_token) return { ok: false, error: "no_id_token" };

  // The security-critical step: verify signature, issuer, audience, expiry.
  let claims;
  try {
    const { payload } = await jwtVerify(tokens.id_token, getJwks(meta.jwks_uri), {
      issuer: meta.issuer,
      audience: CLIENT_ID,
    });
    claims = payload;
  } catch {
    return { ok: false, error: "id_token_invalid" };
  }

  // Replay guard: nonce in the token must match the one we sent.
  if (claims.nonce !== tx.nonce) return { ok: false, error: "nonce_mismatch" };

  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const email = typeof claims.email === "string" ? claims.email : "";
  const name =
    (typeof claims.name === "string" && claims.name) ||
    (typeof claims.preferred_username === "string" && claims.preferred_username) ||
    email ||
    "User";
  if (!sub || !email) return { ok: false, error: "incomplete_claims" };

  const userId = findOrCreateUserViaExternalAuth({ provider: PROVIDER_ID, sub, email, name });
  const sessionCookie = createSession(userId);
  // Re-validate on the way out — the Tx cookie is signed, but defense in depth.
  return { ok: true, sessionCookie, clearTx, next: safeNextPath(tx.next) ?? undefined };
}
