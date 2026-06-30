import { Form, Link, redirect, useLoaderData, useActionData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/settings";
import { getSessionUser, getSessionId, requireUser, changeOwnPassword, updateProfile, validatePassword } from "~/lib/auth.server";
import { getUserWorkspaces } from "~/lib/workspace.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { DownloadIcon } from "~/components/icons";
import { useSessionUser } from "~/root";

export const meta: MetaFunction = () => [{ title: "Settings — loica" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw redirect("/login");
  const workspaces = getUserWorkspaces(user.id);
  const workspaceId = workspaces[0]?.id ?? null;
  return { user, workspaceId };
}

export async function action({ request }: Route.ActionArgs) {
  const user = requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "update-profile") {
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    if (!name || !email) return { error: "Name and email are required.", intent };
    try {
      updateProfile(user.id, { name, email });
      return { success: "Profile updated.", intent };
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "email_taken")
        return { error: "Email already in use.", intent };
      return { error: "Failed to update profile.", intent };
    }
  }

  if (intent === "change-password") {
    const currentPassword = String(form.get("currentPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (!currentPassword) return { error: "Current password is required.", intent };
    const pwError = validatePassword(newPassword);
    if (pwError) return { error: pwError, intent };
    if (newPassword !== confirmPassword)
      return { error: "New passwords do not match.", intent };
    try {
      const sessionId = getSessionId(request) ?? undefined;
      await changeOwnPassword(user.id, currentPassword, newPassword, sessionId);
      return { success: "Password changed.", intent };
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "wrong_password")
        return { error: "Current password is incorrect.", intent };
      return { error: "Failed to change password.", intent };
    }
  }

  return null;
}

export default function Settings() {
  const { user, workspaceId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const sessionUser = useSessionUser();

  const navActions = (
    <UserMenu userName={sessionUser?.name ?? ""} isAdmin={sessionUser?.is_admin} />
  );

  return (
    <AppShell navActions={navActions} scrollable>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-8">
        <div className="flex flex-col gap-2">
          <Link
            to="/w"
            prefetch="intent"
            className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg/55 no-underline transition-colors hover:bg-fg/5 hover:text-fg"
          >
            <span>←</span>
            <span>Files</span>
          </Link>
          <h1 className="m-0 text-lg font-bold">Settings</h1>
        </div>

        {/* Profile section */}
        <section className="rounded-xl border border-fg/[0.08] p-6">
          <h2 className="m-0 mb-4 text-sm font-semibold">Profile</h2>
          {actionData?.intent === "update-profile" && actionData.error && (
            <div className="mb-4 rounded-lg bg-scarlet/10 px-3 py-2 text-xs text-scarlet">
              {actionData.error}
            </div>
          )}
          {actionData?.intent === "update-profile" && actionData.success && (
            <div className="mb-4 rounded-lg bg-sage/10 px-3 py-2 text-xs text-sage">
              {actionData.success}
            </div>
          )}
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="update-profile" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-xs font-medium text-fg/50">
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                defaultValue={user.name}
                required
                className="rounded-lg border border-fg/15 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-xs font-medium text-fg/50">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                defaultValue={user.email}
                required
                className="rounded-lg border border-fg/15 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="cursor-pointer rounded-lg border-none bg-accent/15 px-4 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
              >
                Save
              </button>
            </div>
          </Form>
        </section>

        {/* Export workspace */}
        {workspaceId && (
          <section className="rounded-xl border border-fg/[0.08] p-6">
            <h2 className="m-0 mb-2 text-sm font-semibold">Export workspace</h2>
            <p className="m-0 mb-4 text-xs text-fg/40">
              Download all your documents as a ZIP file, preserving folder structure.
            </p>
            <a
              href={`/api/workspace-export/${workspaceId}`}
              className="inline-flex items-center gap-2 rounded-lg border border-fg/10 bg-fg/[0.03] px-4 py-2 text-xs font-medium text-fg/60 no-underline transition-colors hover:border-fg/20 hover:bg-fg/[0.07] hover:text-fg/80"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              Download ZIP
            </a>
          </section>
        )}

        {/* Password section */}
        <section className="rounded-xl border border-fg/[0.08] p-6">
          <h2 className="m-0 mb-4 text-sm font-semibold">Change password</h2>
          {actionData?.intent === "change-password" && actionData.error && (
            <div className="mb-4 rounded-lg bg-scarlet/10 px-3 py-2 text-xs text-scarlet">
              {actionData.error}
            </div>
          )}
          {actionData?.intent === "change-password" && actionData.success && (
            <div className="mb-4 rounded-lg bg-sage/10 px-3 py-2 text-xs text-sage">
              {actionData.success}
            </div>
          )}
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="change-password" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="currentPassword" className="text-xs font-medium text-fg/50">
                Current password
              </label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                className="rounded-lg border border-fg/15 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="newPassword" className="text-xs font-medium text-fg/50">
                New password
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                minLength={8}
                className="rounded-lg border border-fg/15 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirmPassword" className="text-xs font-medium text-fg/50">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={8}
                className="rounded-lg border border-fg/15 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                className="cursor-pointer rounded-lg border-none bg-accent/15 px-4 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
              >
                Change password
              </button>
            </div>
          </Form>
        </section>
      </div>
    </AppShell>
  );
}
