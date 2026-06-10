import { getSessionUser } from "~/lib/auth.server";
import { getDocument, getDocumentHistory } from "~/lib/document.server";
import { getWorkspace, getMembership } from "~/lib/workspace.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const user = getSessionUser(request);
    if (!user) return { sessions: [] };

    const docId = params.id!;
    const doc = getDocument(docId);
    if (!doc) return { sessions: [] };

    const workspace = getWorkspace(doc.workspace_id);
    if (!workspace) return { sessions: [] };

    const role = getMembership(workspace.id, user.id, user.is_admin);
    if (!role) return { sessions: [] };

    const sessions = getDocumentHistory(docId);
    return { sessions };
  } catch {
    return { sessions: [] };
  }
}
