/**
 * Shared authorization for routes that expose a document's contents to a
 * caller: the export endpoints (`api/doc-download`, `api/doc-pdf`,
 * `api/doc-docx`, `api/doc-preview`) and anything else that needs the same
 * rule.
 *
 * Each of those routes used to carry its own copy of the check, and every copy
 * had the same defect: it treated "this document has a share token" as "no
 * authentication needed", without the caller ever proving they held the token.
 * Knowing a document id was therefore enough to download the full contents of
 * any document that had ever been shared — and expired or password-protected
 * links kept working, because neither was consulted.
 *
 * Resolving the token via `getDocumentByToken` is the same path
 * `routes/s.$token.tsx` uses, so expiry is enforced consistently. Callers pass
 * the token as a `?token=` query parameter.
 */
import { getSessionUser } from "./auth.server";
import { db } from "./db.server";
import { getDocument, getDocumentByToken, toggleStar } from "./document.server";
import type { Document } from "./document.server";
import { getMembership } from "./workspace.server";
import { hasSharedAccess } from "./sharing.server";
import { verifySharePasswordCookie } from "./share-password.server";
import { hasDocSharedAccess } from "./doc-sharing.server";
import { hasDocAccess } from "./doc-mention-authz.server";
import { resolveDocAccess } from "./doc-permission.server";
import type { DocAccess } from "./doc-permission.server";

/**
 * What a signed-in user may do with a document: admin, workspace member, folder
 * share or document share. Null when none apply. Share-token access is separate
 * (see `authorizeDocRead`).
 */
export function getUserDocAccess(
  doc: Pick<Document, "id" | "workspace_id" | "folder_id">,
  user: { id: string; is_admin: boolean },
): DocAccess | null {
  return resolveDocAccess(db, doc, user);
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq < 1) return [];
      return [[trimmed.slice(0, eq).trim(), decodeURIComponent(trimmed.slice(eq + 1).trim())]];
    }),
  );
}

/**
 * Star or unstar a document for a signed-in user who can see it (workspace
 * member, site admin, or folder/document share). Anyone else gets a 404.
 *
 * Without the check, a user holding only a document id could star it, which
 * lists its title and workspace name on their Favorites page, and the toggle
 * fans out to every group member of a group-shared document.
 */
export function toggleStarWithAccess(
  user: { id: string; is_admin?: boolean },
  docId: string,
): boolean {
  const doc = getDocument(docId);
  if (!doc || !getUserDocAccess(doc, { id: user.id, is_admin: !!user.is_admin })) throw new Response("Not found", { status: 404 });
  return toggleStar(user.id, docId);
}

/**
 * Return the document if the caller may read it, else throw a 404 (not a 403 —
 * an unauthorised caller should not learn that the id exists).
 *
 * Access is granted to a workspace member, a folder-share or document-share
 * recipient, or a caller presenting a valid share token for *this* document. A
 * token that resolves to a different document is not access to this one.
 */
export function authorizeDocRead(request: Request, id: string | undefined): Document {
  const doc = getDocument(id!);
  if (!doc) throw new Response("Not found", { status: 404 });

  const user = getSessionUser(request);
  if (user && getUserDocAccess(doc, user)) return doc;

  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (token) {
    const viaToken = getDocumentByToken(token);
    if (viaToken && viaToken.document.id === doc.id) {
      const passwordOk =
        !viaToken.hasPassword ||
        verifySharePasswordCookie(
          db,
          token,
          viaToken.document.share_password_hash ?? "",
          parseCookies(request.headers.get("Cookie") ?? "")[`__share_pwd_${token}`]
        );
      if (passwordOk) return doc;
    }
  }

  throw new Response("Not found", { status: 404 });
}

/**
 * Whether a user may see this document at all: workspace membership, a
 * folder-level share, or a direct doc-level share. Used to gate who a
 * @mention notification may be sent to — mentioning an arbitrary user id
 * should never leak the doc's title/content to someone's inbox.
 */
export function userHasDocAccess(doc: Document, userId: string, isAdmin?: boolean): boolean {
  const role = getMembership(doc.workspace_id, userId, isAdmin);
  const folderShared = doc.folder_id ? hasSharedAccess(doc.folder_id, userId) : false;
  const docShared = hasDocSharedAccess(doc.id, userId);
  return hasDocAccess({ role, folderShared, docShared });
}
