import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/groups";
import { getSessionUser } from "~/lib/auth.server";
import {
  getUserGroups,
  getPendingGroupInvites,
  createGroup,
  deleteGroup,
  renameGroup,
  getGroupMembership,
  acceptGroupInvite,
  declineGroupInvite,
} from "~/lib/group.server";
import { createTeamspace } from "~/lib/teamspace.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { GroupIcon, TrashIcon, PencilIcon } from "~/components/icons";
import { useSessionUser } from "~/root";
import { useState } from "react";

export const meta: MetaFunction = () => [{ title: "Groups — loica" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");
  const groups = getUserGroups(user.id);
  const pendingInvites = getPendingGroupInvites(user.id);
  return { groups, pendingInvites };
}

export async function action({ request }: Route.ActionArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create-group") {
    const name = String(form.get("name") || "").trim();
    if (!name) return { error: "Group name is required." };
    const group = createGroup(name, user.id);
    throw redirect(`/groups/${group.id}`);
  }

  if (intent === "create-teamspace") {
    const name = String(form.get("name") || "").trim();
    if (!name) return { error: "Teamspace name is required." };
    const ts = createTeamspace(name, user.id);
    throw redirect(`/t/${ts.id}`);
  }

  if (intent === "delete-group") {
    const groupId = String(form.get("groupId"));
    const role = getGroupMembership(groupId, user.id);
    if (role !== "admin") return { error: "Only group admins can delete groups." };
    deleteGroup(groupId);
    return { success: true };
  }

  if (intent === "rename-group") {
    const groupId = String(form.get("groupId"));
    const name = String(form.get("name") || "").trim();
    if (!name) return { error: "Group name is required." };
    const role = getGroupMembership(groupId, user.id);
    if (role !== "admin") return { error: "Only group admins can rename groups." };
    renameGroup(groupId, name);
    return { success: true };
  }

  if (intent === "accept-group-invite") {
    const groupId = String(form.get("groupId"));
    acceptGroupInvite(groupId, user.id);
    return { ok: true };
  }

  if (intent === "decline-group-invite") {
    const groupId = String(form.get("groupId"));
    declineGroupInvite(groupId, user.id);
    return { ok: true };
  }

  return null;
}

export default function Groups() {
  const { groups, pendingInvites } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const user = useSessionUser();
  const [creating, setCreating] = useState(false);
  const [creatingTeamspace, setCreatingTeamspace] = useState(false);

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

  return (
    <AppShell navActions={navActions} scrollable>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="m-0 text-lg font-bold">Groups</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreatingTeamspace(true)}
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-accent/25 bg-accent/[0.08] px-4 py-2 text-xs font-medium text-accent transition-colors hover:border-accent/40 hover:bg-accent/[0.14]"
            >
              <GroupIcon className="h-3.5 w-3.5" />
              New teamspace
            </button>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-fg/15 bg-fg/[0.04] px-4 py-2 text-xs font-medium text-fg/50 transition-colors hover:border-fg/25 hover:bg-fg/[0.08]"
            >
              <GroupIcon className="h-3.5 w-3.5" />
              New group
            </button>
          </div>
        </div>

        {actionData && "error" in actionData && (
          <div className="rounded-lg bg-scarlet/10 px-3 py-2 text-xs text-scarlet">
            {actionData.error}
          </div>
        )}

        {pendingInvites.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-bold uppercase tracking-wider text-fg/30">Pending invitations</div>
            {pendingInvites.map((inv) => (
              <div
                key={inv.group_id}
                className="flex items-center gap-4 rounded-xl border border-accent/20 bg-accent/[0.04] p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                  <GroupIcon className="h-5 w-5 text-accent/50" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{inv.group_name}</div>
                  <div className="text-xs text-fg/40">Invited by {inv.invited_by_name}</div>
                </div>
                <div className="flex gap-2">
                  <Form method="post">
                    <input type="hidden" name="intent" value="accept-group-invite" />
                    <input type="hidden" name="groupId" value={inv.group_id} />
                    <button
                      type="submit"
                      className="cursor-pointer rounded-lg border-none bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
                    >
                      Accept
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="decline-group-invite" />
                    <input type="hidden" name="groupId" value={inv.group_id} />
                    <button
                      type="submit"
                      className="cursor-pointer rounded-lg border-none bg-fg/[0.06] px-3 py-1.5 text-xs font-medium text-fg/50 transition-colors hover:bg-fg/10"
                    >
                      Decline
                    </button>
                  </Form>
                </div>
              </div>
            ))}
          </div>
        )}

        {creatingTeamspace && (
          <Form
            method="post"
            onSubmit={() => setCreatingTeamspace(false)}
            className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] p-4"
          >
            <input type="hidden" name="intent" value="create-teamspace" />
            <GroupIcon className="h-5 w-5 shrink-0 text-accent/50" />
            <input
              name="name"
              autoFocus
              placeholder="Teamspace name..."
              className="flex-1 rounded-lg border border-fg/15 bg-bg px-3 py-1.5 text-sm text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
              onKeyDown={(e) => { if (e.key === "Escape") setCreatingTeamspace(false); }}
            />
            <button
              type="submit"
              className="cursor-pointer rounded-lg border-none bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
            >
              Create
            </button>
          </Form>
        )}

        {creating && (
          <Form
            method="post"
            onSubmit={() => setCreating(false)}
            className="flex items-center gap-3 rounded-xl border border-fg/15 bg-fg/[0.02] p-4"
          >
            <input type="hidden" name="intent" value="create-group" />
            <GroupIcon className="h-5 w-5 shrink-0 text-accent/50" />
            <input
              name="name"
              autoFocus
              placeholder="Group name..."
              className="flex-1 rounded-lg border border-fg/15 bg-bg px-3 py-1.5 text-sm text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
              onKeyDown={(e) => { if (e.key === "Escape") setCreating(false); }}
            />
            <button
              type="submit"
              className="cursor-pointer rounded-lg border-none bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
            >
              Create
            </button>
          </Form>
        )}

        {groups.length === 0 && !creating ? (
          <div className="rounded-xl border border-fg/[0.08] px-4 py-20 text-center">
            <p className="m-0 text-sm opacity-50">No groups yet.</p>
            <p className="mt-2 text-xs opacity-30">Create one to start sharing folders with other users.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <a
                key={g.id}
                href={g.workspace_id ? `/t/${g.workspace_id}` : `/groups/${g.id}`}
                className="group flex items-center gap-4 rounded-xl border border-fg/[0.08] bg-fg/[0.02] p-4 no-underline text-fg transition-all hover:border-fg/20 hover:bg-fg/[0.05] hover:shadow-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fg/[0.06]">
                  <GroupIcon className="h-5 w-5 text-fg/40" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{g.name}</div>
                  <div className="text-xs text-fg/40">
                    {g.workspace_id ? "Teamspace · " : ""}
                    {g.member_count} member{g.member_count !== 1 ? "s" : ""}
                  </div>
                </div>
                <span className="rounded-full border border-fg/10 bg-fg/[0.04] px-2.5 py-0.5 text-[0.65rem] capitalize text-fg/40">
                  {g.workspace_id ? "teamspace" : g.role}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
