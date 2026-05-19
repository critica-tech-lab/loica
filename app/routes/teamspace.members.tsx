import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/teamspace.members";
import { getSessionUser } from "~/lib/auth.server";
import { getMembership, getUserPersonalWorkspaces } from "~/lib/workspace.server";
import {
  getTeamspace,
  getTeamspaceMembers,
  getTeamspacesForUser,
  addTeamspaceMember,
  removeTeamspaceMember,
  updateTeamspaceMemberRole,
  renameTeamspace,
  deleteTeamspace,
  updateTeamspaceIcon,
} from "~/lib/teamspace.server";
import { getWorkspaceStorageBytes } from "~/lib/document.server";
import { getFoldersAtLevel } from "~/lib/folder.server";
import { getSharedFoldersForUser } from "~/lib/sharing.server";
import { getSharedDocsForUser } from "~/lib/doc-sharing.server";
import { db, prep } from "~/lib/db.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { FolderTreeSidebar } from "~/components/FolderTreeSidebar";
import { TrashIcon, PencilIcon } from "~/components/icons";
import { TeamspaceIconPicker } from "~/components/TeamspaceIconPicker";
import { UserAutocomplete } from "~/components/UserAutocomplete";
import { useSessionUser } from "~/root";
import { useEffect, useRef, useState } from "react";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const d = data as Record<string, any> | undefined;
  return [{ title: `Settings — ${d?.teamspace.name ?? "Teamspace"} teamspace — loica` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const teamspace = getTeamspace(params.workspaceId);
  if (!teamspace) throw new Response("Not found", { status: 404 });

  const role = getMembership(teamspace.id, user.id, user.is_admin);
  if (!role) throw new Response("Forbidden", { status: 403 });

  const members = getTeamspaceMembers(teamspace.id);
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

  return { teamspace, role, members, storageBytes, isSiteAdmin: user.is_admin, teamspaces, sharedCount, personalWsId, personalWsName, sidebarRootFolders, sidebarRootDocs };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const teamspace = getTeamspace(params.workspaceId);
  if (!teamspace) throw new Response("Not found", { status: 404 });

  const role = getMembership(teamspace.id, user.id, user.is_admin);
  if (!role) throw new Response("Forbidden", { status: 403 });

  const isTeamAdmin = role === "admin" || user.is_admin;

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "add-member") {
    if (!isTeamAdmin) return { error: "Only admins can add members." };
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (!email) return { error: "Email is required." };
    const target = prep<{ id: string }, [string]>("SELECT id FROM users WHERE email = ?")
      .get(email);
    if (!target) return { error: `No user found with email "${email}".` };
    // Check if already a member
    const existing = prep<{ user_id: string }, [string, string]>(
        "SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?"
      )
      .get(teamspace.id, target.id);
    if (existing) return { error: "User is already a member of this teamspace." };
    addTeamspaceMember(teamspace.id, target.id, "editor");
    return { success: `${email} has been added to the teamspace.` };
  }

  if (intent === "remove-member") {
    const targetId = String(form.get("userId"));
    if (targetId === user.id) {
      // Leaving the teamspace
      removeTeamspaceMember(teamspace.id, user.id);
      throw redirect("/w");
    }
    if (!isTeamAdmin) return { error: "Only admins can remove members." };
    removeTeamspaceMember(teamspace.id, targetId);
    return { success: "Member removed." };
  }

  if (intent === "update-role") {
    if (!isTeamAdmin) return { error: "Only admins can change roles." };
    const targetId = String(form.get("userId"));
    const newRole = String(form.get("role")) as "admin" | "editor" | "viewer";
    if (newRole !== "admin" && newRole !== "editor" && newRole !== "viewer") return null;
    if (targetId === user.id) return { error: "You cannot change your own role." };
    updateTeamspaceMemberRole(teamspace.id, targetId, newRole);
    return { success: "Role updated." };
  }

  if (intent === "rename-teamspace") {
    if (!isTeamAdmin) return { error: "Only admins can rename the teamspace." };
    const name = String(form.get("name") || "").trim();
    if (!name) return { error: "Name is required." };
    renameTeamspace(teamspace.id, name);
    return { success: "Teamspace renamed." };
  }

  if (intent === "change-icon") {
    if (!isTeamAdmin) return { error: "Only admins can change the icon." };
    const icon = String(form.get("icon") || "").trim() || null;
    updateTeamspaceIcon(teamspace.id, icon);
    return { success: "Icon updated." };
  }

  if (intent === "delete-teamspace") {
    if (!user.is_admin) return { error: "Only site admins can delete teamspaces." };
    deleteTeamspace(teamspace.id);
    throw redirect("/w");
  }

  return null;
}

export default function TeamspaceMembers() {
  const { teamspace, role, members, storageBytes, isSiteAdmin, teamspaces, sharedCount, personalWsId, personalWsName, sidebarRootFolders, sidebarRootDocs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const user = useSessionUser();
  const isTeamAdmin = role === "admin" || isSiteAdmin;
  const [renaming, setRenaming] = useState(false);
  const addFormRef = useRef<HTMLFormElement>(null);

  // Clear the add-member form after a successful submission
  useEffect(() => {
    if (actionData && "success" in actionData) {
      addFormRef.current?.reset();
    }
  }, [actionData]);

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

  const sidebar = (
    <FolderTreeSidebar
      activeSection={{ type: "teamspace", id: teamspace.id }}
      activeView="members"
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
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <TeamspaceIconPicker
              name={teamspace.name}
              icon={teamspace.icon ?? null}
              editable={isTeamAdmin}
            />
            {renaming ? (
              <Form method="post" onSubmit={() => setRenaming(false)} className="flex items-center gap-2">
                <input type="hidden" name="intent" value="rename-teamspace" />
                <input
                  name="name"
                  defaultValue={teamspace.name}
                  autoFocus
                  className="rounded-lg border border-fg/15 bg-bg px-2.5 py-1 text-lg font-bold text-fg outline-none focus:border-accent/40"
                  onKeyDown={(e) => { if (e.key === "Escape") setRenaming(false); }}
                />
              </Form>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="m-0 text-lg font-bold">{teamspace.name} <span className="font-normal text-fg/40">teamspace</span></h1>
                  {isTeamAdmin && (
                    <button
                      onClick={() => setRenaming(true)}
                      className="cursor-pointer rounded border-none bg-transparent p-1 text-fg/30 hover:text-fg/70"
                      title="Rename"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <span className="text-xs capitalize opacity-40">{role === "editor" ? "member" : role}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isSiteAdmin && (
              <Form method="post">
                <input type="hidden" name="intent" value="delete-teamspace" />
                <button
                  type="submit"
                  onClick={(e) => { if (!confirm("Delete this teamspace? All documents, folders, and members will be removed. This cannot be undone.")) e.preventDefault(); }}
                  className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-scarlet/25 bg-scarlet/[0.08] px-3 py-1.5 text-xs text-scarlet transition-colors hover:border-scarlet/40 hover:bg-scarlet/[0.14]"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  Delete teamspace
                </button>
              </Form>
            )}
            <Form method="post">
              <input type="hidden" name="intent" value="remove-member" />
              <input type="hidden" name="userId" value={user?.id ?? ""} />
              <button
                type="submit"
                onClick={(e) => { if (!confirm("Leave this teamspace?")) e.preventDefault(); }}
                className="cursor-pointer rounded-xl border border-fg/15 bg-fg/[0.04] px-3 py-1.5 text-xs text-fg/50 transition-colors hover:border-fg/25 hover:bg-fg/[0.08]"
              >
                Leave
              </button>
            </Form>
          </div>
        </div>

        {/* Feedback */}
        {actionData && "error" in actionData && (
          <div className="rounded-lg bg-scarlet/10 px-3 py-2 text-xs text-scarlet">
            {actionData.error}
          </div>
        )}
        {actionData && "success" in actionData && typeof actionData.success === "string" && (
          <div className="rounded-lg bg-sage/10 px-3 py-2 text-xs text-sage">
            {actionData.success}
          </div>
        )}

        {/* Add member */}
        {isTeamAdmin && (
          <Form ref={addFormRef} method="post" className="flex items-center gap-3">
            <input type="hidden" name="intent" value="add-member" />
            <UserAutocomplete
              name="email"
              placeholder="Add member by name or email…"
              required
              className="flex-1 rounded-lg border border-fg/15 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
            />
            <button
              type="submit"
              className="cursor-pointer rounded-lg border-none bg-accent/15 px-4 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
            >
              Add
            </button>
          </Form>
        )}

        {/* Members table */}
        <section>
          <h2 className="m-0 mb-3 text-xs font-bold uppercase tracking-wider text-fg/30">
            Members ({members.length})
          </h2>
          <div className="overflow-hidden rounded-xl border border-fg/[0.08] shadow-sm">
            <div className="flex items-center border-b border-fg/[0.06] bg-fg/[0.02] px-4 py-2 text-xs font-medium text-fg/40">
              <span className="flex-1">User</span>
              <span className="w-24 shrink-0 text-center">Role</span>
              <span className="w-16 shrink-0" />
            </div>
            {members.map((m, i) => (
              <div
                key={m.user_id}
                className={`group flex items-center px-4 py-2.5 ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">
                    {m.name}
                    {m.user_id === user?.id && (
                      <span className="ml-1.5 text-xs text-fg/30">(you)</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-fg/30">{m.email}</div>
                </div>
                <div className="w-24 shrink-0 text-center">
                  {isTeamAdmin && m.user_id !== user?.id ? (
                    <Form method="post" className="inline">
                      <input type="hidden" name="intent" value="update-role" />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <select
                        name="role"
                        defaultValue={m.role}
                        onChange={(e) => e.target.form?.requestSubmit()}
                        className="cursor-pointer rounded border border-fg/15 bg-bg px-1.5 py-0.5 text-xs text-fg outline-none"
                      >
                        <option value="admin">admin</option>
                        <option value="editor">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </Form>
                  ) : (
                    <span className="text-xs capitalize text-fg/40">{m.role === "editor" ? "member" : m.role}</span>
                  )}
                </div>
                <div className="flex w-16 shrink-0 justify-end">
                  {isTeamAdmin && m.user_id !== user?.id && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove-member" />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <button
                        type="submit"
                        onClick={(e) => { if (!confirm(`Remove ${m.name}?`)) e.preventDefault(); }}
                        className="cursor-pointer rounded border-none bg-transparent p-1.5 text-fg/30 opacity-0 transition-opacity hover:text-fg/70 group-hover:opacity-100"
                        title="Remove"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </Form>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
