import { Form, redirect, useLoaderData, useActionData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/teamspaces";
import { requireAdmin } from "~/lib/auth.server";
import { getTeamspacesForUser, createTeamspace } from "~/lib/teamspace.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { GroupIcon } from "~/components/icons";
import { useSessionUser } from "~/root";
import { useState } from "react";

export const meta: MetaFunction = () => [{ title: "Teamspaces — loica" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireAdmin(request);
  return { teamspaces: getTeamspacesForUser(user.id) };
}

export async function action({ request }: Route.ActionArgs) {
  // The menu entry was already admin-only, but the route wasn't: any logged-in
  // user could POST here and create a teamspace. Hiding a link is not a
  // permission.
  const user = requireAdmin(request);

  const form = await request.formData();

  // Creating is all this page does. Everything else about a teamspace —
  // members, roles, icon, rename, delete — belongs to /t/:id/members, and
  // site-wide administration to /admin.
  if (form.get("intent") === "create-teamspace") {
    const name = String(form.get("name") || "").trim();
    if (!name) return { error: "Teamspace name is required." };
    const ts = createTeamspace(name, user.id);
    throw redirect(`/t/${ts.id}`);
  }

  return null;
}

export default function Teamspaces() {
  const { teamspaces } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const user = useSessionUser();
  const [creating, setCreating] = useState(false);

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin={user?.is_admin} />
  );

  return (
    <AppShell navActions={navActions} scrollable>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="m-0 text-lg font-bold">Teamspaces</h1>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex cursor-pointer items-center gap-2 rounded-xl border border-accent/25 bg-accent/[0.08] px-4 py-2 text-xs font-medium text-accent transition-colors hover:border-accent/40 hover:bg-accent/[0.14]"
          >
            <GroupIcon className="h-3.5 w-3.5" />
            New teamspace
          </button>
        </div>

        {actionData && "error" in actionData && (
          <div className="rounded-lg bg-scarlet/10 px-3 py-2 text-xs text-scarlet">
            {actionData.error}
          </div>
        )}

        {creating && (
          <Form
            method="post"
            onSubmit={() => setCreating(false)}
            className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] p-4"
          >
            <input type="hidden" name="intent" value="create-teamspace" />
            <GroupIcon className="h-5 w-5 shrink-0 text-accent/50" />
            <input
              name="name"
              autoFocus
              placeholder="Teamspace name..."
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

        {teamspaces.length === 0 && !creating ? (
          <div className="rounded-xl border border-fg/[0.08] px-4 py-20 text-center">
            <p className="m-0 text-sm opacity-50">No teamspaces yet.</p>
            <p className="mt-2 text-xs opacity-30">Create one to share a workspace with other people.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {teamspaces.map((ts) => (
              <div
                key={ts.id}
                className="flex items-center gap-4 rounded-xl border border-fg/[0.08] bg-fg/[0.02] p-4 transition-all hover:border-fg/20 hover:bg-fg/[0.05] hover:shadow-sm"
              >
                <a href={`/t/${ts.id}`} className="flex min-w-0 flex-1 items-center gap-4 text-fg no-underline">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fg/[0.06]">
                    {ts.icon ? (
                      <span className="text-lg leading-none">{ts.icon}</span>
                    ) : (
                      <GroupIcon className="h-5 w-5 text-fg/40" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{ts.name}</div>
                    <div className="text-xs text-fg/40">
                      {ts.member_count} member{ts.member_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                </a>
                <a
                  href={`/t/${ts.id}/members`}
                  className="shrink-0 rounded-lg border border-fg/10 bg-fg/[0.04] px-3 py-1.5 font-mono text-xs text-fg/50 no-underline transition-colors hover:border-fg/20 hover:text-fg/80"
                >
                  manage
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
