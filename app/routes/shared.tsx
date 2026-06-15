import { Form, redirect, useLoaderData, useFetcher, data } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/shared";
import { getSessionUser } from "~/lib/auth.server";
import {
  getSharedFoldersForUser,
  getPendingSharesForUser,
  acceptShare,
  declineShare,
} from "~/lib/sharing.server";
import {
  getSharedDocsForUser,
  getPendingDocSharesForUser,
  acceptDocShare,
  declineDocShare,
} from "~/lib/doc-sharing.server";
import { getStarredDocs, toggleStar, getWorkspaceStorageBytes } from "~/lib/document.server";
import { getUserWorkspaces } from "~/lib/workspace.server";
import { getTeamspacesForUser } from "~/lib/teamspace.server";
import { getFoldersAtLevel } from "~/lib/folder.server";
import { db, prep } from "~/lib/db.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { StarIcon, FolderIcon, DocIcon } from "~/components/icons";
import { useSessionUser } from "~/root";
import { useMemo } from "react";
import { NotificationBell } from "~/components/NotificationBell";

export const meta: MetaFunction = () => [{ title: "Shared with me — loica" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");
  const sharedFolders = getSharedFoldersForUser(user.id);
  const pendingShares = getPendingSharesForUser(user.id);
  const sharedDocs = getSharedDocsForUser(user.id);
  const pendingDocShares = getPendingDocSharesForUser(user.id);
  const starredDocs = getStarredDocs(user.id);
  const workspaces = getUserWorkspaces(user.id);
  const workspaceId = workspaces.length > 0 ? workspaces[0].id : null;
  const storageBytes = workspaceId ? getWorkspaceStorageBytes(workspaceId) : 0;
  const teamspaces = getTeamspacesForUser(user.id);
  const rootFolders = workspaceId ? getFoldersAtLevel(workspaceId, null) : [];
  const rootDocs = workspaceId ? prep<{ id: string; title: string }, [string]>(
    `SELECT id, title, pdf_file FROM documents WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ORDER BY title ASC`
  ).all(workspaceId) : [];
  return { sharedFolders, pendingShares, sharedDocs, pendingDocShares, starredDocs, storageBytes, teamspaces, rootFolders, rootDocs, workspaceId };
}

export async function action({ request }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw data("Unauthorized", { status: 401 });
  const form = await request.formData();
  const intent = form.get("intent");
  const shareId = String(form.get("shareId") || "");

  if (intent === "toggle-star") {
    const docId = String(form.get("docId") || "");
    const newState = toggleStar(user.id, docId);
    return { starred: newState };
  }

  if (intent === "accept-share") {
    acceptShare(shareId, user.id);
    return { ok: true };
  }
  if (intent === "decline-share") {
    declineShare(shareId, user.id);
    return { ok: true };
  }
  if (intent === "accept-doc-share") {
    acceptDocShare(shareId, user.id);
    return { ok: true };
  }
  if (intent === "decline-doc-share") {
    declineDocShare(shareId, user.id);
    return { ok: true };
  }

  throw data("Unknown intent", { status: 400 });
}

export default function SharedWithMe() {
  const { sharedFolders, pendingShares, sharedDocs, pendingDocShares, starredDocs, storageBytes, teamspaces, rootFolders, rootDocs, workspaceId } = useLoaderData<typeof loader>();
  const user = useSessionUser();
  const starFetcher = useFetcher();
  const starredSet = useMemo(() => new Set(starredDocs.map((d) => d.id)), [starredDocs]);

  // Group accepted shares by workspace
  const byWorkspace = new Map<string, typeof sharedFolders>();
  for (const sf of sharedFolders) {
    const existing = byWorkspace.get(sf.workspace_id) ?? [];
    existing.push(sf);
    byWorkspace.set(sf.workspace_id, existing);
  }

  const sharedCount = sharedFolders.length + sharedDocs.length;
  const navActions = (
    <>
      <NotificationBell />
      <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
    </>
  );

  const sidebar = workspaceId ? (
    <FolderTreeSidebar activeSection={{ type: "workspace", id: workspaceId }} activeView="shared" workspaceName="" storageBytes={storageBytes} sharedCount={sharedCount} teamspaces={teamspaces} workspaceId={workspaceId} rootFolders={rootFolders} rootDocs={rootDocs} />
  ) : undefined;

  return (
    <AppShell navActions={navActions} scrollable sidebar={sidebar} tone="drive">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <h1 className="section-header">Shared with me</h1>

        {/* Pending invitations */}
        {(pendingShares.length > 0 || pendingDocShares.length > 0) && (
          <section className="archive-list">
            <div className="archive-header">
              <span className="flex-1 font-bold text-tawny" style={{ fontSize: "var(--fs-2xs)" }}>
                {pendingShares.length + pendingDocShares.length} pending invitation{pendingShares.length + pendingDocShares.length > 1 ? "s" : ""}
              </span>
            </div>
              {pendingShares.map((ps) => (
                <div key={ps.id} className="archive-row">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <FolderIcon className="h-4 w-4 shrink-0 text-tawny/60" />
                      {ps.folder_name}
                    </span>
                    <span className="text-xs text-fg/30">
                      from {ps.shared_by_name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Form method="post">
                      <input type="hidden" name="intent" value="accept-share" />
                      <input type="hidden" name="shareId" value={ps.id} />
                      <button type="submit" className="cursor-pointer rounded border-none bg-sage/15 px-2.5 py-1 text-xs font-medium text-sage transition-colors hover:bg-sage/25">
                        Accept
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="decline-share" />
                      <input type="hidden" name="shareId" value={ps.id} />
                      <button type="submit" className="cursor-pointer rounded border border-fg/10 bg-transparent px-2.5 py-1 text-xs font-medium text-fg/40 transition-colors hover:bg-fg/5">
                        Decline
                      </button>
                    </Form>
                  </div>
                </div>
              ))}
              {pendingDocShares.map((ps) => (
                <div key={ps.id} className="archive-row">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <DocIcon className="h-4 w-4 shrink-0 text-fg/40" />
                      {ps.document_title}
                    </span>
                    <span className="text-xs text-fg/30">
                      from {ps.shared_by_name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Form method="post">
                      <input type="hidden" name="intent" value="accept-doc-share" />
                      <input type="hidden" name="shareId" value={ps.id} />
                      <button type="submit" className="cursor-pointer rounded border-none bg-sage/15 px-2.5 py-1 text-xs font-medium text-sage transition-colors hover:bg-sage/25">
                        Accept
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="decline-doc-share" />
                      <input type="hidden" name="shareId" value={ps.id} />
                      <button type="submit" className="cursor-pointer rounded border border-fg/10 bg-transparent px-2.5 py-1 text-xs font-medium text-fg/40 transition-colors hover:bg-fg/5">
                        Decline
                      </button>
                    </Form>
                  </div>
                </div>
              ))}
          </section>
        )}

        {/* Accepted shared folders/docs */}
        {sharedFolders.length === 0 && sharedDocs.length === 0 && pendingShares.length === 0 && pendingDocShares.length === 0 ? (
          <div className="archive-empty">
            <p>Nothing has been shared with you yet.</p>
            <p>When someone shares a folder or document with you, it will appear here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {sharedFolders.length > 0 && Array.from(byWorkspace.entries()).map(([wsId, folders]) => (
              <section key={wsId}>
                <h2 className="section-header mb-3">
                  {folders[0].workspace_name}
                </h2>
                <div className="archive-list">
                  <div className="archive-header">
                    <span className="flex-1">Name</span>
                    <span className="w-24 shrink-0 text-right">Shared via</span>
                    <span className="w-20 shrink-0 text-right">Access</span>
                  </div>
                  {folders.map((sf) => (
                    <a
                      key={`${sf.folder_id}-${sf.shared_via}`}
                      href={`/shared/folder/${sf.folder_id}`}
                      className="archive-row no-underline"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium text-fg">
                        <FolderIcon className="h-4 w-4 shrink-0 text-tawny/60" />
                        {sf.folder_name}
                      </span>
                      <span className="archive-meta w-24">
                        {sf.shared_via}
                      </span>
                      <span className="w-20 shrink-0 text-right text-xs text-sage">
                        full access
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            ))}

            {/* Shared documents */}
            {sharedDocs.length > 0 && (
              <section>
                <h2 className="section-header mb-3">Shared documents</h2>
                <div className="archive-list">
                  <div className="archive-header">
                    <span className="flex-1">Name</span>
                    <span className="w-24 shrink-0 text-right">From</span>
                    <span className="w-20 shrink-0 text-right">Access</span>
                    <span className="w-8 shrink-0" />
                  </div>
                  {sharedDocs.map((sd) => (
                    <a
                      key={sd.document_id}
                      href={`/shared/doc/${sd.document_id}`}
                      className="archive-row group no-underline"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium text-fg">
                        <DocIcon className="h-4 w-4 shrink-0 text-fg/40" />
                        {starredSet.has(sd.document_id) && (
                          <StarIcon filled className="h-3 w-3 shrink-0 text-star" />
                        )}
                        {sd.document_title}
                      </span>
                      <span className="archive-meta w-24">
                        {sd.shared_by_name}
                      </span>
                      <span className="w-20 shrink-0 text-right text-xs text-sage">
                        full access
                      </span>
                      <div className="archive-actions">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            starFetcher.submit({ intent: "toggle-star", docId: sd.document_id }, { method: "post" });
                          }}
                          title={starredSet.has(sd.document_id) ? "Unstar" : "Star"}
                          className="shrink-0 cursor-pointer border-none bg-transparent p-0.5 leading-none"
                          style={{
                            color: starredSet.has(sd.document_id) ? "var(--color-star)" : "color-mix(in srgb, var(--fg) 25%, transparent)",
                          }}
                        >
                          <StarIcon filled={starredSet.has(sd.document_id)} className="h-3 w-3" />
                        </button>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
