import { redirect, useLoaderData } from "react-router";
import type { MetaFunction, ShouldRevalidateFunctionArgs } from "react-router";
import type { Route } from "./+types/workspace.doc.$id";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
import { getWorkspace, getMembership } from "~/lib/workspace.server";
import { getPublicOrigin, getWebSocketUrl } from "~/lib/url.server";
import {
  getDocument,
  updateDocument,
  trashDocument,
  setViewShare,
  setEditShare,
  updateShareSettings,
  createDocumentVersion,
  restoreDocumentVersion,
  recordRecentDoc,
  isStarred,
  toggleStar,
} from "~/lib/document.server";
import { shareDocWithUser, shareDocWithGroup, shareDocWithExternal, unshareDoc, hasDocSharedAccess } from "~/lib/doc-sharing.server";
import { hasSharedAccess } from "~/lib/sharing.server";
import { getClientIp, checkRateLimit } from "~/lib/rate-limit.server";
import { getUserGroups } from "~/lib/group.server";
import { sendMentionNotification, sendExternalShareNotification } from "~/lib/email.server";
import { db, prep } from "~/lib/db.server";
import { emailSchema } from "~/lib/validation.server";
import { getFolderPath } from "~/lib/folder.server";
import type { BreadcrumbSegment } from "~/lib/folder.server";
import { DocEditorView } from "~/components/DocEditorView";
import { FilePreview } from "~/components/FilePreview";
import { DocumentProvider } from "~/lib/DocumentContext";
import type { DocumentProps } from "~/lib/DocumentContext";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const d = data as { document?: { title?: string } } | undefined;
  return [{ title: `${d?.document?.title ?? "Document"} — loica` }];
};

export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  const intent = formData?.get("intent");
  // Skip loader revalidation after auto-save — content is synced via Yjs WebSocket.
  // Also skip for toggle-star since the UI uses optimistic updates.
  if (intent === "save" || intent === "toggle-star" || intent === "send-mentions") return false;
  return defaultShouldRevalidate;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);

  const document = getDocument(params.id);
  if (!document) throw new Response("Document not found", { status: 404 });

  const workspace = getWorkspace(document.workspace_id);
  if (!workspace) throw new Response("Not found", { status: 404 });

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role) {
    // User may have access via a share — redirect to the shared doc route
    const hasFolderAccess = document.folder_id && hasSharedAccess(document.folder_id, user.id);
    const hasDocAccess = hasDocSharedAccess(document.id, user.id);
    if (hasFolderAccess || hasDocAccess) throw redirect(`/shared/doc/${params.id}`);
    throw new Response("Not found", { status: 404 });
  }

  const folderPath: BreadcrumbSegment[] = document.folder_id
    ? getFolderPath(document.folder_id)
    : [];

  const userGroups = getUserGroups(user.id);

  try { recordRecentDoc(user.id, params.id); } catch { /* non-critical */ }
  const starred = isStarred(user.id, params.id);

  const userIds = [document.created_by, document.updated_by].filter(
    (id): id is string => !!id && id !== "guest" && !id.startsWith("ext:")
  );
  const userNames: Record<string, string | null> = {};
  if (userIds.length > 0) {
    const placeholders = userIds.map(() => "?").join(",");
    const rows = prep<{ id: string; name: string | null }, string[]>(
      `SELECT id, name FROM users WHERE id IN (${placeholders})`
    ).all(...userIds);
    for (const r of rows) userNames[r.id] = r.name;
  }
  const creator = document.created_by ? { name: userNames[document.created_by] ?? null } : null;
  const modifier = document.updated_by === "guest"
    ? { name: "Guest" }
    : document.updated_by?.startsWith("ext:")
      ? { name: document.updated_by.slice(4) }
      : document.updated_by
        ? { name: userNames[document.updated_by] ?? null }
        : null;

  const wsUrl = getWebSocketUrl(request);

  return {
    workspace,
    role,
    document: { ...document, content: document.pdf_file ? document.content : "" },
    user,
    folderPath,
    userGroups,
    starred,
    creatorName: creator?.name ?? null,
    modifierName: modifier?.name ?? null,
    wsUrl,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const doc = getDocument(params.id);
  if (!doc) throw new Response("Not found", { status: 404 });

  const workspace = getWorkspace(doc.workspace_id);
  if (!workspace) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggle-star") {
    const newState = toggleStar(user.id, params.id);
    return { starred: newState };
  }

  const role = getMembership(workspace.id, user.id, user.is_admin);
  if (!role || role === "viewer") throw new Response("Forbidden", { status: 403 });

  if (intent === "save") {
    const title = form.get("title");
    const content = form.get("content");
    try {
      updateDocument(params.id, {
        ...(title != null ? { title: String(title) } : {}),
        ...(content != null ? { content: String(content) } : {}),
      }, user.id);
    } catch (err) {
      console.error("[doc action] save failed:", err);
      return { ok: false };
    }
    return { ok: true };
  }

  if (intent === "save-version") {
    createDocumentVersion(params.id, user.id, false);
    return { savedVersion: true };
  }

  if (intent === "restore-version") {
    const versionId = form.get("versionId");
    if (!versionId) throw new Response("Missing versionId", { status: 400 });
    const result = await restoreDocumentVersion(params.id, String(versionId), user.id);
    if (!result) throw new Response("Version not found", { status: 404 });
    const updated = getDocument(params.id);
    return {
      restored: true,
      title: updated!.title,
      content: updated!.content,
      backupVersionId: result.backupVersionId,
    };
  }

  if (intent === "toggle-doc-view") {
    const enabled = form.get("enabled") === "true";
    const token = await setViewShare(params.id, enabled);
    const updated = getDocument(params.id);
    return { viewToken: token, shareExpiresAt: updated?.share_expires_at ?? null, hasPassword: !!updated?.share_password_hash };
  }
  if (intent === "toggle-doc-edit") {
    const enabled = form.get("enabled") === "true";
    const token = await setEditShare(params.id, enabled);
    const updated = getDocument(params.id);
    return { editToken: token, shareExpiresAt: updated?.share_expires_at ?? null, hasPassword: !!updated?.share_password_hash };
  }

  if (intent === "share-doc") {
    const rl = checkRateLimit(getClientIp(request), { windowMs: 5 * 60 * 1000, max: 20, prefix: "share" });
    if (!rl.allowed) return { ok: false, error: "Too many share requests. Try again later." };
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (!email) return { ok: false, error: "Missing email" };
    if (!emailSchema.safeParse(email).success) {
      return { ok: false, error: "Please enter a valid email address" };
    }
    const targetUser = prep<{ id: string }, [string]>(
      "SELECT id FROM users WHERE email = ?"
    ).get(email);
    if (!targetUser) {
      // External user — create per-invite token
      const { token: inviteToken } = shareDocWithExternal(params.id, email, user.id);
      const origin = getPublicOrigin(request);
      const editUrl = `${origin}/s/${inviteToken}`;
      const doc = getDocument(params.id);
      const sharerName = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?").get(user.id)?.name ?? "Someone";
      sendExternalShareNotification(email, doc?.title ?? "Untitled", sharerName, editUrl);
      return { ok: true, sharedWith: email };
    }
    if (targetUser.id === user.id) return { ok: false, error: "Cannot share with yourself" };
    const targetName = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?").get(targetUser.id)?.name ?? email;
    shareDocWithUser(params.id, targetUser.id, user.id, getPublicOrigin(request));
    return { ok: true, sharedWith: targetName };
  }

  if (intent === "unshare-doc") {
    const shareId = String(form.get("shareId") || "");
    if (!shareId) throw new Response("Missing shareId", { status: 400 });
    unshareDoc(shareId);
    return { ok: true };
  }

  if (intent === "share-doc-group") {
    const rl = checkRateLimit(getClientIp(request), { windowMs: 5 * 60 * 1000, max: 20, prefix: "share" });
    if (!rl.allowed) throw new Response("Too many share requests. Try again later.", { status: 429 });
    const groupId = String(form.get("groupId") || "").trim();
    if (!groupId) throw new Response("Missing groupId", { status: 400 });
    shareDocWithGroup(params.id, groupId, user.id, getPublicOrigin(request));
    return { ok: true };
  }

  if (intent === "unshare-doc-group") {
    const shareId = String(form.get("shareId") || "");
    if (!shareId) throw new Response("Missing shareId", { status: 400 });
    unshareDoc(shareId);
    return { ok: true };
  }

  if (intent === "send-mentions") {
    const rl = checkRateLimit(getClientIp(request), { windowMs: 5 * 60 * 1000, max: 20, prefix: "mention" });
    if (!rl.allowed) return { ok: false };
    const body = String(form.get("body") || "");
    const mentionRegex = /@\[(.+?)\]\(user:(.+?)\)/g;
    let match: RegExpExecArray | null;
    const origin = getPublicOrigin(request);
    const docUrl = `${origin}${workspace.type === 'team' ? `/t/${workspace.id}` : '/w'}/doc/${params.id}`;
    while ((match = mentionRegex.exec(body)) !== null) {
      const mentionedUserId = match[2];
      if (mentionedUserId === user.id) continue;
      const mentioned = prep<{ email: string; name: string }, [string]>(
        "SELECT email, name FROM users WHERE id = ?"
      ).get(mentionedUserId);
      if (mentioned) {
        sendMentionNotification(
          mentioned.email,
          mentioned.name,
          user.name,
          doc.title,
          body,
          docUrl
        );
      }
    }
    return { ok: true };
  }

  if (intent === "trash-doc") {
    const isOwner = role === "owner" || role === "admin";
    if (!isOwner && doc.created_by !== user.id) throw new Response("Forbidden", { status: 403 });
    trashDocument(params.id, user.id);
    // Send the user back to where they came from (parent folder → workspace root).
    const redirectTo = doc.folder_id
      ? `/w/folder/${doc.folder_id}`
      : workspace.type === "team" ? `/t/${workspace.id}` : "/w";
    throw redirect(redirectTo);
  }

  if (intent === "update-share-settings") {
    const docId = String(form.get("docId"));
    const document = getDocument(docId);
    if (!document || document.workspace_id !== doc.workspace_id) return null;

    const expiresAtRaw = form.get("expiresAt");
    // undefined = not submitted (don't touch), null = clear, number = set
    const expiresAt = expiresAtRaw !== null
      ? (String(expiresAtRaw) ? Math.floor(new Date(String(expiresAtRaw)).getTime() / 1000) : null)
      : undefined;

    const password = form.get("sharePassword");
    const clearPassword = form.get("clearPassword") === "true";

    await updateShareSettings(docId, {
      expiresAt,
      password: clearPassword ? null : (password ? String(password) : undefined),
    });

    const updated = getDocument(docId);
    return { ok: true, shareExpiresAt: updated?.share_expires_at ?? null, hasPassword: !!updated?.share_password_hash };
  }

  return null;
}


function WorkspaceFilePreview({ document, workspace, user, folderPath, starred }: {
  document: { id: string; title: string; pdf_file: string; public_token: string | null; edit_token: string | null };
  workspace: { id: string; type: string };
  user: { id: string; name: string; is_admin?: boolean | number };
  folderPath: BreadcrumbSegment[];
  starred: boolean;
}) {
  const isTeamspace = workspace.type === "team";
  const baseUrl = isTeamspace ? `/t/${workspace.id}` : "/w";
  const bcLinkStyle: React.CSSProperties = { opacity: 0.4, color: "var(--fg)", textDecoration: "none", fontSize: "var(--fs-xs)" };

  return (
    <FilePreview
      document={document}
      user={user}
      starred={starred}
      breadcrumbs={folderPath.map((seg) => (
        <span key={seg.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <a href={`${baseUrl}/folder/${seg.id}`} style={bcLinkStyle}>{seg.name}</a>
          <span style={{ opacity: 0.2, fontSize: "var(--fs-xs)", flexShrink: 0 }}>/</span>
        </span>
      ))}
    />
  );
}

export default function DocEditor() {
  const { workspace, role, document, user, folderPath, wsUrl, starred, creatorName, modifierName } = useLoaderData<typeof loader>();

  if (document.pdf_file) {
    return (
      <WorkspaceFilePreview
        document={{ ...document, pdf_file: document.pdf_file }}
        workspace={workspace}
        user={user}
        folderPath={folderPath}
        starred={starred}
      />
    );
  }

  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const isTeamspace = workspace.type === "team";
  const baseUrl = isTeamspace ? `/t/${workspace.id}` : "/w";

  const docProps = {
    document,
    workspace,
    user,
    role,
    canEdit,
    folderPath,
    wsUrl,
    starred,
    creatorName,
    modifierName,
    isShared: false as const,
    baseUrl,
    sidebar: null,
  } as unknown as DocumentProps;

  return (
    <DocumentProvider {...docProps}>
      <DocEditorView {...docProps} />
    </DocumentProvider>
  );
}
