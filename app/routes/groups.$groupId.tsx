import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/groups.$groupId";
import { getSessionUser, loginRedirect } from "~/lib/auth.server";
import {
  getGroup,
  getGroupMembers,
  getGroupMembership,
  addGroupMember,
  removeGroupMember,
  updateGroupMemberRole,
  renameGroup,
  deleteGroup,
  hasGroupMemberRow,
} from "~/lib/group.server";
import { db, prep } from "~/lib/db.server";
import { getPublicOrigin } from "~/lib/url.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { GroupIcon, TrashIcon, PencilIcon } from "~/components/icons";
import { UserAutocomplete } from "~/components/UserAutocomplete";
import { useSessionUser } from "~/root";
import { useEffect, useRef, useState } from "react";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const d = data as Record<string, any> | undefined;
  return [{ title: `${d?.group.name ?? "Group"} — loica` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);

  const group = getGroup(params.groupId);
  if (!group) throw new Response("Group not found", { status: 404 });

  // If group has a linked teamspace, redirect there
  if (group.workspace_id) {
    throw redirect(`/t/${group.workspace_id}/members`);
  }

  const myRole = getGroupMembership(group.id, user.id);
  if (!myRole) throw new Response("Forbidden", { status: 403 });

  const members = getGroupMembers(group.id);
  return { group, myRole, members };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw loginRedirect(request);

  const group = getGroup(params.groupId);
  if (!group) throw new Response("Not found", { status: 404 });

  const myRole = getGroupMembership(group.id, user.id);
  if (!myRole) throw new Response("Forbidden", { status: 403 });

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "add-member") {
    if (myRole !== "admin") return { error: "Only admins can add members." };
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (!email) return { error: "Email is required." };
    const target = prep<{ id: string }, [string]>("SELECT id FROM users WHERE email = ?")
      .get(email);
    if (!target) return { error: `No user found with email "${email}".` };
    if (hasGroupMemberRow(group.id, target.id))
      return { error: "User is already a member or has a pending invitation." };
    const siteUrl = getPublicOrigin(request);
    addGroupMember(group.id, target.id, "member", user.id, user.is_admin, siteUrl);
    return {
      success: user.is_admin
        ? `${email} has been added to the group.`
        : `Invitation sent to ${email}.`,
    };
  }

  if (intent === "remove-member") {
    const targetId = String(form.get("userId"));
    if (targetId === user.id) {
      // Leaving the group
      removeGroupMember(group.id, user.id);
      throw redirect("/groups");
    }
    if (myRole !== "admin") return { error: "Only admins can remove members." };
    removeGroupMember(group.id, targetId);
    return { success: "Member removed." };
  }

  if (intent === "update-role") {
    if (myRole !== "admin") return { error: "Only admins can change roles." };
    const targetId = String(form.get("userId"));
    const newRole = String(form.get("role")) as "admin" | "member";
    if (newRole !== "admin" && newRole !== "member") return null;
    if (targetId === user.id) return { error: "You cannot change your own role." };
    updateGroupMemberRole(group.id, targetId, newRole);
    return { success: "Role updated." };
  }

  if (intent === "rename-group") {
    if (myRole !== "admin") return { error: "Only admins can rename groups." };
    const name = String(form.get("name") || "").trim();
    if (!name) return { error: "Name is required." };
    renameGroup(group.id, name);
    return { success: "Group renamed." };
  }

  if (intent === "delete-group") {
    if (myRole !== "admin") return { error: "Only admins can delete groups." };
    deleteGroup(group.id);
    throw redirect("/groups");
  }

  return null;
}

export default function GroupDetail() {
  const { group, myRole, members } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const user = useSessionUser();
  const isAdmin = myRole === "admin";
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

  return (
    <AppShell navActions={navActions} scrollable>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-fg/[0.06]">
              <GroupIcon className="h-5 w-5 text-fg/40" />
            </div>
            {renaming ? (
              <Form method="post" onSubmit={() => setRenaming(false)} className="flex items-center gap-2">
                <input type="hidden" name="intent" value="rename-group" />
                <input
                  name="name"
                  defaultValue={group.name}
                  autoFocus
                  className="rounded-lg border border-fg/15 bg-bg px-2.5 py-1 text-lg font-bold text-fg outline-none focus:border-accent/40"
                  onKeyDown={(e) => { if (e.key === "Escape") setRenaming(false); }}
                />
              </Form>
            ) : (
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="m-0 text-lg font-bold">{group.name}</h1>
                  {isAdmin && (
                    <button
                      onClick={() => setRenaming(true)}
                      className="cursor-pointer rounded border-none bg-transparent p-1 text-fg/30 hover:text-fg/70"
                      title="Rename"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <span className="text-xs capitalize opacity-40">{myRole}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Form method="post">
                <input type="hidden" name="intent" value="delete-group" />
                <button
                  type="submit"
                  onClick={(e) => { if (!confirm("Delete this group? All folder shares via this group will be revoked.")) e.preventDefault(); }}
                  className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-scarlet/25 bg-scarlet/[0.08] px-3 py-1.5 text-xs text-scarlet transition-colors hover:border-scarlet/40 hover:bg-scarlet/[0.14]"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                  Delete group
                </button>
              </Form>
            )}
            <Form method="post">
              <input type="hidden" name="intent" value="remove-member" />
              <input type="hidden" name="userId" value={user?.id ?? ""} />
              <button
                type="submit"
                onClick={(e) => { if (!confirm("Leave this group?")) e.preventDefault(); }}
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
        {isAdmin && (
          <Form ref={addFormRef} method="post" className="flex items-center gap-3">
            <input type="hidden" name="intent" value="add-member" />
            <UserAutocomplete
              name="email"
              placeholder="Add member by name or email…"
              required
              extraParams={{ groupId: group.id }}
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
                    {m.status === "pending" && (
                      <span className="ml-1.5 rounded-full bg-tawny/15 px-2 py-0.5 text-[0.6rem] font-medium text-tawny">
                        pending
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-fg/30">{m.email}</div>
                </div>
                <div className="w-24 shrink-0 text-center">
                  {isAdmin && m.user_id !== user?.id ? (
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
                        <option value="member">member</option>
                      </select>
                    </Form>
                  ) : (
                    <span className="text-xs capitalize text-fg/40">{m.role}</span>
                  )}
                </div>
                <div className="flex w-16 shrink-0 justify-end">
                  {isAdmin && m.user_id !== user?.id && (
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
