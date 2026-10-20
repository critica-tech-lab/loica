import { Link, useLoaderData, useSearchParams } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/teamspace.activity";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
import { getMembership, getUserPersonalWorkspaces } from "~/lib/workspace.server";
import { getTeamspace, getTeamspacesForUser } from "~/lib/teamspace.server";
import { getActivity, type ActivityEntry } from "~/lib/activity.server";
import { getWorkspaceStorageBytes } from "~/lib/document.server";
import { getFoldersAtLevel } from "~/lib/folder.server";
import { getSharedFoldersForUser } from "~/lib/sharing.server";
import { getSharedDocsForUser } from "~/lib/doc-sharing.server";
import { db, prep } from "~/lib/db.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { useSessionUser } from "~/root";
import { timeAgo } from "~/lib/ui-utils";

const PAGE_SIZE = 50;

// Human label for each stored action string — read-only view, no need for
// the full ActivityAction enum here.
const ACTION_LABELS: Record<string, string> = {
  "doc.create": "created document",
  "doc.rename": "renamed document",
  "doc.move": "moved document",
  "doc.trash": "trashed document",
  "doc.restore": "restored document",
  "doc.purge": "permanently deleted document",
  "folder.create": "created folder",
  "folder.rename": "renamed folder",
  "folder.move": "moved folder",
  "folder.trash": "trashed folder",
  "folder.restore": "restored folder",
  "folder.purge": "permanently deleted folder",
  "share.add": "shared",
  "share.remove": "removed share on",
  "member.add": "added member",
  "member.remove": "removed member",
  "member.role": "changed role of",
};

function describe(entry: ActivityEntry): string {
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  return entry.target_title ? `${label} "${entry.target_title}"` : label;
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const d = loaderData as Record<string, any> | undefined;
  return [{ title: `Activity — ${d?.teamspace.name ?? "Teamspace"} teamspace — loica` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);

  const teamspace = getTeamspace(params.workspaceId);
  if (!teamspace) throw new Response("Not found", { status: 404 });

  const role = getMembership(teamspace.id, user.id, user.is_admin);
  // Read-only audit view — teamspace admins and (on /w routes) workspace
  // owners only, same bar as the Members page's privileged actions.
  if (role !== "admin" && !user.is_admin) throw new Response("Forbidden", { status: 403 });

  const cursor = new URL(request.url).searchParams.get("cursor");
  const { items, nextCursor } = getActivity(teamspace.id, PAGE_SIZE, cursor);

  const storageBytes = getWorkspaceStorageBytes(teamspace.id);
  const personalWorkspaces = getUserPersonalWorkspaces(user.id);
  const personalWsId = personalWorkspaces.length > 0 ? personalWorkspaces[0].id : teamspace.id;
  const personalWsName = personalWorkspaces.length > 0 ? personalWorkspaces[0].name : "";
  const teamspaces = getTeamspacesForUser(user.id);
  const sharedFolders = getSharedFoldersForUser(user.id);
  const sharedDocs = getSharedDocsForUser(user.id);
  const sharedCount = sharedFolders.length + sharedDocs.length;
  const sidebarRootFolders = getFoldersAtLevel(personalWsId, null);
  const sidebarRootDocs = prep<{ id: string; title: string; pdf_file?: string | null }, [string]>(
    `SELECT id, title, pdf_file FROM documents WHERE workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL ORDER BY title ASC`
  ).all(personalWsId);

  return { teamspace, items, nextCursor, storageBytes, teamspaces, sharedCount, personalWsId, personalWsName, sidebarRootFolders, sidebarRootDocs };
}

export default function TeamspaceActivity() {
  const { teamspace, items, nextCursor, storageBytes, teamspaces, sharedCount, personalWsId, personalWsName, sidebarRootFolders, sidebarRootDocs } = useLoaderData<typeof loader>();
  const user = useSessionUser();
  const [searchParams] = useSearchParams();

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

  const sidebar = (
    <FolderTreeSidebar
      activeSection={{ type: "teamspace", id: teamspace.id }}
      workspaceName={personalWsName}
      workspaceId={personalWsId}
      rootFolders={sidebarRootFolders}
      rootDocs={sidebarRootDocs}
      teamspaces={teamspaces}
      sharedCount={sharedCount}
      storageBytes={storageBytes}
    />
  );

  return (
    <AppShell navActions={navActions} scrollable sidebar={sidebar} tone="drive">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
        <div>
          <h1 className="m-0 text-lg font-bold">
            Activity <span className="font-normal text-fg/40">{teamspace.name}</span>
          </h1>
        </div>

        <section>
          <div className="overflow-hidden rounded-xl border border-fg/[0.08] shadow-sm">
            {items.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-fg/30">No activity yet.</div>
            )}
            {items.map((entry, i) => (
              <div
                key={entry.id}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{entry.actor_name ?? "Someone"}</span>{" "}
                  <span className="text-fg/60">{describe(entry)}</span>
                </span>
                <span className="shrink-0 text-xs text-fg/30">{timeAgo(entry.created_at)}</span>
              </div>
            ))}
          </div>
          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <Link
                to={`?${new URLSearchParams({ ...Object.fromEntries(searchParams), cursor: nextCursor }).toString()}`}
                className="rounded-lg border border-fg/15 bg-fg/[0.04] px-3 py-1.5 text-xs text-fg/50 transition-colors hover:border-fg/25 hover:bg-fg/[0.08]"
              >
                Load more
              </Link>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
