import { getSessionUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { getClientIp, checkRateLimit } from "~/lib/rate-limit.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Anonymous by design — client errors on public share pages have no session —
  // but that also means an unauthenticated caller could flood the table with up
  // to ~7.5KB per row. Bound it by IP; a real client logs a handful of errors.
  const { allowed, retryAfterSeconds } = checkRateLimit(getClientIp(request), {
    windowMs: 60_000,
    max: 20,
    prefix: "client-error",
  });
  if (!allowed) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
  }

  const user = getSessionUser(request);

  let body: { message?: string; stack?: string; url?: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const message = String(body.message || "").slice(0, 2000);
  if (!message) return new Response("Bad request", { status: 400 });

  const stack = body.stack ? String(body.stack).slice(0, 5000) : null;
  const url = body.url ? String(body.url).slice(0, 500) : null;
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 500);

  db.prepare(
    "INSERT INTO client_errors (user_id, message, stack, url, user_agent) VALUES (?, ?, ?, ?, ?)"
  ).run(user?.id ?? null, message, stack, url, userAgent);

  return Response.json({ ok: true });
}
