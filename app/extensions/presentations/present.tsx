import { redirect, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import { getWorkspace, getMembership } from "~/lib/workspace.server";
import { getDocument } from "~/lib/document.server";
import { hasSharedAccess } from "~/lib/sharing.server";
import { hasDocSharedAccess } from "~/lib/doc-sharing.server";
import { getEnabledExtensionIdSet } from "~/extensions/index.server";
import { PresentView } from "./PresentView";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const title = (data as { docTitle?: string } | undefined)?.docTitle ?? "Presenting";
  return [{ title: `Presenting: ${title} — loica` }];
};

export async function loader({ request, params }: { request: Request; params: { id: string } }) {
  // Extension disabled by admin → present route is dead.
  if (!getEnabledExtensionIdSet().has("presentations")) {
    throw new Response("Not found", { status: 404 });
  }

  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const document = getDocument(params.id);
  if (!document) throw new Response("Document not found", { status: 404 });

  const workspace = getWorkspace(document.workspace_id);
  if (!workspace) throw new Response("Not found", { status: 404 });

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role) {
    // Shared access → redirect to the shared presenting route
    const hasFolderAccess = document.folder_id && hasSharedAccess(document.folder_id, user.id);
    const hasDocAccess = hasDocSharedAccess(document.id, user.id);
    if (hasFolderAccess || hasDocAccess) throw redirect(`/shared/doc/${params.id}/present`);
    throw new Response("Not authorized", { status: 403 });
  }

  return {
    docId: document.id,
    docTitle: document.title,
    content: document.content ?? "",
  };
}

export default function WorkspaceDocPresent() {
  const { docId, docTitle, content } = useLoaderData<typeof loader>();
  return <PresentView content={content} title={docTitle} exitHref={`/w/doc/${docId}`} />;
}
