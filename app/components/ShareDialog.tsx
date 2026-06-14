import { useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import { TrashIcon, ShareIcon } from "./icons";
import { UserAutocomplete } from "./UserAutocomplete";
import { useFocusTrap } from "~/components/hooks/useFocusTrap";
import { useToast } from "~/components/Toast";
import type { FolderShare } from "~/lib/sharing.server";
import type { DocShare, DocGroupShare, ExternalDocShare } from "~/lib/doc-sharing.server";
import type { GroupWithMeta } from "~/lib/group.server";

interface ShareDialogProps {
  itemType: "doc" | "folder";
  itemId: string;
  /** For docs: current public_token (or null) */
  publicToken?: string | null;
  /** For docs: current edit_token (or null) */
  editToken?: string | null;
  shareExpiresAt?: number | null;
  hasPassword?: boolean;
  onClose: () => void;
}

export function ShareDialog({
  itemType,
  itemId,
  publicToken,
  editToken,
  shareExpiresAt,
  hasPassword,
  onClose,
}: ShareDialogProps) {
  if (itemType === "folder") {
    return <FolderShareDialog folderId={itemId} onClose={onClose} />;
  }
  return (
    <DocShareDialog
      docId={itemId}
      publicToken={publicToken ?? null}
      editToken={editToken ?? null}
      shareExpiresAt={shareExpiresAt ?? null}
      hasPassword={hasPassword ?? false}
      onClose={onClose}
    />
  );
}

// ─── Document share dialog ──────────────────────────────

function DocShareDialog({
  docId,
  publicToken,
  editToken,
  shareExpiresAt: initialExpiresAt,
  hasPassword: initialHasPassword,
  onClose,
}: {
  docId: string;
  publicToken: string | null;
  editToken: string | null;
  shareExpiresAt: number | null;
  hasPassword: boolean;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ viewToken?: string | null; editToken?: string | null; shareExpiresAt?: number | null; hasPassword?: boolean }>();
  const shareFetcher = useFetcher<{ ok?: boolean; error?: string; sharedWith?: string }>();
  const shareFormRef = useRef<HTMLFormElement>(null);
  const settingsFetcher = useFetcher<{ ok?: boolean; shareExpiresAt?: number | null; hasPassword?: boolean }>();
  const loadFetcher = useFetcher<{ shares: DocShare[]; groupShares: DocGroupShare[]; externalShares: ExternalDocShare[]; userGroups: GroupWithMeta[] }>();
  const [copied, setCopied] = useState<string | null>(null);
  const { toast } = useToast();

  const currentViewToken = fetcher.data?.viewToken !== undefined ? fetcher.data.viewToken : publicToken;
  const currentEditToken = fetcher.data?.editToken !== undefined ? fetcher.data.editToken : editToken;
  const currentExpiresAt = settingsFetcher.data?.shareExpiresAt !== undefined ? settingsFetcher.data.shareExpiresAt : (fetcher.data?.shareExpiresAt !== undefined ? fetcher.data.shareExpiresAt : initialExpiresAt);
  const currentHasPassword = settingsFetcher.data?.hasPassword !== undefined ? settingsFetcher.data.hasPassword : (fetcher.data?.hasPassword !== undefined ? fetcher.data.hasPassword : initialHasPassword);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  // Load doc shares on mount
  useEffect(() => {
    loadFetcher.load(`/api/doc-shares/${docId}`);
  }, [docId]);

  // Re-load shares and show feedback whenever a share action completes
  const prevShareState = useRef(shareFetcher.state);
  useEffect(() => {
    if (prevShareState.current !== "idle" && shareFetcher.state === "idle") {
      loadFetcher.load(`/api/doc-shares/${docId}`);
      const data = shareFetcher.data;
      if (data?.ok) {
        shareFormRef.current?.reset();
        if (data.sharedWith) {
          toast(`Shared with ${data.sharedWith}`, "success");
        } else {
          toast("Shared successfully", "success");
        }
      } else if (data?.error) {
        toast(data.error, "error");
      }
    }
    prevShareState.current = shareFetcher.state;
  }, [shareFetcher.state, docId]);

  // Toast on link toggle
  const prevFetcherState = useRef(fetcher.state);
  useEffect(() => {
    if (prevFetcherState.current !== "idle" && fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.viewToken !== undefined) {
        toast(fetcher.data.viewToken ? "View-only link created" : "View-only link removed", "success");
      }
      if (fetcher.data.editToken !== undefined) {
        toast(fetcher.data.editToken ? "Edit link created" : "Edit link removed", "success");
      }
    }
    prevFetcherState.current = fetcher.state;
  }, [fetcher.state]);

  const shares = loadFetcher.data?.shares ?? [];
  const groupShares = loadFetcher.data?.groupShares ?? [];
  const externalShares = loadFetcher.data?.externalShares ?? [];
  const userGroups = loadFetcher.data?.userGroups ?? [];
  const sharedGroupIds = new Set(groupShares.map((gs) => gs.group_id));
  const availableGroups = userGroups.filter((g) => !sharedGroupIds.has(g.id));
  const shareBusy = shareFetcher.state !== "idle";
  const hasLinks = !!(currentViewToken || currentEditToken);

  function copyLink(token: string, label: string) {
    const text = `${baseUrl}/s/${token}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => { setCopied(label); setTimeout(() => setCopied(null), 2000); toast("Link copied!", "success"); },
        () => fallbackCopy(text, label),
      );
    } else {
      fallbackCopy(text, label);
    }
  }

  function fallbackCopy(text: string, label: string) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
    toast("Link copied!", "success");
  }

  const trapRef = useFocusTrap<HTMLDivElement>(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-plumage/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Share document"
        className="flex max-h-[80vh] w-[min(26rem,92vw)] flex-col overflow-hidden rounded-xl border border-fg/10 bg-bg shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-fg/[0.06] px-5 py-3.5">
          <h3 className="m-0 text-[13px] font-bold tracking-tight">Share</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-lg leading-none text-fg/30 transition-colors hover:bg-fg/5 hover:text-fg/60"
          >
            &times;
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">

          {/* Invite section */}
          <div className="flex flex-col gap-2.5">
            <shareFetcher.Form ref={shareFormRef} method="post" className="flex items-center gap-2">
              <input type="hidden" name="intent" value="share-doc" />
              <input type="hidden" name="docId" value={docId} />
              <UserAutocomplete
                name="email"
                placeholder="Invite by name or email..."
                required
                className="flex-1 rounded-lg border border-fg/12 bg-fg/[0.02] px-3 py-2 text-xs text-fg outline-none placeholder:text-fg/30 focus:border-accent/40 focus:bg-bg"
              />
              <button
                type="submit"
                disabled={shareBusy}
                className="cursor-pointer whitespace-nowrap rounded-lg border-none bg-accent px-3.5 py-2 text-xs font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Invite
              </button>
            </shareFetcher.Form>

            {availableGroups.length > 0 && (
              <shareFetcher.Form method="post" className="flex items-center gap-2" onSubmit={(e) => {
                const fd = new FormData(e.currentTarget);
                if (!fd.get("groupId")) { e.preventDefault(); toast("Select a group first", "error"); }
              }}>
                <input type="hidden" name="intent" value="share-doc-group" />
                <input type="hidden" name="docId" value={docId} />
                <select
                  name="groupId"
                  className="flex-1 rounded-lg border border-fg/12 bg-fg/[0.02] px-3 py-2 text-xs text-fg outline-none focus:border-accent/40"
                >
                  <option value="">Add a group...</option>
                  {availableGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name} ({g.member_count})</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={shareBusy}
                  className="cursor-pointer whitespace-nowrap rounded-lg border-none bg-fg/[0.06] px-3.5 py-2 text-xs font-medium text-fg/60 transition-colors hover:bg-fg/[0.10] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add
                </button>
              </shareFetcher.Form>
            )}
          </div>

          {/* People with access */}
          {(shares.length > 0 || groupShares.length > 0 || externalShares.length > 0) && (
            <div className="flex flex-col gap-1">
              <span className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-fg/30">
                People with access
              </span>
              <div className="flex flex-col">
                {groupShares.map((gs) => (
                  <div
                    key={gs.id}
                    className="group/row flex items-center gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-fg/[0.03]"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent">
                      {gs.member_count}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs font-medium">{gs.group_name}</span>
                      <span className="text-[10px] text-fg/35">{gs.member_count} member{gs.member_count !== 1 ? "s" : ""}</span>
                    </div>
                    <shareFetcher.Form method="post" className="flex">
                      <input type="hidden" name="intent" value="unshare-doc" />
                      <input type="hidden" name="shareId" value={gs.id} />
                      <button
                        type="submit"
                        disabled={shareBusy}
                        onClick={(e) => { if (!confirm(`Remove access for ${gs.group_name}?`)) e.preventDefault(); }}
                        className="cursor-pointer rounded-md border-none bg-transparent p-1 text-fg/20 opacity-0 transition-all hover:bg-scarlet/8 hover:text-scarlet group-hover/row:opacity-100 disabled:opacity-40"
                        title="Remove"
                      >
                        <TrashIcon className="h-3 w-3" />
                      </button>
                    </shareFetcher.Form>
                  </div>
                ))}
                {shares.map((s) => (
                  <div
                    key={s.id}
                    className="group/row flex items-center gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-fg/[0.03]"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fg/[0.06] text-[10px] font-bold uppercase text-fg/50">
                      {(s.user_name || "?").charAt(0)}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs font-medium">
                        {s.user_name}
                        {s.status === "pending" && (
                          <span className="ml-1.5 rounded bg-tawny/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-tawny">
                            pending
                          </span>
                        )}
                      </span>
                      <span className="truncate text-[10px] text-fg/35">{s.user_email}</span>
                    </div>
                    <shareFetcher.Form method="post" className="flex">
                      <input type="hidden" name="intent" value="unshare-doc" />
                      <input type="hidden" name="shareId" value={s.id} />
                      <button
                        type="submit"
                        disabled={shareBusy}
                        onClick={(e) => { if (!confirm(`Remove ${s.user_name}'s access?`)) e.preventDefault(); }}
                        className="cursor-pointer rounded-md border-none bg-transparent p-1 text-fg/20 opacity-0 transition-all hover:bg-scarlet/8 hover:text-scarlet group-hover/row:opacity-100 disabled:opacity-40"
                        title="Remove"
                      >
                        <TrashIcon className="h-3 w-3" />
                      </button>
                    </shareFetcher.Form>
                  </div>
                ))}
                {externalShares.map((es) => (
                  <div
                    key={es.id}
                    className="group/row flex items-center gap-2.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-fg/[0.03]"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tawny/10 text-[10px] text-tawny">
                      @
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs font-medium">{es.external_email}</span>
                      <span className="text-[10px] text-fg/35">External invite</span>
                    </div>
                    <shareFetcher.Form method="post" className="flex">
                      <input type="hidden" name="intent" value="unshare-doc" />
                      <input type="hidden" name="shareId" value={es.id} />
                      <button
                        type="submit"
                        disabled={shareBusy}
                        onClick={(e) => { if (!confirm(`Remove access for ${es.external_email}?`)) e.preventDefault(); }}
                        className="cursor-pointer rounded-md border-none bg-transparent p-1 text-fg/20 opacity-0 transition-all hover:bg-scarlet/8 hover:text-scarlet group-hover/row:opacity-100 disabled:opacity-40"
                        title="Remove"
                      >
                        <TrashIcon className="h-3 w-3" />
                      </button>
                    </shareFetcher.Form>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Public links */}
          <div className="flex flex-col gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/30">
              Public links
            </span>
            <ShareToggleSection
              label="View only"
              enabled={!!currentViewToken}
              token={currentViewToken}
              baseUrl={baseUrl}
              copied={copied === "view"}
              onCopy={() => currentViewToken && copyLink(currentViewToken, "view")}
              form={
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="toggle-doc-view" />
                  <input type="hidden" name="docId" value={docId} />
                  <input type="hidden" name="enabled" value={currentViewToken ? "false" : "true"} />
                  <button type="submit" className="sr-only" />
                </fetcher.Form>
              }
              onToggle={() => {
                const form = document.querySelector<HTMLFormElement>(
                  `form:has(input[name="intent"][value="toggle-doc-view"])`
                );
                form?.requestSubmit();
              }}
            />
            <ShareToggleSection
              label="Can edit"
              enabled={!!currentEditToken}
              token={currentEditToken}
              baseUrl={baseUrl}
              copied={copied === "edit"}
              onCopy={() => currentEditToken && copyLink(currentEditToken, "edit")}
              form={
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="toggle-doc-edit" />
                  <input type="hidden" name="docId" value={docId} />
                  <input type="hidden" name="enabled" value={currentEditToken ? "false" : "true"} />
                  <button type="submit" className="sr-only" />
                </fetcher.Form>
              }
              onToggle={() => {
                const form = document.querySelector<HTMLFormElement>(
                  `form:has(input[name="intent"][value="toggle-doc-edit"])`
                );
                form?.requestSubmit();
              }}
            />
            {hasLinks && (
              <ShareLinkSettings
                docId={docId}
                settingsFetcher={settingsFetcher}
                shareExpiresAt={currentExpiresAt}
                hasPassword={currentHasPassword}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Toggle switch + link section ────────────────────────

function formatExpiry(expiresAt: number | null): string {
  if (!expiresAt) return "never";
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return "expired";
  if (diff < 3600) return `${Math.ceil(diff / 60)}m`;
  if (diff < 86400) return `${Math.ceil(diff / 3600)}h`;
  return `${Math.ceil(diff / 86400)}d`;
}

function ShareToggleSection({
  label,
  enabled,
  token,
  baseUrl,
  copied,
  onCopy,
  form,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  token: string | null;
  baseUrl: string;
  copied: boolean;
  onCopy: () => void;
  form: React.ReactNode;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <div className="flex items-center gap-2">
          {/* Hidden form for submission */}
          <div className="hidden">{form}</div>
          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={onToggle}
            className="relative h-5 w-9 cursor-pointer rounded-full border-none p-0 transition-colors"
            style={{
              background: enabled
                ? "var(--color-sage)"
                : "color-mix(in srgb, var(--fg) 15%, transparent)",
            }}
          >
            <span
              className="absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow-sm transition-all"
              style={{
                left: enabled ? "calc(100% - 1.125rem)" : "0.125rem",
              }}
            />
          </button>
        </div>
      </div>
      {enabled && token && (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={`${baseUrl}/s/${token}`}
            className="flex-1 rounded border border-fg/10 bg-fg/[0.03] px-2 py-1 font-mono text-[0.65rem] text-fg/60 outline-none"
          />
          <button
            type="button"
            onClick={onCopy}
            className="cursor-pointer rounded border border-fg/15 bg-fg/5 px-2 py-1 text-[0.65rem] text-fg/60 transition-colors hover:bg-fg/10"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

function ShareLinkSettings({
  docId,
  settingsFetcher,
  shareExpiresAt,
  hasPassword,
}: {
  docId: string;
  settingsFetcher: ReturnType<typeof useFetcher>;
  shareExpiresAt: number | null;
  hasPassword: boolean;
}) {
  const [editing, setEditing] = useState<"expiry" | "password" | null>(null);

  return (
    <div className="flex flex-col gap-2 border-t border-fg/10 pt-2 mt-1">
      <div className="flex items-center gap-1 text-[0.6rem] text-fg/40">
        <button
          type="button"
          onClick={() => setEditing(editing === "expiry" ? null : "expiry")}
          className={`cursor-pointer rounded border-none bg-transparent px-0 py-0 transition-colors ${editing === "expiry" ? "text-accent" : "text-fg/40 hover:text-fg/70"}`}
        >
          Expires: <span className={`font-medium ${shareExpiresAt && shareExpiresAt < Math.floor(Date.now() / 1000) ? "text-scarlet" : ""}`}>{formatExpiry(shareExpiresAt)}</span>
        </button>
        <span className="text-fg/20">&middot;</span>
        <button
          type="button"
          onClick={() => setEditing(editing === "password" ? null : "password")}
          className={`cursor-pointer rounded border-none bg-transparent px-0 py-0 transition-colors ${editing === "password" ? "text-accent" : "text-fg/40 hover:text-fg/70"}`}
        >
          Password: <span className="font-medium">{hasPassword ? "yes" : "no"}</span>
        </button>
        {hasPassword && (
          <button
            type="button"
            disabled={settingsFetcher.state !== "idle"}
            onClick={() => {
              settingsFetcher.submit(
                { intent: "update-share-settings", docId, clearPassword: "true" },
                { method: "post" }
              );
            }}
            className="cursor-pointer rounded border-none bg-transparent px-0 py-0 text-fg/30 transition-colors hover:text-scarlet disabled:opacity-40"
            title="Remove password"
          >
            &times;
          </button>
        )}
      </div>
      {editing === "expiry" && (
        <ExpirationPicker docId={docId} fetcher={settingsFetcher} onDone={() => setEditing(null)} />
      )}
      {editing === "password" && !hasPassword && (
        <PasswordSetter docId={docId} fetcher={settingsFetcher} onDone={() => setEditing(null)} />
      )}
    </div>
  );
}

function ExpirationPicker({ docId, fetcher, onDone }: { docId: string; fetcher: ReturnType<typeof useFetcher>; onDone: () => void }) {
  const presets = [
    { label: "1 hour", ms: 60 * 60 * 1000 },
    { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
    { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
    { label: "14 days", ms: 14 * 24 * 60 * 60 * 1000 },
    { label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          disabled={fetcher.state !== "idle"}
          onClick={() => {
            const expiresAt = new Date(Date.now() + p.ms).toISOString();
            fetcher.submit(
              { intent: "update-share-settings", docId, expiresAt },
              { method: "post" }
            );
            onDone();
          }}
          className="cursor-pointer rounded border border-fg/10 bg-fg/[0.03] px-2 py-0.5 text-[0.6rem] text-fg/60 transition-colors hover:bg-fg/[0.06] disabled:opacity-40"
        >
          {p.label}
        </button>
      ))}
      <button
        type="button"
        disabled={fetcher.state !== "idle"}
        onClick={() => {
          fetcher.submit(
            { intent: "update-share-settings", docId, expiresAt: "" },
            { method: "post" }
          );
          onDone();
        }}
        className="cursor-pointer rounded border border-fg/10 bg-fg/[0.03] px-2 py-0.5 text-[0.6rem] text-fg/60 transition-colors hover:bg-fg/[0.06] disabled:opacity-40"
      >
        No expiration
      </button>
    </div>
  );
}

function PasswordSetter({ docId, fetcher, onDone }: { docId: string; fetcher: ReturnType<typeof useFetcher>; onDone: () => void }) {
  const [pwd, setPwd] = useState("");
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="password"
        placeholder="Set password…"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        className="flex-1 rounded border border-fg/10 bg-fg/[0.03] px-2 py-1 text-[0.65rem] text-fg outline-none placeholder:text-fg/25"
      />
      <button
        type="button"
        disabled={fetcher.state !== "idle" || !pwd}
        onClick={() => {
          fetcher.submit(
            { intent: "update-share-settings", docId, sharePassword: pwd },
            { method: "post" }
          );
          setPwd("");
          onDone();
        }}
        className="cursor-pointer rounded border border-fg/15 bg-fg/5 px-2 py-1 text-[0.6rem] font-medium text-fg/60 transition-colors hover:bg-fg/10 disabled:opacity-40"
      >
        Set
      </button>
    </div>
  );
}

// ─── Inline share panel (sidebar) ────────────────────────

export function InlineSharePanel({
  docId,
  publicToken,
  editToken,
  shareExpiresAt: initialExpiresAt,
  hasPassword: initialHasPassword,
  onClose,
  embedded = false,
}: {
  docId: string;
  publicToken: string | null;
  editToken: string | null;
  shareExpiresAt: number | null;
  hasPassword: boolean;
  onClose: () => void;
  embedded?: boolean;
}) {
  const fetcher = useFetcher<{ viewToken?: string | null; editToken?: string | null; shareExpiresAt?: number | null; hasPassword?: boolean }>();
  const shareFetcher = useFetcher<{ ok?: boolean; sharedWith?: string; error?: string; externalLink?: string }>();
  const settingsFetcher = useFetcher<{ ok?: boolean; shareExpiresAt?: number | null; hasPassword?: boolean }>();
  const loadFetcher = useFetcher<{ shares: DocShare[]; groupShares: DocGroupShare[]; externalShares: ExternalDocShare[]; userGroups: GroupWithMeta[] }>();
  const [copied, setCopied] = useState<string | null>(null);
  const shareFormRef = useRef<HTMLFormElement>(null);

  const currentViewToken = fetcher.data?.viewToken !== undefined ? fetcher.data.viewToken : publicToken;
  const currentEditToken = fetcher.data?.editToken !== undefined ? fetcher.data.editToken : editToken;
  const currentExpiresAt = settingsFetcher.data?.shareExpiresAt !== undefined ? settingsFetcher.data.shareExpiresAt : (fetcher.data?.shareExpiresAt !== undefined ? fetcher.data.shareExpiresAt : initialExpiresAt);
  const currentHasPassword = settingsFetcher.data?.hasPassword !== undefined ? settingsFetcher.data.hasPassword : (fetcher.data?.hasPassword !== undefined ? fetcher.data.hasPassword : initialHasPassword);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    loadFetcher.load(`/api/doc-shares/${docId}`);
  }, [docId]);

  const prevShareState = useRef(shareFetcher.state);
  useEffect(() => {
    if (prevShareState.current !== "idle" && shareFetcher.state === "idle") {
      loadFetcher.load(`/api/doc-shares/${docId}`);
      // Show confirmation or error toast
      if (shareFetcher.data?.ok) {
        if (shareFetcher.data.externalLink) {
          navigator.clipboard?.writeText(shareFetcher.data.externalLink).catch(() => {});
          toast("Not a Loica user — invite link copied", "info");
        } else {
          const name = shareFetcher.data.sharedWith;
          toast(name ? `Shared with ${name}` : "Shared successfully", "success");
        }
        shareFormRef.current?.reset();
      } else if (shareFetcher.data?.error) {
        toast(shareFetcher.data.error, "error");
      }
    }
    prevShareState.current = shareFetcher.state;
  }, [shareFetcher.state, docId]);

  // Toast on link toggle
  const prevFetcherState = useRef(fetcher.state);
  useEffect(() => {
    if (prevFetcherState.current !== "idle" && fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.viewToken !== undefined) {
        toast(fetcher.data.viewToken ? "View-only link created" : "View-only link removed", "success");
      }
      if (fetcher.data.editToken !== undefined) {
        toast(fetcher.data.editToken ? "Edit link created" : "Edit link removed", "success");
      }
    }
    prevFetcherState.current = fetcher.state;
  }, [fetcher.state]);

  const shares = loadFetcher.data?.shares ?? [];
  const groupShares = loadFetcher.data?.groupShares ?? [];
  const externalShares = loadFetcher.data?.externalShares ?? [];
  const userGroups = loadFetcher.data?.userGroups ?? [];
  const sharedGroupIds = new Set(groupShares.map((gs) => gs.group_id));
  const availableGroups = userGroups.filter((g) => !sharedGroupIds.has(g.id));
  const shareBusy = shareFetcher.state !== "idle";
  const { toast } = useToast();

  function copyLink(token: string, label: string) {
    const text = `${baseUrl}/s/${token}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => { setCopied(label); setTimeout(() => setCopied(null), 2000); toast("Link copied!", "success"); },
        () => fallbackCopy(text, label),
      );
    } else {
      fallbackCopy(text, label);
    }
  }

  function fallbackCopy(text: string, label: string) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
    toast("Link copied!", "success");
  }

  const shareContent = (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {/* Share with user by name or email */}
        <shareFetcher.Form ref={shareFormRef} method="post" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem" }}>
          <input type="hidden" name="intent" value="share-doc" />
          <input type="hidden" name="docId" value={docId} />
          <UserAutocomplete
            name="email"
            placeholder="Name or email…"
            required
            style={inlineInputStyle}
          />
          <button type="submit" disabled={shareBusy} style={inlineSubmitBtnStyle}>
            Share
          </button>
        </shareFetcher.Form>

        {/* Share with group */}
        {availableGroups.length > 0 && (
          <shareFetcher.Form method="post" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem" }} onSubmit={(e) => {
            const fd = new FormData(e.currentTarget);
            if (!fd.get("groupId")) { e.preventDefault(); toast("Please select a group first", "error"); }
          }}>
            <input type="hidden" name="intent" value="share-doc-group" />
            <input type="hidden" name="docId" value={docId} />
            <select
              name="groupId"
              style={{ ...inlineInputStyle, flex: 1 }}
            >
              <option value="">Share with group…</option>
              {availableGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name} ({g.member_count})</option>
              ))}
            </select>
            <button type="submit" disabled={shareBusy} style={inlineSubmitBtnStyle}>
              Share
            </button>
          </shareFetcher.Form>
        )}

        {/* Current user + group + external shares */}
        {(shares.length > 0 || groupShares.length > 0 || externalShares.length > 0) && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 600, opacity: 0.4 }}>Shared with</span>
            {groupShares.map((gs) => (
              <div key={gs.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.72rem", padding: "0.2rem 0" }}>
                <span>
                  <span style={{ fontWeight: 600 }}>{gs.group_name}</span>
                  <span style={{ marginLeft: "0.3rem", opacity: 0.4, fontSize: "0.6rem" }}>{gs.member_count} {gs.member_count !== 1 ? "members" : "member"}</span>
                </span>
                <shareFetcher.Form method="post" style={{ display: "flex" }}>
                  <input type="hidden" name="intent" value="unshare-doc" />
                  <input type="hidden" name="shareId" value={gs.id} />
                  <button
                    type="submit"
                    disabled={shareBusy}
                    onClick={(e) => { if (!confirm(`Remove access for ${gs.group_name}?`)) e.preventDefault(); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--fg)", opacity: 0.3, fontSize: "0.8rem", padding: "0 0.2rem" }}
                  >
                    &times;
                  </button>
                </shareFetcher.Form>
              </div>
            ))}
            {shares.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.72rem", padding: "0.2rem 0" }}>
                <span>
                  <span style={{ fontWeight: 600 }}>{s.user_name}</span>
                  {s.status === "pending" && <span style={{ marginLeft: "0.3rem", opacity: 0.5, fontSize: "0.6rem" }}>pending</span>}
                </span>
                <shareFetcher.Form method="post" style={{ display: "flex" }}>
                  <input type="hidden" name="intent" value="unshare-doc" />
                  <input type="hidden" name="shareId" value={s.id} />
                  <button
                    type="submit"
                    disabled={shareBusy}
                    onClick={(e) => { if (!confirm(`Remove ${s.user_name}'s access?`)) e.preventDefault(); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--fg)", opacity: 0.3, fontSize: "0.8rem", padding: "0 0.2rem" }}
                  >
                    &times;
                  </button>
                </shareFetcher.Form>
              </div>
            ))}
            {externalShares.map((es) => (
              <div key={es.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.72rem", padding: "0.2rem 0" }}>
                <span>
                  <span style={{ fontWeight: 600 }}>{es.external_email}</span>
                  <span style={{ marginLeft: "0.3rem", opacity: 0.4, fontSize: "0.6rem" }}>invited</span>
                </span>
                <shareFetcher.Form method="post" style={{ display: "flex" }}>
                  <input type="hidden" name="intent" value="unshare-doc" />
                  <input type="hidden" name="shareId" value={es.id} />
                  <button
                    type="submit"
                    disabled={shareBusy}
                    onClick={(e) => { if (!confirm(`Remove access for ${es.external_email}?`)) e.preventDefault(); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--fg)", opacity: 0.3, fontSize: "0.8rem", padding: "0 0.2rem" }}
                  >
                    &times;
                  </button>
                </shareFetcher.Form>
              </div>
            ))}
          </div>
        )}


        {/* Public links */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", border: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)", borderRadius: "0.5rem", padding: "0.75rem" }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 500, opacity: 0.4 }}>Public links</span>
          <ShareToggleSection
            label="View only"
            enabled={!!currentViewToken}
            token={currentViewToken}
            baseUrl={baseUrl}
            copied={copied === "view"}
            onCopy={() => currentViewToken && copyLink(currentViewToken, "view")}
            form={
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="toggle-doc-view" />
                <input type="hidden" name="docId" value={docId} />
                <input type="hidden" name="enabled" value={currentViewToken ? "false" : "true"} />
                <button type="submit" className="sr-only" />
              </fetcher.Form>
            }
            onToggle={() => {
              const form = document.querySelector<HTMLFormElement>(
                `form:has(input[name="intent"][value="toggle-doc-view"])`
              );
              form?.requestSubmit();
            }}
          />
          <ShareToggleSection
            label="Can edit"
            enabled={!!currentEditToken}
            token={currentEditToken}
            baseUrl={baseUrl}
            copied={copied === "edit"}
            onCopy={() => currentEditToken && copyLink(currentEditToken, "edit")}
            form={
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="toggle-doc-edit" />
                <input type="hidden" name="docId" value={docId} />
                <input type="hidden" name="enabled" value={currentEditToken ? "false" : "true"} />
                <button type="submit" className="sr-only" />
              </fetcher.Form>
            }
            onToggle={() => {
              const form = document.querySelector<HTMLFormElement>(
                `form:has(input[name="intent"][value="toggle-doc-edit"])`
              );
              form?.requestSubmit();
            }}
          />
          {(currentViewToken || currentEditToken) && (
            <ShareLinkSettings
              docId={docId}
              settingsFetcher={settingsFetcher}
              shareExpiresAt={currentExpiresAt}
              hasPassword={currentHasPassword}
            />
          )}
        </div>
      </div>
  );

  if (embedded) return shareContent;

  return (
    <div style={inlinePanelStyle}>
      <div style={inlineHeaderStyle}>
        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>Share</span>
        <button
          onClick={onClose}
          style={inlineCloseBtnStyle}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
        >&times;</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {shareContent}
      </div>
    </div>
  );
}

const inlinePanelStyle: React.CSSProperties = {
  width: "min(22rem, 35vw)",
  flexShrink: 0,
  background: "var(--bg)",
  borderLeft: "1px solid color-mix(in srgb, var(--fg) 12%, transparent)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const inlineHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0.75rem",
  borderBottom: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
};

const inlineCloseBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: "1.2rem",
  color: "var(--fg)",
  cursor: "pointer",
  padding: "0 0.25rem",
  opacity: 0.5,
  transition: "opacity var(--ease-out)",
};

const inlineInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: "100px",
  fontSize: "0.72rem",
  padding: "0.3rem 0.5rem",
  border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
  borderRadius: "var(--radius-xs)",
  background: "var(--bg)",
  color: "var(--fg)",
  outline: "none",
};

const inlineSubmitBtnStyle: React.CSSProperties = {
  fontSize: "0.72rem",
  padding: "0.3rem 0.5rem",
  border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
  borderRadius: "var(--radius-xs)",
  background: "color-mix(in srgb, var(--fg) 8%, transparent)",
  color: "var(--fg)",
  cursor: "pointer",
  transition: "background var(--ease-out)",
};

// ─── Folder share dialog ────────────────────────────────

function FolderShareDialog({
  folderId,
  onClose,
}: {
  folderId: string;
  onClose: () => void;
}) {
  const loadFetcher = useFetcher<{ shares: FolderShare[]; groups: GroupWithMeta[] }>();
  const actionFetcher = useFetcher<{ error?: string; success?: string }>();
  const { toast } = useToast();

  // Load shares on mount
  useEffect(() => {
    loadFetcher.load(`/api/folder-shares/${folderId}`);
  }, [folderId]);

  // Re-load shares whenever an action completes
  const prevActionState = useRef(actionFetcher.state);
  useEffect(() => {
    if (prevActionState.current !== "idle" && actionFetcher.state === "idle") {
      loadFetcher.load(`/api/folder-shares/${folderId}`);
      if (actionFetcher.data?.error) {
        toast(actionFetcher.data.error, "error");
      } else if (actionFetcher.data?.success) {
        toast(actionFetcher.data.success, "success");
      }
    }
    prevActionState.current = actionFetcher.state;
  }, [actionFetcher.state, folderId]);

  const shares = loadFetcher.data?.shares ?? [];
  const groups = loadFetcher.data?.groups ?? [];
  const loading = loadFetcher.state === "loading" && !loadFetcher.data;
  const busy = actionFetcher.state !== "idle";

  const trapRef = useFocusTrap<HTMLDivElement>(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-plumage/40" onClick={onClose}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Share folder"
        className="flex max-h-[70vh] w-[min(28rem,90vw)] flex-col gap-4 rounded-lg border border-fg/15 bg-bg p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="m-0 flex items-center gap-2 text-sm font-bold">
            <ShareIcon className="h-4 w-4 opacity-50" />
            Share folder
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer border-none bg-transparent p-1 text-fg opacity-50 transition-opacity hover:opacity-100"
          >
            &times;
          </button>
        </div>

        {loading ? (
          <p className="m-0 text-center text-xs opacity-40">Loading…</p>
        ) : (
          <>
            {/* Share with group */}
            {groups.length > 0 && (
              <actionFetcher.Form method="post" className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
                const fd = new FormData(e.currentTarget);
                if (!fd.get("groupId")) { e.preventDefault(); toast("Please select a group first", "error"); }
              }}>
                <input type="hidden" name="intent" value="share-folder" />
                <input type="hidden" name="folderId" value={folderId} />
                <input type="hidden" name="shareType" value="group" />
                <select
                  name="groupId"
                  className="flex-1 min-w-[140px] rounded-lg border border-fg/15 bg-bg px-3 py-1.5 text-xs text-fg outline-none focus:border-accent/40"
                >
                  <option value="">Select a group…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={busy}
                  className="cursor-pointer rounded-lg border border-accent/25 bg-accent/[0.08] px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Share
                </button>
              </actionFetcher.Form>
            )}

            {/* Share with user */}
            <actionFetcher.Form method="post" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="intent" value="share-folder" />
              <input type="hidden" name="folderId" value={folderId} />
              <input type="hidden" name="shareType" value="user" />
              <UserAutocomplete
                name="email"
                placeholder="Name or email…"
                required
                className="flex-1 min-w-[140px] rounded-lg border border-fg/15 bg-bg px-3 py-1.5 text-xs text-fg outline-none placeholder:text-fg/25 focus:border-accent/40"
              />
              <button
                type="submit"
                disabled={busy}
                className="cursor-pointer rounded-lg border border-accent/25 bg-accent/[0.08] px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Share
              </button>
            </actionFetcher.Form>

            {/* Existing shares */}
            {shares.length > 0 && (
              <div className="flex flex-col gap-1 overflow-y-auto">
                <h4 className="m-0 text-xs font-medium opacity-40">Current shares</h4>
                {shares.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded px-2 py-1.5 transition-colors hover:bg-fg/[0.03]"
                  >
                    <div className="text-xs">
                      {s.group_name ? (
                        <span className="font-medium">{s.group_name}</span>
                      ) : (
                        <span>
                          <span className="font-medium">{s.user_name}</span>
                          <span className="ml-1 opacity-40">{s.user_email}</span>
                        </span>
                      )}
                      {s.status === "pending" && (
                        <span className="ml-2 rounded-full bg-tawny/10 px-2 py-0.5 text-[0.6rem] text-tawny">
                          pending
                        </span>
                      )}
                    </div>
                    <actionFetcher.Form method="post" className="flex">
                      <input type="hidden" name="intent" value="unshare-folder" />
                      <input type="hidden" name="shareId" value={s.id} />
                      <button
                        type="submit"
                        disabled={busy}
                        onClick={(e) => {
                          const name = s.group_name || s.user_name || s.user_email;
                          if (!confirm(`Remove ${name}'s access?`)) e.preventDefault();
                        }}
                        className="cursor-pointer rounded border-none bg-transparent p-1 text-fg/30 transition-colors hover:text-scarlet disabled:opacity-40"
                        title="Remove share"
                      >
                        <TrashIcon className="h-3 w-3" />
                      </button>
                    </actionFetcher.Form>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
