/**
 * Response headers that tell the browser how to treat Loica's pages.
 *
 * - nosniff: obey the declared content type, never guess one.
 * - frame-ancestors 'none': no other site can embed Loica (clickjacking).
 * - same-origin referrer: share links carry their token in the path, so a
 *   link followed to another site must not reveal the page it came from.
 */
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "same-origin",
} as const;
