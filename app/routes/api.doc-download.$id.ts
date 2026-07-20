import type { Route } from "./+types/api.doc-download.$id";
import { authorizeDocRead } from "~/lib/doc-access.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const doc = authorizeDocRead(request, params.id);

  const filename = (doc.title || "untitled").replace(/[^a-zA-Z0-9_\-. ]/g, "_") + ".md";

  return new Response(doc.content || "", {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
