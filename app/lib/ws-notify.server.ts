/**
 * Calls into ws-server's loopback-only admin HTTP API (see ws-server.ts's
 * adminServer) so the web process can tell a live collaboration room that
 * access or lifecycle state changed. Best-effort: ws-server may not be
 * running (tests, a web-only dev session), so failures are swallowed — the
 * DB write that triggered the call already happened and is the source of
 * truth either way.
 */

const WS_PORT = Number(process.env.WS_PORT ?? 4001);
const WS_ADMIN_PORT = process.env.WS_ADMIN_PORT ?? String(WS_PORT + 1);
const ADMIN_FETCH_TIMEOUT_MS = 5000;

async function callAdmin(path: string, method: "GET" | "POST" = "POST"): Promise<Response | null> {
  try {
    return await fetch(`http://127.0.0.1:${WS_ADMIN_PORT}${path}`, {
      method,
      signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

/**
 * Re-check (and drop if it now fails) open connections whose access may
 * have just been revoked or downgraded. Scope to one document, one user, or
 * both — call right after the DB write that revoked the access, e.g.
 * unshareFolder, unshareDoc, removeTeamspaceMember, updateTeamspaceMemberRole,
 * or disabling a share link (setViewShare/setEditShare with enabled=false).
 */
export async function kickAccess(opts: { docId?: string; userId?: string; reason?: string }): Promise<void> {
  if (!opts.docId && !opts.userId) return; // nothing to scope the kick to
  const params = new URLSearchParams();
  if (opts.userId) params.set("userId", opts.userId);
  if (opts.reason) params.set("reason", opts.reason);
  const path = opts.docId ? `/kick/${encodeURIComponent(opts.docId)}` : "/kick";
  const qs = params.toString();
  await callAdmin(qs ? `${path}?${qs}` : path);
}

/** Force-close a room's connections to notify of a lifecycle change (trash, move, delete). */
export async function notifyDocUnavailable(docId: string, reason: string): Promise<void> {
  await callAdmin(`/notify/${encodeURIComponent(docId)}?reason=${encodeURIComponent(reason)}`);
}

/** Is a Yjs room currently open for this document? */
export async function isRoomLive(docId: string): Promise<boolean> {
  const res = await callAdmin(`/room/${encodeURIComponent(docId)}`, "GET");
  if (!res || !res.ok) return false;
  try {
    const body = (await res.json()) as { live?: boolean };
    return body.live === true;
  } catch {
    return false;
  }
}

/**
 * A `content` write from a plain web form action (not through the Yjs
 * room) bypasses yjs_state entirely — the room's next debounced save would
 * just overwrite it again within SAVE_MAX_WAIT_MS, silently losing the web
 * write. Reject the write instead of racing it. No client UI currently
 * submits `content` through these paths (only `title` — see
 * FilePreview.tsx), but the action handlers accept it from any POST, so the
 * guard stays regardless of what today's UI happens to send.
 */
export function shouldRejectContentWrite(hasContent: boolean, roomLive: boolean): boolean {
  return hasContent && roomLive;
}
