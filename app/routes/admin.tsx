import { Form, useLoaderData, useActionData, useNavigation, redirect } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/admin";
import { requireAdmin, validatePassword, createSession } from "~/lib/auth.server";
import { getClientIp, checkRateLimit } from "~/lib/rate-limit.server";
import {
  listAllUsers,
  adminCreateUser,
  adminUpdateUser,
  adminChangePassword,
  adminDeleteUser,
  adminToggleAdmin,
  adminTransferAndDeleteUser,
  adminMergeUserFiles,
  getCheapStats,
  refreshExpensiveStats,
  walCheckpoint,
  cleanupExpiredSessions,
  formatBytes,
  pruneAutoVersions,
} from "~/lib/admin.server";
import { isRegistrationOpen, isLocalLoginEnabled, setSetting, db, prep, setEnabledExtensionIds } from "~/lib/db.server";
import { extensions } from "~/extensions";
import { getEnabledExtensionIdSet, ensurePluginsLoaded, serverExtensions, builtinExtensionIds } from "~/extensions/index.server";
import { LOICA_EXTENSION_API_VERSION } from "~/extensions/types";
import type { LoicaExtension } from "~/extensions/types";
import { deleteTeamspace, renameTeamspace } from "~/lib/teamspace.server";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { useSessionUser } from "~/root";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRevalidator } from "react-router";

export const meta: MetaFunction = () => [{ title: "Admin — loica" }];

export async function loader({ request }: Route.LoaderArgs) {
  requireAdmin(request);
  const cheap = getCheapStats();
  const expensive = refreshExpensiveStats();

  // Format uptime as human-readable
  const s = cheap.uptimeSeconds;
  const days = Math.floor(s / 86400);
  const hrs = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const uptimeParts: string[] = [];
  if (days > 0) uptimeParts.push(`${days}d`);
  if (hrs > 0) uptimeParts.push(`${hrs}h`);
  uptimeParts.push(`${mins}m`);

  const stats = {
    documentCount: cheap.documentCount.toLocaleString(),
    memory: formatBytes(cheap.memoryBytes),
    userCount: cheap.userCount.toLocaleString(),
    uptime: uptimeParts.join(" "),
    dbSize: formatBytes(cheap.dbSizeBytes),
    walWarning: cheap.walSizeBytes > 50 * 1024 * 1024,
    walSize: formatBytes(cheap.walSizeBytes),
    expiredSessions: cheap.expiredSessions,
    orphanedDocs: cheap.orphanedDocs,
    projectSize: formatBytes(expensive.projectSizeBytes),
    codeSize: formatBytes(expensive.codeSizeBytes),
    diskUsagePercent: expensive.diskUsagePercent,
    diskUsedGB: expensive.diskUsedGB,
    diskFreeGB: expensive.diskFreeGB,
    diskTotalGB: expensive.diskTotalGB,
    lastBackup: expensive.lastBackup,
    lastBackupAgeHours: expensive.lastBackupAgeHours,
    largestDocs: expensive.largestDocs.map((d) => ({
      id: d.id,
      title: d.title || "Untitled",
      size: formatBytes(d.sizeBytes),
    })),
    recentActivity: expensive.recentActivity,
    prunableVersions: expensive.prunableVersions,
  };

  // Fetch active rooms from ws-server (best-effort — server may be down)
  let activeRooms: Array<{ docId: string; title: string; users: Array<{ name: string; color: string }> }> = [];
  try {
    const wsPort = process.env.WS_PORT ?? "4001";
    const res = await fetch(`http://127.0.0.1:${wsPort}/status`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      activeRooms = data.rooms ?? [];
    }
  } catch {
    // ws-server not reachable — ignore
  }

  // Fetch teamspaces
  const teamspaces = prep<
    { id: string; name: string; slug: string; group_name: string; member_count: number },
    []
  >(`
    SELECT w.id, w.name, w.slug, g.name AS group_name,
           (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) AS member_count
    FROM workspaces w
    JOIN groups g ON g.workspace_id = w.id
    WHERE w.type = 'team'
    ORDER BY w.name ASC
  `).all();

  // Fetch client errors grouped by message
  const clientErrors = prep<
    { message: string; count: number; stack: string | null; url: string | null; last_user: string | null; first_at: number; last_at: number },
    []
  >(`
    SELECT ce.message, COUNT(*) AS count,
           (SELECT stack FROM client_errors WHERE message = ce.message ORDER BY created_at DESC LIMIT 1) AS stack,
           (SELECT url FROM client_errors WHERE message = ce.message ORDER BY created_at DESC LIMIT 1) AS url,
           (SELECT u.name FROM client_errors ce2 LEFT JOIN users u ON u.id = ce2.user_id WHERE ce2.message = ce.message ORDER BY ce2.created_at DESC LIMIT 1) AS last_user,
           MIN(ce.created_at) AS first_at,
           MAX(ce.created_at) AS last_at
    FROM client_errors ce
    GROUP BY ce.message
    ORDER BY last_at DESC
    LIMIT 50
  `).all();
  const errorCount = (db.prepare("SELECT COUNT(*) as count FROM client_errors").get() as { count: number }).count;

  // Fetch server errors (process crashes, uncaught exceptions) — most recent first
  const serverErrors = prep<
    { id: number; source: string; message: string; stack: string | null; url: string | null; created_at: number },
    []
  >(`
    SELECT id, source, message, stack, url, created_at
    FROM server_errors
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
  const serverErrorCount = (db.prepare("SELECT COUNT(*) as count FROM server_errors").get() as { count: number }).count;

  // Include runtime-discovered drop-in plugins (server-only, absent from the
  // client `extensions` registry) so admins can toggle them too.
  await ensurePluginsLoaded();
  const enabledExtensionSet = getEnabledExtensionIdSet();
  type ExtMeta = { id: string; description: string; version: string | null; apiVersion: number | null };
  const extById = new Map<string, ExtMeta>();
  const collect = (e: LoicaExtension) => {
    const prev = extById.get(e.id);
    extById.set(e.id, {
      id: e.id,
      description: e.description ?? prev?.description ?? "",
      version: e.version ?? prev?.version ?? null,
      apiVersion: e.apiVersion ?? prev?.apiVersion ?? null,
    });
  };
  // Client registry first, then server (drop-ins are server-only).
  for (const e of extensions) collect(e);
  for (const e of serverExtensions) collect(e);
  const extensionInfo = Array.from(extById.values()).map((e) => ({
    ...e,
    enabled: enabledExtensionSet.has(e.id),
    source: builtinExtensionIds.has(e.id) ? ("built-in" as const) : ("plugin" as const),
    // null apiVersion = extension didn't declare one → treated as compatible.
    apiCompatible: e.apiVersion === null || e.apiVersion === LOICA_EXTENSION_API_VERSION,
  }));
  const currentApiVersion = LOICA_EXTENSION_API_VERSION;
  return { users: listAllUsers(), registrationOpen: isRegistrationOpen(), loginEnabled: isLocalLoginEnabled(), stats, activeRooms, teamspaces, clientErrors, errorCount, serverErrors, serverErrorCount, extensionInfo, currentApiVersion };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = requireAdmin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create-user") {
    const rl = checkRateLimit(getClientIp(request), { windowMs: 5 * 60 * 1000, max: 10, prefix: "admin" });
    if (!rl.allowed) return { error: "Too many requests. Try again later." };
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    if (!name || !email || !password) return { error: "All fields are required." };
    const pwError = validatePassword(password);
    if (pwError) return { error: pwError };
    try {
      await adminCreateUser(email, name, password);
      return { success: "User created." };
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "email_taken") return { error: "Email already in use." };
      return { error: "Failed to create user." };
    }
  }

  if (intent === "update-user") {
    const userId = String(form.get("userId"));
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    if (!name || !email) return { error: "Name and email are required." };
    try {
      adminUpdateUser(userId, { name, email });
      return { success: "User updated." };
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "email_taken") return { error: "Email already in use." };
      return { error: "Failed to update user." };
    }
  }

  if (intent === "change-password") {
    const rl = checkRateLimit(getClientIp(request), { windowMs: 5 * 60 * 1000, max: 10, prefix: "admin" });
    if (!rl.allowed) return { error: "Too many requests. Try again later." };
    const userId = String(form.get("userId"));
    const password = String(form.get("password") || "");
    const pwError = validatePassword(password);
    if (pwError) return { error: pwError };
    await adminChangePassword(userId, password);
    return { success: "Password changed." };
  }

  if (intent === "delete-user") {
    const userId = String(form.get("userId"));
    if (userId === admin.id) return { error: "Cannot delete yourself." };
    const transferToUserId = String(form.get("transferToUserId") || "").trim();
    if (transferToUserId) {
      if (transferToUserId === userId) return { error: "Cannot transfer to the same user." };
      try {
        adminTransferAndDeleteUser(userId, transferToUserId);
        return { success: "User deleted. Files transferred." };
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : "Failed to transfer and delete." };
      }
    }
    adminDeleteUser(userId);
    return { success: "User deleted." };
  }

  if (intent === "merge-user-files") {
    const sourceUserId = String(form.get("sourceUserId"));
    const targetUserId = String(form.get("targetUserId"));
    if (sourceUserId === targetUserId) return { error: "Cannot merge a user into themselves." };
    try {
      adminMergeUserFiles(sourceUserId, targetUserId);
      return { success: "Files merged." };
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : "Failed to merge files." };
    }
  }

  if (intent === "toggle-admin") {
    const userId = String(form.get("userId"));
    try {
      adminToggleAdmin(userId);
      return { success: "Admin status toggled." };
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "last_admin") {
        return { error: "Cannot demote the last admin." };
      }
      throw e;
    }
  }

  if (intent === "toggle-registration") {
    const open = form.get("open") === "true";
    setSetting("registration_open", open ? "true" : "false");
    return { success: open ? "Registration opened." : "Registration closed." };
  }

  if (intent === "toggle-login") {
    const enabled = form.get("enabled") === "true";
    setSetting("local_login_enabled", enabled ? "true" : "false");
    return { success: enabled ? "Login page enabled." : "Login page hidden." };
  }

  if (intent === "toggle-extension") {
    const extensionId = String(form.get("extensionId") || "");
    const enable = form.get("enable") === "true";
    const current = getEnabledExtensionIdSet();
    if (enable) current.add(extensionId);
    else current.delete(extensionId);
    setEnabledExtensionIds(Array.from(current));
    return { success: enable ? `Extension "${extensionId}" enabled.` : `Extension "${extensionId}" disabled.` };
  }

  if (intent === "wal-checkpoint") {
    walCheckpoint();
    return { success: "WAL checkpoint complete." };
  }

  if (intent === "cleanup-sessions") {
    const removed = cleanupExpiredSessions();
    return { success: `Cleaned up ${removed} expired session${removed !== 1 ? "s" : ""}.` };
  }

  if (intent === "prune-versions") {
    const removed = pruneAutoVersions();
    return { success: `Pruned ${removed} old auto-version${removed !== 1 ? "s" : ""}.` };
  }

  if (intent === "clear-errors") {
    db.exec("DELETE FROM client_errors");
    return { success: "Error log cleared." };
  }

  if (intent === "clear-server-errors") {
    db.exec("DELETE FROM server_errors");
    return { success: "Server error log cleared." };
  }

  if (intent === "impersonate") {
    const userId = String(form.get("userId") || "");
    if (!userId) return { error: "User ID is required." };
    const target = prep<{ id: string }, [string]>("SELECT id FROM users WHERE id = ?").get(userId);
    if (!target) return { error: "User not found." };
    const cookie = createSession(userId);
    return redirect("/w", { headers: { "Set-Cookie": cookie } });
  }

  if (intent === "delete-teamspace") {
    const workspaceId = String(form.get("workspaceId") || "");
    if (!workspaceId) return { error: "Workspace ID is required." };
    deleteTeamspace(workspaceId);
    return { success: "Teamspace deleted." };
  }

  if (intent === "rename-teamspace") {
    const workspaceId = String(form.get("workspaceId") || "");
    const name = String(form.get("name") || "").trim();
    if (!workspaceId || !name) return { error: "Workspace ID and name are required." };
    renameTeamspace(workspaceId, name);
    return { success: "Teamspace renamed." };
  }

  return null;
}

function UserRowMenu({
  userId,
  userName,
  isAdmin,
  isSelf,
  busy,
  onEdit,
  onChangePwd,
  onDelete,
  onMerge,
}: {
  userId: string;
  userName: string;
  isAdmin: boolean;
  isSelf: boolean;
  busy: boolean;
  onEdit: () => void;
  onChangePwd: () => void;
  onDelete: () => void;
  onMerge: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean }>({ top: 0, left: 0, openUp: false });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggle() {
    if (open) { setOpen(false); return; }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = 260; // approximate max height
    const openUp = rect.bottom + menuHeight > window.innerHeight;
    setPos({
      top: openUp ? rect.top : rect.bottom + 4,
      left: rect.right,
      openUp,
    });
    setOpen(true);
  }

  const itemClass = "block w-full cursor-pointer border-none bg-transparent px-3 py-1.5 text-left font-mono text-xs text-fg/60 hover:bg-fg/[0.06] hover:text-fg";

  return (
    <div className="w-8 shrink-0 text-center">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="cursor-pointer rounded border-none bg-transparent px-1.5 py-0.5 text-fg/30 transition-colors hover:bg-fg/[0.08] hover:text-fg/60"
        aria-label="User actions"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        ⋯
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-[160px] rounded-lg border border-fg/15 bg-bg py-1 shadow-lg"
          style={{
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
            left: pos.left - 160,
          }}
        >
          {!isSelf && (
            <Form method="post" onSubmit={() => setOpen(false)}>
              <input type="hidden" name="intent" value="impersonate" />
              <input type="hidden" name="userId" value={userId} />
              <button type="submit" className={itemClass + " text-accent/80 hover:text-accent"}>
                Login as
              </button>
            </Form>
          )}
          <button type="button" onClick={() => { setOpen(false); onEdit(); }} className={itemClass}>
            Edit
          </button>
          <button type="button" onClick={() => { setOpen(false); onChangePwd(); }} className={itemClass}>
            Change password
          </button>
          <Form method="post" onSubmit={() => setOpen(false)}>
            <input type="hidden" name="intent" value="toggle-admin" />
            <input type="hidden" name="userId" value={userId} />
            <button type="submit" disabled={busy} className={itemClass}>
              {isAdmin ? "Remove admin" : "Make admin"}
            </button>
          </Form>
          <button type="button" onClick={() => { setOpen(false); onMerge(); }} className={itemClass}>
            Merge files
          </button>
          <a
            href={`/api/admin-user-export/${userId}`}
            className={itemClass + " no-underline"}
            onClick={() => setOpen(false)}
          >
            Export ZIP
          </a>
          {!isSelf && (
            <>
              <div className="my-1 border-t border-fg/[0.08]" />
              <button type="button" onClick={() => { setOpen(false); onDelete(); }} className={itemClass + " text-scarlet/70 hover:text-scarlet"}>
                Delete user
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function AdminPanel() {
  const { users, registrationOpen, loginEnabled, stats, activeRooms, teamspaces, clientErrors, errorCount, serverErrors, serverErrorCount, extensionInfo, currentApiVersion } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const user = useSessionUser();
  const busy = navigation.state === "submitting";

  // Auto-refresh active rooms every 15s
  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 15_000);
    return () => clearInterval(interval);
  }, [revalidator]);

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [changingPwdId, setChangingPwdId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [mergingId, setMergingId] = useState<string | null>(null);
  function clearPanels() {
    setEditingId(null);
    setChangingPwdId(null);
    setDeletingId(null);
    setMergingId(null);
  }

  const navActions = (
    <UserMenu userName={user?.name ?? ""} isAdmin />
  );

  return (
    <AppShell navActions={navActions} scrollable>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-lg font-bold">Admin</h1>
            <span className="text-xs opacity-40">User & workspace management</span>
          </div>
          <button
            type="button"
            onClick={() => { setShowCreate(!showCreate); clearPanels(); }}
            className="flex cursor-pointer items-center gap-2 rounded-xl border border-fg/10 bg-fg/[0.03] px-4 py-2 font-mono text-xs font-medium text-fg/60 transition-colors hover:border-fg/20 hover:bg-fg/[0.07] hover:text-fg/80"
          >
            {showCreate ? "Cancel" : "New user"}
          </button>
        </div>

        {/* Flash messages */}
        {actionData && "error" in actionData && actionData.error && (
          <div className="rounded-lg border border-scarlet/30 bg-scarlet/10 px-4 py-2 text-xs text-scarlet">
            {actionData.error}
          </div>
        )}
        {actionData && "success" in actionData && actionData.success && (
          <div className="rounded-lg border border-sage/30 bg-sage/10 px-4 py-2 text-xs text-sage">
            {actionData.success}
          </div>
        )}

        {/* System */}
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-fg/30">
            System
          </h2>
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3">
            <div className="rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-4 py-3">
              <div className="text-xs uppercase text-fg/40">Documents</div>
              <div className="mt-1 font-mono text-lg font-semibold">{stats.documentCount}</div>
            </div>
            <div className="rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-4 py-3">
              <div className="text-xs uppercase text-fg/40">Users</div>
              <div className="mt-1 font-mono text-lg font-semibold">{stats.userCount}</div>
            </div>
            <div className="rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-4 py-3">
              <div className="text-xs uppercase text-fg/40">Uptime</div>
              <div className="mt-1 font-mono text-lg font-semibold">{stats.uptime}</div>
            </div>
            {/* Disk pie chart */}
            <div className="row-span-2 flex items-center gap-4 rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-5 py-3">
              <div className="relative h-20 w-20 shrink-0">
                <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="currentColor" strokeWidth="3" className="text-fg/[0.06]" />
                  <circle
                    cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3"
                    strokeDasharray={`${stats.diskUsagePercent} ${100 - stats.diskUsagePercent}`}
                    strokeLinecap="round"
                    className={stats.diskUsagePercent > 90 ? "text-scarlet" : stats.diskUsagePercent > 75 ? "text-tawny" : "text-sage"}
                    stroke="currentColor"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold">
                  {stats.diskUsagePercent}%
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs uppercase text-fg/40">Disk</div>
                <div className="font-mono text-sm font-semibold">{stats.diskUsedGB} GB used</div>
                <div className="font-mono text-xs text-fg/40">{stats.diskFreeGB} GB free of {stats.diskTotalGB} GB</div>
                <div className="mt-1 border-t border-fg/[0.06] pt-1 font-mono text-xs text-fg/40">
                  <div>Loica folder: <span className="font-semibold text-fg/60">{stats.projectSize}</span></div>
                  <div>Source code: <span className="font-semibold text-fg/60">{stats.codeSize}</span></div>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-4 py-3">
              <div className="text-xs uppercase text-fg/40">Memory</div>
              <div className="mt-1 font-mono text-lg font-semibold">{stats.memory}</div>
            </div>
            <div className="rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-4 py-3">
              <div className="text-xs uppercase text-fg/40">Database</div>
              <div className="mt-1 font-mono text-lg font-semibold">{stats.dbSize}</div>
            </div>
            <div className={`rounded-xl border px-4 py-3 ${
              stats.lastBackupAgeHours !== null && stats.lastBackupAgeHours > 24
                ? "border-tawny/30 bg-tawny/5"
                : "border-fg/[0.08] bg-fg/[0.02]"
            }`}>
              <div className="text-xs uppercase text-fg/40">Last backup</div>
              <div className="mt-1 font-mono text-lg font-semibold">{stats.lastBackup ?? "—"}</div>
              {stats.lastBackupAgeHours !== null && (
                <div className={`font-mono text-xs ${stats.lastBackupAgeHours > 24 ? "text-tawny" : "text-fg/30"}`}>
                  {stats.lastBackupAgeHours < 1 ? "< 1h ago" : `${stats.lastBackupAgeHours}h ago`}
                </div>
              )}
            </div>
          </div>

          {/* Warnings */}
          {stats.walWarning && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-tawny/30 bg-tawny/10 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-tawny">WAL file is large</div>
                <div className="text-xs text-tawny/70">
                  WAL size: {stats.walSize} — consider running a checkpoint to reclaim space.
                </div>
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="wal-checkpoint" />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-tawny px-4 py-1.5 font-mono text-xs font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                >
                  Checkpoint now
                </button>
              </Form>
            </div>
          )}
          {(stats.expiredSessions > 0 || stats.orphanedDocs > 0 || (stats.prunableVersions !== null && stats.prunableVersions > 0)) && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-4 py-3">
              <div>
                <div className="text-sm font-medium text-fg/70">Cleanup available</div>
                <div className="text-xs text-fg/40">
                  {[
                    stats.expiredSessions > 0 && `${stats.expiredSessions} expired session${stats.expiredSessions !== 1 ? "s" : ""}`,
                    stats.orphanedDocs > 0 && `${stats.orphanedDocs} orphaned document${stats.orphanedDocs !== 1 ? "s" : ""}`,
                    stats.prunableVersions !== null && stats.prunableVersions > 0 && `${stats.prunableVersions} prunable auto-version${stats.prunableVersions !== 1 ? "s" : ""}`,
                  ].filter(Boolean).join(", ")}
                </div>
              </div>
              <div className="flex gap-2">
                {stats.expiredSessions > 0 && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="cleanup-sessions" />
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-lg border border-fg/15 bg-fg/[0.05] px-4 py-1.5 font-mono text-xs font-medium text-fg/60 transition-colors hover:bg-fg/[0.1] disabled:opacity-40"
                    >
                      Clean sessions
                    </button>
                  </Form>
                )}
                {stats.prunableVersions !== null && stats.prunableVersions > 0 && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="prune-versions" />
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-lg border border-fg/15 bg-fg/[0.05] px-4 py-1.5 font-mono text-xs font-medium text-fg/60 transition-colors hover:bg-fg/[0.1] disabled:opacity-40"
                    >
                      Prune versions
                    </button>
                  </Form>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Online now */}
        <section>
          <h2 className="m-0 mb-3 text-xs font-bold uppercase tracking-wider text-fg/30">
            Online now
          </h2>
          {activeRooms.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-fg/[0.08] shadow-sm">
              {activeRooms.map((room, i) => (
                <div
                  key={room.docId}
                  className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{room.title}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {room.users.map((u, j) => (
                      <div key={`${u.name}-${j}`} className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: u.color }}
                        />
                        <span className="text-xs text-fg/60">{u.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-fg/[0.08] px-4 py-4 text-center text-xs text-fg/30">
              No active sessions
            </div>
          )}
        </section>

        {/* Activity & Largest docs — side by side */}
        <div className="grid grid-cols-2 gap-6">
          {/* Recent activity */}
          <section>
            <h2 className="m-0 mb-3 text-xs font-bold uppercase tracking-wider text-fg/30">
              Recent activity
            </h2>
            <div className="overflow-hidden rounded-xl border border-fg/[0.08] shadow-sm">
              {stats.recentActivity.length > 0 ? (
                stats.recentActivity.map((a, i) => (
                  <div
                    key={`${a.at}-${i}`}
                    className={`flex items-center gap-3 px-4 py-2 ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
                  >
                    <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      a.type === "login" ? "bg-sage" :
                      a.type === "edit" ? "bg-plumage" :
                      a.type === "folder" ? "bg-tawny" :
                      a.type === "share-folder" ? "bg-sage" :
                      "bg-accent"
                    }`} />
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-medium">{a.userName}</span>
                      <span className="text-xs text-fg/40">
                        {a.type === "login" ? " logged in" :
                         a.type === "edit" ? <> edited <span className="text-fg/60">{a.detail}</span></> :
                         a.type === "folder" ? <> created folder <span className="text-fg/60">{a.detail}</span></> :
                         a.type === "share-folder" ? <> shared folder <span className="text-fg/60">{a.detail}</span></> :
                         <> shared <span className="text-fg/60">{a.detail}</span></>}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-fg/30">{a.at}</span>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-center text-xs text-fg/30">No recent activity.</div>
              )}
            </div>
          </section>

          {/* Largest documents */}
          <section>
            <h2 className="m-0 mb-3 text-xs font-bold uppercase tracking-wider text-fg/30">
              Largest documents
            </h2>
            <div className="overflow-hidden rounded-xl border border-fg/[0.08] shadow-sm">
              {stats.largestDocs.length > 0 ? (
                stats.largestDocs.map((d, i) => (
                  <div
                    key={d.id}
                    className={`flex items-center justify-between px-4 py-2 ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{d.title}</span>
                    <span className="shrink-0 font-mono text-xs text-fg/40">{d.size}</span>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-center text-xs text-fg/30">No documents yet.</div>
              )}
            </div>
          </section>
        </div>

        {/* Settings */}
        <section>
          <h2 className="m-0 mb-3 text-xs font-bold uppercase tracking-wider text-fg/30">
            Settings
          </h2>
          <div className="flex items-center justify-between rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-4 py-3">
            <div>
              <div className="text-sm font-medium">Public registration</div>
              <div className="text-xs text-fg/40">
                {registrationOpen
                  ? "Anyone can create an account"
                  : "Only admins can create new accounts"}
              </div>
            </div>
            <Form method="post" className="flex items-center">
              <input type="hidden" name="intent" value="toggle-registration" />
              <input type="hidden" name="open" value={registrationOpen ? "false" : "true"} />
              <button
                type="submit"
                disabled={busy}
                aria-label={registrationOpen ? "Disable public registration" : "Enable public registration"}
                className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out disabled:opacity-40"
                style={{
                  backgroundColor: registrationOpen
                    ? "#10b981"
                    : "color-mix(in srgb, var(--fg) 20%, transparent)",
                }}
              >
                <span
                  className="pointer-events-none inline-block h-4 w-4 rounded-full bg-bg shadow-sm transition-transform duration-200 ease-in-out"
                  style={{
                    transform: registrationOpen ? "translateX(1.375rem)" : "translateX(0.25rem)",
                  }}
                />
              </button>
            </Form>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-4 py-3">
            <div>
              <div className="text-sm font-medium">Login page</div>
              <div className="text-xs text-fg/40">
                {loginEnabled
                  ? "Login form shown on home page"
                  : "Login form hidden from home page"}
              </div>
            </div>
            <Form method="post" className="flex items-center">
              <input type="hidden" name="intent" value="toggle-login" />
              <input type="hidden" name="enabled" value={loginEnabled ? "false" : "true"} />
              <button
                type="submit"
                disabled={busy}
                aria-label={loginEnabled ? "Hide login page" : "Show login page"}
                className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out disabled:opacity-40"
                style={{
                  backgroundColor: loginEnabled
                    ? "#10b981"
                    : "color-mix(in srgb, var(--fg) 20%, transparent)",
                }}
              >
                <span
                  className="pointer-events-none inline-block h-4 w-4 rounded-full bg-bg shadow-sm transition-transform duration-200 ease-in-out"
                  style={{
                    transform: loginEnabled ? "translateX(1.375rem)" : "translateX(0.25rem)",
                  }}
                />
              </button>
            </Form>
          </div>
        </section>

        {/* Extensions */}
        <section className="mb-6">
          <h2 className="m-0 mb-3 text-xs font-bold uppercase tracking-wider text-fg/30">
            Extensions
          </h2>
          {extensionInfo.length === 0 ? (
            <div className="rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-4 py-3 text-xs text-fg/40">
              No extensions registered.
            </div>
          ) : (
            extensionInfo.map((p, i) => (
              <div
                key={p.id}
                className={`${i > 0 ? "mt-2 " : ""}flex items-center justify-between rounded-xl border border-fg/[0.08] bg-fg/[0.02] px-4 py-3`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.id}</span>
                    {p.version && (
                      <span className="rounded-full bg-fg/[0.06] px-1.5 py-0.5 text-[0.65rem] font-medium text-fg/50">
                        v{p.version}
                      </span>
                    )}
                    <span className="rounded-full bg-fg/[0.06] px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-fg/40">
                      {p.source === "plugin" ? "Plugin" : "Built-in"}
                    </span>
                    {!p.apiCompatible && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[0.65rem] font-medium"
                        style={{ backgroundColor: "color-mix(in srgb, var(--color-danger) 15%, transparent)", color: "var(--color-danger)" }}
                        title={`Targets API v${p.apiVersion}; host is v${currentApiVersion}`}
                      >
                        API v{p.apiVersion} · host v{currentApiVersion}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-fg/40">
                    {p.description || "No description"}
                  </div>
                </div>
                <Form method="post" className="flex items-center">
                  <input type="hidden" name="intent" value="toggle-extension" />
                  <input type="hidden" name="extensionId" value={p.id} />
                  <input type="hidden" name="enable" value={p.enabled ? "false" : "true"} />
                  <button
                    type="submit"
                    disabled={busy}
                    aria-label={p.enabled ? `Disable ${p.id} extension` : `Enable ${p.id} extension`}
                    className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out disabled:opacity-40"
                    style={{
                      backgroundColor: p.enabled
                        ? "#10b981"
                        : "color-mix(in srgb, var(--fg) 20%, transparent)",
                    }}
                  >
                    <span
                      className="pointer-events-none inline-block h-4 w-4 rounded-full bg-bg shadow-sm transition-transform duration-200 ease-in-out"
                      style={{
                        transform: p.enabled ? "translateX(1.375rem)" : "translateX(0.25rem)",
                      }}
                    />
                  </button>
                </Form>
              </div>
            ))
          )}
        </section>

        {/* Create user form */}
        {showCreate && (
          <Form method="post" className="rounded-xl border border-fg/10 bg-fg/[0.02] p-4">
            <input type="hidden" name="intent" value="create-user" />
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-fg/30">New user</div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-fg/50">
                Name
                <input
                  name="name"
                  required
                  autoFocus
                  className="rounded-lg border border-fg/15 bg-bg px-2.5 py-1.5 font-mono text-xs text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
                  placeholder="Jane Doe"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-fg/50">
                Email
                <input
                  name="email"
                  type="email"
                  required
                  className="rounded-lg border border-fg/15 bg-bg px-2.5 py-1.5 font-mono text-xs text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
                  placeholder="jane@example.com"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-fg/50">
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  className="rounded-lg border border-fg/15 bg-bg px-2.5 py-1.5 font-mono text-xs text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
                  placeholder="min 8 chars"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-fg px-4 py-1.5 font-mono text-xs font-medium text-bg transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </Form>
        )}

        {/* Users table */}
        <section>
          <h2 className="m-0 mb-3 text-xs font-bold uppercase tracking-wider text-fg/30">
            Users ({users.length})
          </h2>
          <div className="overflow-hidden rounded-xl border border-fg/[0.08] shadow-sm">
            <div className="flex items-center border-b border-fg/[0.06] bg-fg/[0.02] px-4 py-2 text-xs font-medium text-fg/40">
              <span className="flex-1">Name</span>
              <span className="w-48 shrink-0">Email</span>
              <span className="w-14 shrink-0 text-center">Docs</span>
              <span className="w-16 shrink-0 text-center">Role</span>
              <span className="w-8 shrink-0" />
            </div>
            {users.map((u, i) => {
              if (editingId === u.id) {
                return (
                  <Form
                    key={u.id}
                    method="post"
                    className={`flex items-center gap-2 px-4 py-2 ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
                    onSubmit={() => setEditingId(null)}
                  >
                    <input type="hidden" name="intent" value="update-user" />
                    <input type="hidden" name="userId" value={u.id} />
                    <input
                      name="name"
                      defaultValue={u.name}
                      autoFocus
                      className="flex-1 rounded border border-fg/15 bg-fg/5 px-2 py-1 font-mono text-xs text-fg outline-none focus:border-fg/30"
                    />
                    <input
                      name="email"
                      defaultValue={u.email}
                      className="w-48 shrink-0 rounded border border-fg/15 bg-fg/5 px-2 py-1 font-mono text-xs text-fg outline-none focus:border-fg/30"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded bg-fg px-3 py-1 font-mono text-xs text-bg disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="cursor-pointer rounded border border-fg/15 bg-transparent px-3 py-1 font-mono text-xs text-fg/50"
                    >
                      Cancel
                    </button>
                  </Form>
                );
              }

              if (changingPwdId === u.id) {
                return (
                  <Form
                    key={u.id}
                    method="post"
                    className={`flex items-center gap-2 px-4 py-2 ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
                    onSubmit={() => setChangingPwdId(null)}
                  >
                    <input type="hidden" name="intent" value="change-password" />
                    <input type="hidden" name="userId" value={u.id} />
                    <span className="flex-1 truncate text-sm font-medium">{u.name}</span>
                    <input
                      name="password"
                      type="password"
                      autoFocus
                      required
                      minLength={8}
                      placeholder="New password (min 8)"
                      className="w-48 shrink-0 rounded border border-fg/15 bg-fg/5 px-2 py-1 font-mono text-xs text-fg outline-none focus:border-fg/30"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded bg-fg px-3 py-1 font-mono text-xs text-bg disabled:opacity-40"
                    >
                      Set
                    </button>
                    <button
                      type="button"
                      onClick={() => setChangingPwdId(null)}
                      className="cursor-pointer rounded border border-fg/15 bg-transparent px-3 py-1 font-mono text-xs text-fg/50"
                    >
                      Cancel
                    </button>
                  </Form>
                );
              }

              if (deletingId === u.id) {
                return (
                  <div
                    key={u.id}
                    className={`px-4 py-3 ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
                  >
                    <div className="mb-2 text-sm font-medium">
                      Delete <span className="text-scarlet">{u.name}</span>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <Form method="post" className="flex items-center gap-2">
                        <input type="hidden" name="intent" value="delete-user" />
                        <input type="hidden" name="userId" value={u.id} />
                        <button
                          type="submit"
                          disabled={busy}
                          className="rounded bg-scarlet/80 px-3 py-1 font-mono text-xs text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                        >
                          Discard data & delete
                        </button>
                      </Form>
                      <Form method="post" className="flex items-center gap-2">
                        <input type="hidden" name="intent" value="delete-user" />
                        <input type="hidden" name="userId" value={u.id} />
                        <label className="flex items-center gap-1.5 text-xs text-fg/50">
                          Transfer to
                          <select
                            name="transferToUserId"
                            required
                            className="rounded border border-fg/15 bg-bg px-2 py-1 font-mono text-xs text-fg outline-none"
                          >
                            <option value="">Select user...</option>
                            {users
                              .filter((t) => t.id !== u.id)
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <button
                          type="submit"
                          disabled={busy}
                          className="rounded bg-fg px-3 py-1 font-mono text-xs text-bg transition-opacity hover:opacity-80 disabled:opacity-40"
                        >
                          Transfer & delete
                        </button>
                      </Form>
                      <button
                        type="button"
                        onClick={() => setDeletingId(null)}
                        className="cursor-pointer rounded border border-fg/15 bg-transparent px-3 py-1 font-mono text-xs text-fg/50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              }

              if (mergingId === u.id) {
                return (
                  <div
                    key={u.id}
                    className={`px-4 py-3 ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
                  >
                    <div className="mb-2 text-sm font-medium">
                      Merge files from <span className="font-bold">{u.name}</span>
                    </div>
                    <Form method="post" className="flex items-center gap-2">
                      <input type="hidden" name="intent" value="merge-user-files" />
                      <input type="hidden" name="sourceUserId" value={u.id} />
                      <label className="flex items-center gap-1.5 text-xs text-fg/50">
                        Into
                        <select
                          name="targetUserId"
                          required
                          className="rounded border border-fg/15 bg-bg px-2 py-1 font-mono text-xs text-fg outline-none"
                        >
                          <option value="">Select user...</option>
                          {users
                            .filter((t) => t.id !== u.id)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="rounded bg-fg px-3 py-1 font-mono text-xs text-bg transition-opacity hover:opacity-80 disabled:opacity-40"
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        onClick={() => setMergingId(null)}
                        className="cursor-pointer rounded border border-fg/15 bg-transparent px-3 py-1 font-mono text-xs text-fg/50"
                      >
                        Cancel
                      </button>
                    </Form>
                  </div>
                );
              }

              return (
                <div
                  key={u.id}
                  className={`group relative flex items-center px-4 py-2 transition-colors hover:bg-fg/[0.04] ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
                >
                  <span className="flex-1 truncate text-sm font-medium">{u.name}</span>
                  <span className="w-48 shrink-0 truncate text-xs text-fg/50">{u.email}</span>
                  <span className="w-14 shrink-0 text-center font-mono text-xs text-fg/40">{u.doc_count}</span>
                  <span className="w-16 shrink-0 text-center text-xs text-fg/40">
                    {u.is_admin ? "admin" : "user"}
                  </span>
                  <UserRowMenu
                    userId={u.id}
                    userName={u.name}
                    isAdmin={u.is_admin}
                    isSelf={u.id === user?.id}
                    busy={busy}
                    onEdit={() => { clearPanels(); setEditingId(u.id); }}
                    onChangePwd={() => { clearPanels(); setChangingPwdId(u.id); }}
                    onDelete={() => { clearPanels(); setDeletingId(u.id); }}
                    onMerge={() => { clearPanels(); setMergingId(u.id); }}
                  />
                </div>
              );
            })}
          </div>
        </section>

        {/* Teamspaces table */}
        {teamspaces.length > 0 && (
          <section>
            <h2 className="m-0 mb-3 text-xs font-bold uppercase tracking-wider text-fg/30">
              Teamspaces ({teamspaces.length})
            </h2>
            <div className="overflow-hidden rounded-xl border border-fg/[0.08] shadow-sm">
              <div className="flex items-center border-b border-fg/[0.06] bg-fg/[0.02] px-4 py-2 text-xs font-medium text-fg/40">
                <span className="flex-1">Name</span>
                <span className="w-24 shrink-0 text-center">Members</span>
                <span className="w-20 shrink-0" />
              </div>
              {teamspaces.map((ts, i) => (
                <div
                  key={ts.id}
                  className={`group flex items-center px-4 py-2 transition-colors hover:bg-fg/[0.04] ${i > 0 ? "border-t border-fg/[0.06]" : ""}`}
                >
                  <a
                    href={`/t/${ts.id}`}
                    className="flex flex-1 items-center text-fg no-underline"
                  >
                    <span className="flex-1 truncate text-sm font-medium">{ts.name}</span>
                  </a>
                  <span className="w-24 shrink-0 text-center text-xs text-fg/50">{ts.member_count}</span>
                  <div className="flex w-20 shrink-0 items-center justify-end gap-2">
                    <a
                      href={`/t/${ts.id}/members`}
                      className="shrink-0 font-mono text-xs text-fg/30 no-underline opacity-0 transition-opacity hover:text-fg/60 group-hover:opacity-100"
                    >
                      members
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Server Error Log ──────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">
              Server Errors
              {serverErrorCount > 0 && (
                <span className="ml-2 rounded-full bg-scarlet/20 px-2 py-0.5 text-xs font-medium text-scarlet">
                  {serverErrorCount}
                </span>
              )}
            </h2>
            {serverErrorCount > 0 && (
              <Form method="post">
                <input type="hidden" name="intent" value="clear-server-errors" />
                <button
                  type="submit"
                  className="cursor-pointer rounded-lg border border-fg/15 bg-fg/5 px-3 py-1 text-xs font-medium text-fg/60 transition-colors hover:bg-fg/10"
                >
                  Clear all
                </button>
              </Form>
            )}
          </div>
          <p className="text-xs text-fg/40">
            Uncaught server-side exceptions — crashes, migration failures, unhandled promise rejections.
          </p>
          {serverErrors.length === 0 ? (
            <div className="rounded-xl border border-fg/[0.08] px-4 py-10 text-center text-xs text-fg/30">
              No server errors recorded.
            </div>
          ) : (
            <div className="space-y-2">
              {serverErrors.map((err) => (
                <details
                  key={err.id}
                  className="overflow-hidden rounded-xl border border-scarlet/20 shadow-sm"
                >
                  <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 text-xs transition-colors hover:bg-fg/[0.04]">
                    <span className="shrink-0 rounded bg-scarlet/10 px-1.5 py-0.5 font-mono text-[0.65rem] font-bold uppercase text-scarlet/80">
                      {err.source}
                    </span>
                    <span className="flex-1 truncate font-mono text-fg/80">
                      {err.message}
                    </span>
                    <span className="shrink-0 text-fg/30">
                      {new Date(err.created_at * 1000).toLocaleString()}
                    </span>
                  </summary>
                  <div className="border-t border-fg/[0.04] bg-fg/[0.02] px-4 py-3 text-xs">
                    {err.url && (
                      <div className="mb-2">
                        <span className="font-medium text-fg/50">URL: </span>
                        <span className="font-mono text-fg/70">{err.url}</span>
                      </div>
                    )}
                    {err.stack && (
                      <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded border border-fg/[0.06] bg-fg/[0.02] p-2 font-mono text-[0.65rem] leading-relaxed text-fg/60">
                        {err.stack}
                      </pre>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>

        {/* ─── Client Error Log ──────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">
              Client Errors
              {errorCount > 0 && (
                <span className="ml-2 rounded-full bg-scarlet/10 px-2 py-0.5 text-xs font-medium text-scarlet">
                  {errorCount}
                </span>
              )}
            </h2>
            {errorCount > 0 && (
              <Form method="post">
                <input type="hidden" name="intent" value="clear-errors" />
                <button
                  type="submit"
                  className="cursor-pointer rounded-lg border border-fg/15 bg-fg/5 px-3 py-1 text-xs font-medium text-fg/60 transition-colors hover:bg-fg/10"
                >
                  Clear all
                </button>
              </Form>
            )}
          </div>
          <p className="text-xs text-fg/40">
            JavaScript errors reported by browsers. Grouped by message; noisy library/extension errors are filtered before storage.
          </p>
          {clientErrors.length === 0 ? (
            <div className="rounded-xl border border-fg/[0.08] px-4 py-10 text-center text-xs text-fg/30">
              No client errors recorded.
            </div>
          ) : (
            <div className="space-y-2">
              {clientErrors.map((err, i) => (
                <details
                  key={i}
                  className="overflow-hidden rounded-xl border border-fg/[0.08] shadow-sm"
                >
                  <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 text-xs transition-colors hover:bg-fg/[0.04]">
                    <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-scarlet/10 px-2 py-0.5 font-mono text-[0.7rem] font-bold text-scarlet/80">
                      {err.count}
                    </span>
                    <span className="flex-1 truncate font-mono text-fg/80">
                      {err.message}
                    </span>
                    <span className="shrink-0 text-fg/30">
                      {err.last_user ?? "anon"} &middot; {new Date(err.last_at * 1000).toLocaleDateString()}
                    </span>
                  </summary>
                  <div className="border-t border-fg/[0.04] bg-fg/[0.02] px-4 py-3 text-xs">
                    <div className="mb-2 flex gap-4 text-fg/40">
                      <span>First: {new Date(err.first_at * 1000).toLocaleString()}</span>
                      <span>Last: {new Date(err.last_at * 1000).toLocaleString()}</span>
                    </div>
                    {err.url && (
                      <div className="mb-2">
                        <span className="font-medium text-fg/50">URL: </span>
                        <span className="font-mono text-fg/70">{err.url}</span>
                      </div>
                    )}
                    {err.stack && (
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-fg/[0.06] bg-fg/[0.02] p-2 font-mono text-[0.65rem] leading-relaxed text-fg/60">
                        {err.stack}
                      </pre>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
