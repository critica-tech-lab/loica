import { getSessionUser } from "~/lib/auth.server";
import { searchDocuments } from "~/lib/document.server";
import { getRateLimitKey, checkRateLimit } from "~/lib/rate-limit.server";

export async function loader({ request }: { request: Request }) {
  const user = getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const rl = checkRateLimit(getRateLimitKey(request, user.id), { windowMs: 60_000, max: 60, prefix: "search" });
  if (!rl.allowed) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSeconds) },
    });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  if (!q.trim()) return Response.json([]);

  try {
    const results = searchDocuments(user.id, q);
    return Response.json(results);
  } catch (error) {
    console.error("[search]", error);
    return Response.json([]);
  }
}
