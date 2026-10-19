import { redirect, useFetcher, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/shared.doc.$id";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
import {
  getDocument,
  updateDocument,
  setViewShare,
  setEditShare,
  updateShareSettings,
  createDocumentVersion,
  restoreDocumentVersion,
  isStarred as checkStarred,
  toggleStar,
} from "~/lib/document.server";
import type { BreadcrumbSegment } from "~/lib/folder.server";
import { getWorkspace } from "~/lib/workspace.server";
import { getPublicOrigin, getEmailOrigin, getWebSocketUrl } from "~/lib/url.server";
import { getSharedFolderPath } from "~/lib/sharing.server";
import { getUserDocAccess } from "~/lib/doc-access.server";
import { isShareAccess } from "~/lib/doc-permission.server";
import { appError } from "~/lib/errors";
import { acceptPendingDocShare, shareDocWithUser, shareDocWithGroup, shareDocWithExternal, unshareDoc } from "~/lib/doc-sharing.server";
import { userHasDocAccess } from "~/lib/doc-access.server";
import { capMentionBody } from "~/lib/doc-mention-authz.server";
import { isRoomLive, shouldRejectContentWrite } from "~/lib/ws-notify.server";
import { getRateLimitKey, checkRateLimit } from "~/lib/rate-limit.server";
import { sendMentionNotification, sendExternalShareNotification } from "~/lib/email.server";
import { db, prep } from "~/lib/db.server";
import { emailSchema, sharePasswordSchema } from "~/lib/validation.server";
import { DocEditorView } from "~/components/DocEditorView";
import { FilePreview } from "~/components/FilePreview";
import { DocumentProvider } from "~/lib/DocumentContext";
import type { DocumentProps } from "~/lib/DocumentContext";
import { useSessionUser } from "~/root";

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const d = loaderData as { document?: { title?: string } } | undefined;
  return [{ title: `${d?.document?.title ?? "Document"} (shared) — loica` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);

  const document = getDocument(params.id);
  if (!document) throw appError("doc_not_found");

  let access = getUserDocAccess(document, user);

  // Auto-accept pending doc shares when the recipient clicks the email link
  if (!access && acceptPendingDocShare(document.id, user.id)) {
    access = getUserDocAccess(document, user);
  }

  if (!access) throw appError("no_doc_access", { subject: document.title });

  // Workspace members and admins belong on the canonical doc route
  if (!isShareAccess(access)) throw redirect(`/w/doc/${params.id}`);

  const hasFolderAccess = access.via.includes("folder-share");

  const workspace = getWorkspace(document.workspace_id);
  if (!workspace) throw appError("workspace_not_found");

  // Only breadcrumb the folders this user can open. A doc-only share grants no
  // folder access at all, so its trail is empty rather than a chain of 403s (#93).
  const folderPath: BreadcrumbSegment[] =
    document.folder_id && hasFolderAccess
      ? getSharedFolderPath(document.folder_id, user.id)
      : [];

  const starred = checkStarred(user.id, params.id);

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

  return {
    workspace,
    document: {
      ...document,
      content: document.pdf_file ? document.content : "",
      public_token: document.public_token ?? null,
      edit_token: document.edit_token ?? null,
    },
    user,
    folderPath,
    starred,
    creatorName: creator?.name ?? null,
    modifierName: modifier?.name ?? null,
    wsUrl: getWebSocketUrl(request),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const doc = getDocument(params.id);
  if (!doc) throw new Response("Not found", { status: 404 });
  const access = getUserDocAccess(doc, user);
  if (!access || !isShareAccess(access)) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggle-star") {
    const newState = toggleStar(user.id, params.id);
    return { starred: newState };
  }

  if (intent === "save") {
    const title = form.get("title");
    const content = form.get("content");
    // See workspace.doc.$id.tsx's identical guard — a live Yjs room owns
    // this doc's content, so a direct write here would just be lost to the
    // room's next debounced save.
    if (content != null && shouldRejectContentWrite(true, await isRoomLive(params.id))) {
      return { ok: false, error: "Document is being edited live — content not saved." };
    }
    updateDocument(params.id, {
      ...(title != null ? { title: String(title) } : {}),
      ...(content != null ? { content: String(content) } : {}),
    }, user.id);
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
    const rl = checkRateLimit(getRateLimitKey(request, user.id), { windowMs: 5 * 60 * 1000, max: 20, prefix: "share" });
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
      const origin = getEmailOrigin();
      const editUrl = origin ? `${origin}/s/${inviteToken}` : null;
      const doc = getDocument(params.id);
      const sharerName = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?").get(user.id)?.name ?? "Someone";
      sendExternalShareNotification(email, doc?.title ?? "Untitled", sharerName, editUrl);
      return { ok: true, sharedWith: email };
    }
    if (targetUser.id === user.id) return { ok: false, error: "Cannot share with yourself" };
    const targetName = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?").get(targetUser.id)?.name ?? email;
    shareDocWithUser(params.id, targetUser.id, user.id, getEmailOrigin() ?? undefined);
    return { ok: true, sharedWith: targetName };
  }

  if (intent === "unshare-doc") {
    const shareId = String(form.get("shareId") || "");
    if (!shareId) throw new Response("Missing shareId", { status: 400 });
    unshareDoc(shareId, doc.workspace_id);
    return { ok: true };
  }

  if (intent === "share-doc-group") {
    const groupId = String(form.get("groupId") || "").trim();
    if (!groupId) throw new Response("Missing groupId", { status: 400 });
    shareDocWithGroup(params.id, groupId, user.id, getEmailOrigin() ?? undefined);
    return { ok: true };
  }

  if (intent === "unshare-doc-group") {
    const shareId = String(form.get("shareId") || "");
    if (!shareId) throw new Response("Missing shareId", { status: 400 });
    unshareDoc(shareId, doc.workspace_id);
    return { ok: true };
  }

  if (intent === "send-mentions") {
    const rl = checkRateLimit(getRateLimitKey(request, user.id), { windowMs: 5 * 60 * 1000, max: 20, prefix: "mention" });
    if (!rl.allowed) return { ok: false };
    const body = capMentionBody(String(form.get("body") || ""));
    const mentionRegex = /@\[(.+?)\]\(user:(.+?)\)/g;
    let match: RegExpExecArray | null;
    const origin = getPublicOrigin(request);
    const docUrl = `${origin}/s/doc/${params.id}`;
    while ((match = mentionRegex.exec(body)) !== null) {
      const mentionedUserId = match[2];
      if (mentionedUserId === user.id) continue;
      // Only notify users who can actually see this doc — otherwise
      // mentioning an arbitrary user id leaks its title/content to them.
      if (!userHasDocAccess(doc, mentionedUserId)) continue;
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

  if (intent === "update-share-settings") {
    const docId = String(form.get("docId"));
    const document = getDocument(docId);
    if (!document) return null;

    const expiresAtRaw = form.get("expiresAt");
    // undefined = not submitted (don't touch), null = clear, number = set
    const expiresAt = expiresAtRaw !== null
      ? (String(expiresAtRaw) ? Math.floor(new Date(String(expiresAtRaw)).getTime() / 1000) : null)
      : undefined;

    const password = form.get("sharePassword");
    const clearPassword = form.get("clearPassword") === "true";
    const newPassword = clearPassword ? null : (password ? String(password) : undefined);
    if (newPassword && !sharePasswordSchema.safeParse(newPassword).success) {
      return { ok: false, error: "Share password must be at least 8 characters." };
    }

    await updateShareSettings(docId, {
      expiresAt,
      password: newPassword,
    });

    const updated = getDocument(docId);
    return { ok: true, shareExpiresAt: updated?.share_expires_at ?? null, hasPassword: !!updated?.share_password_hash };
  }

  return null;
}

function SharedPdfPreview({ document, user, folderPath, starred }: {
  document: { id: string; title: string; pdf_file: string; public_token: string | null; edit_token: string | null };
  user: { id: string; name: string };
  folderPath: BreadcrumbSegment[];
  starred: boolean;
}) {
  const bcLinkStyle: React.CSSProperties = { opacity: 0.4, color: "var(--fg)", textDecoration: "none", fontSize: "var(--fs-xs)" };

  return (
    <FilePreview
      document={document}
      user={user}
      starred={starred}
      breadcrumbs={
        <>
          <a href="/shared" style={bcLinkStyle}>Shared</a>
          {folderPath.map((seg) => (
            <span key={seg.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ opacity: 0.2, fontSize: "var(--fs-xs)", flexShrink: 0 }}>/</span>
              <a href={`/shared/folder/${seg.id}`} style={bcLinkStyle}>{seg.name}</a>
            </span>
          ))}
          <span style={{ opacity: 0.2, fontSize: "var(--fs-xs)", flexShrink: 0 }}>/</span>
        </>
      }
    />
  );
}

export default function SharedDocEditor() {
  const { workspace, document, user, folderPath, starred, creatorName, modifierName, wsUrl } =
    useLoaderData<typeof loader>();
  const sessionUser = useSessionUser();

  if (document.pdf_file) {
    return (
      <SharedPdfPreview
        document={{ ...document, pdf_file: document.pdf_file }}
        user={user}
        folderPath={folderPath}
        starred={starred}
      />
    );
  }

  const docProps = {
    document,
    workspace,
    user,
    canEdit: true as const,
    folderPath,
    wsUrl,
    starred,
    creatorName,
    modifierName,
    isShared: true as const,
    sessionUser: sessionUser ?? undefined,
  } as unknown as DocumentProps;

  return (
    <DocumentProvider {...docProps}>
      <DocEditorView {...docProps} />
    </DocumentProvider>
  );
}
