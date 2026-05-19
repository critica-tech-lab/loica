/**
 * Compute the public-facing origin (scheme + host) for a request.
 *
 * Loica runs behind Caddy in production, so `request.url` looks like
 * `http://localhost:3000/...` even when clients reached us over HTTPS.
 * Using that raw origin in outbound email links leaks plain `http://`
 * URLs that don't resolve. We prefer, in order:
 *   1. `SITE_URL` env var (explicit override — set in systemd unit)
 *   2. `X-Forwarded-Proto` + `X-Forwarded-Host` (Caddy/reverse proxies)
 *   3. The raw request URL's origin (last resort; works in local dev)
 */
export function getPublicOrigin(request: Request): string {
  const envUrl = process.env.SITE_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");

  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (proto && host) return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;

  return new URL(request.url).origin;
}
