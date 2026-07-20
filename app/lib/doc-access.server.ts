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
import { getDocument, getDocumentByToken } from "./document.server";
import type { Document } from "./document.server";
import { getMembership } from "./workspace.server";
import { hasSharedAccess } from "./sharing.server";

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
 * Return the document if the caller may read it, else throw a 404 (not a 403 —
 * an unauthorised caller should not learn that the id exists).
 *
 * Access is granted to a workspace member, a folder-share recipient, or a
 * caller presenting a valid share token for *this* document. A token that
 * resolves to a different document is not access to this one.
 */
export function authorizeDocRead(request: Request, id: string | undefined): Document {
  const doc = getDocument(id!);
  if (!doc) throw new Response("Not found", { status: 404 });

  const user = getSessionUser(request);
  if (user) {
    const role = getMembership(doc.workspace_id, user.id, user.is_admin);
    const shared = doc.folder_id ? hasSharedAccess(doc.folder_id, user.id) : false;
    if (role || shared) return doc;
  }

  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (token) {
    const viaToken = getDocumentByToken(token);
    if (viaToken && viaToken.document.id === doc.id) {
      const passwordOk =
        !viaToken.hasPassword ||
        parseCookies(request.headers.get("Cookie") ?? "")[`__share_pwd_${token}`] === "1";
      if (passwordOk) return doc;
    }
  }

  throw new Response("Not found", { status: 404 });
}
