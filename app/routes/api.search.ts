import { getSessionUser } from "~/lib/auth.server";
import { searchDocuments } from "~/lib/document.server";

export async function loader({ request }: { request: Request }) {
  const user = getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

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
