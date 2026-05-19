import { getSessionUser } from "~/lib/auth.server";
import { db } from "~/lib/db.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
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
