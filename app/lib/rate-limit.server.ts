/**
 * In-memory rate limiter keyed by IP address.
 * Suitable for single-process deployments (Loica's case).
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Prune expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

// How many reverse proxies sit in front of this app. X-Forwarded-For is
// read from the right, skipping this many trusted hops, so a client can't
// defeat rate limiting by prepending a fake entry of their own. Defaults to
// 0 (don't trust the header at all) since a Fetch API Request carries no
// raw socket address here to fall back on — see docs/deployment.md.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 0);

/**
 * Pick the client hop out of an X-Forwarded-For header, counted from the
 * right so a client can't defeat it by prepending a fake entry — the last
 * `trustProxyHops` entries are the proxies we actually trust, the one before
 * them is the real client. Returns null when there aren't enough hops to
 * trust (header shorter than expected, or trustProxyHops <= 0).
 */
export function pickForwardedHop(forwarded: string, trustProxyHops: number): string | null {
  if (trustProxyHops <= 0) return null;
  const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - trustProxyHops] ?? null;
}

export function getClientIp(request: Request): string {
  if (TRUST_PROXY_HOPS > 0) {
    const forwarded = request.headers.get("x-forwarded-for");
    const clientHop = forwarded ? pickForwardedHop(forwarded, TRUST_PROXY_HOPS) : null;
    if (clientHop) return clientHop;
  }
  // No trusted proxy configured, or too few hops in the header — don't
  // trust attacker-suppliable input. Every such request shares one bucket
  // rather than each forged header value getting its own.
  return "unproxied";
}

export function checkRateLimit(
  ip: string,
  opts: { windowMs: number; max: number; prefix?: string }
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const key = opts.prefix ? `${opts.prefix}:${ip}` : ip;
  let entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + opts.windowMs };
    store.set(key, entry);
  }

  entry.count++;

  if (entry.count > opts.max) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}
