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

/**
 * Compute the WebSocket URL the browser should use to reach the Yjs server.
 *
 * Order:
 *   1. `WS_URL` env var — explicit override (e.g. `wss://docs.example.com/ws`).
 *   2. Behind a TLS-terminating reverse proxy (Caddy, Cloudron, …): a
 *      same-origin path the proxy routes to the WS server, e.g.
 *      `wss://docs.example.com/ws`. We never expose the raw WS port publicly.
 *      Proxy is detected via `X-Forwarded-Proto` (or an explicit `SITE_URL`).
 *   3. Direct / local dev: the standalone WS server on its own port,
 *      e.g. `ws://localhost:4001`.
 *
 * The scheme is derived from `getPublicOrigin`, so it is `wss:` whenever the
 * browser reached us over HTTPS — even though the app itself sees plain HTTP
 * behind the proxy. This avoids the mixed-content failure that a naive
 * `new URL(request.url)` scheme check produces.
 */
export function getWebSocketUrl(request: Request): string {
  if (process.env.WS_URL) return process.env.WS_URL;

  const origin = new URL(getPublicOrigin(request));
  const scheme = origin.protocol === "https:" ? "wss:" : "ws:";

  const behindProxy = request.headers.has("x-forwarded-proto") || !!process.env.SITE_URL;
  if (behindProxy) {
    return `${scheme}//${origin.host}${process.env.WS_PATH ?? "/ws"}`;
  }

  const port = process.env.WS_PORT ?? "4001";
  return `${scheme}//${origin.hostname}:${port}`;
}
