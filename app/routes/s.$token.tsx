import { useFetcher, useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";
import type { Route } from "./+types/s.$token";
import { getDocumentByToken, updateDocument, verifySharePassword } from "~/lib/document.server";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "~/components/Editor";
import type { Peer } from "~/components/Editor";
import { useDocTypeExtension } from "~/extensions/hooks";
import { Toolbar } from "~/components/Toolbar";
import { PMToolbar } from "~/components/PMToolbar";
import { ProseMirrorEditor } from "~/components/ProseMirrorEditor";
import type { PMActiveState, TrackChangesActiveState } from "~/components/editor/types";
import { LinkModal } from "~/components/LinkModal";

// ProseMirror is the default editor on this branch. Set VITE_PM_EDITOR=0 to
// fall back to the legacy CodeMirror editor.
const USE_PM = import.meta.env.VITE_PM_EDITOR !== "0";
import { PresenceIndicator } from "~/components/PresenceIndicator";
import { CommentPopup } from "~/components/CommentPopup";
import { DocActionBar, floatingBubbleBtnStyle } from "~/components/DocActionBar";
import type { ConnectionStatus } from "~/components/DocActionBar";
import type { ResolvedThread } from "~/components/comment-decorations";
import { LogoIcon } from "~/components/icons";
import { getDocumentType } from "~/lib/templates";

// ─── Random guest names ──────────────────────────────────────

const BIRDS = [
  "Perdiz","Pato","Cisne","Piuquén","Caiquén","Caranca","Canquén","Quetru",
  "Codorniz","Faisán","Flamenco","Pimpollo","Picurio","Huala","Blanquillo",
  "Paloma","Torcaza","Tórtola","Tortolita","Pirincho","Cuclillo","Picaflor",
  "Pidén","Tagüita","Pidencito","Tagua","Chorlo","Queltehue","Pilpilén",
  "Chorlito","Zarapito","Playero","Becacina","Pitotoy","Perdicita","Rayador",
  "Gaviota","Gaviotín","Pingüino","Albatros","Golondrina","Piquero","Yeco",
  "Cormorán","Pelícano","Garza","Bandurria","Cóndor","Jote","Bailarín",
  "Peuquito","Peuco","Aguilucho","Águila","Lechuza","Tucúquere","Concón",
  "Chuncho","Pequén","Carpinterito","Pitío","Traro","Carancho","Tiuque",
  "Cernícalo","Halcón","Perico","Cotorra","Cachaña","Choroy","Tricahue",
  "Turca","Chucao","Churrín","Bandurrilla","Patagón","Rayadito","Tijeral",
  "Birro","Cachudito","Picabuey","Pintaguá","Burlisto","Pitajo","Colegial",
  "Run-run","Diucón","Mero","Mosqueta","Verderón","Cuervo","Chercán",
  "Zorzalito","Zorzal","Tenca","Gorrión","Jilguero","Chincol","Mirlo",
  "Tordo","Trile","Piranga","Tangara","Chirihue","Cometocino","Diuca",
  "Semillero","Negrillo","Pizarrita","Monterita","Naranjero","Celestino",
];
const PALETTE = [
  "#AF3029", "#205EA6", "#66800B", "#D0A215", "#5E409D", "#A02F6F",
  "#24837B", "#879A39", "#DA702C", "#4385BE", "#3AA99F", "#D14D41",
];

function randomGuestIdentity() {
  const name = BIRDS[Math.floor(Math.random() * BIRDS.length)];
  const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  return { name, color };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// ─── Route ───────────────────────────────────────────────────

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const d = data as { document?: { title?: string }; docTitle?: string } | undefined;
  const title = d?.document?.title ?? d?.docTitle ?? "Document";
  return [{ title: `${title} — loica` }];
};

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq === -1) return [];
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      return [[key, decodeURIComponent(val)]];
    })
  );
}

function isPasswordAuthenticated(request: Request, token: string): boolean {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const cookies = parseCookies(cookieHeader);
  return cookies[`__share_pwd_${token}`] === "1";
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const result = getDocumentByToken(params.token);
  if (!result) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const trackChanges = url.searchParams.get("track") === "1";

  // If password protected, check if user is authenticated
  if (result.hasPassword && !isPasswordAuthenticated(request, params.token)) {
    return {
      needsPassword: true,
      docTitle: result.document.title,
      shareToken: params.token,
    };
  }

  return {
    document: result.document,
    mode: result.mode,
    shareToken: params.token,
    trackChanges,
    externalEmail: result.externalEmail ?? null,
    wsUrl: process.env.WS_URL ?? (() => {
      return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.hostname}:4001`;
    })(),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = form.get("intent");

  // Handle password verification
  if (intent === "verify-password") {
    const password = String(form.get("password") || "");
    const result = getDocumentByToken(params.token);
    if (!result) throw new Response("Not found", { status: 404 });

    const isValid = await verifySharePassword(result.document.id, password);
    if (!isValid) {
      return { ok: false, error: "Invalid password" };
    }

    // Set cookie to mark password as verified
    const useSecureCookie = process.env.SECURE_COOKIE === "true";
    const secure = useSecureCookie ? " Secure;" : "";
    const setCookie = `__share_pwd_${params.token}=1; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=2592000`;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": setCookie,
      },
    });
  }

  // Handle content save (for public_edit mode)
  const result = getDocumentByToken(params.token);
  if (!result || result.mode !== "public_edit") {
    throw new Response("Forbidden", { status: 403 });
  }

  if (!isPasswordAuthenticated(request, params.token) && result.hasPassword) {
    throw new Response("Forbidden", { status: 403 });
  }

  const content = form.get("content");
  if (content != null) {
    updateDocument(result.document.id, { content: String(content) }, "guest");
  }
  return { ok: true };
}

// ─── Password gate component ──────────────────────────────

function PasswordGate({ docTitle, token }: { docTitle: string; token: string }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    fetcher.submit(
      { intent: "verify-password", password },
      { method: "POST" }
    );
  };

  useEffect(() => {
    if (fetcher.data?.ok === true) {
      // Cookie is set — reload to let the loader serve the full document
      window.location.reload();
    } else if (fetcher.data?.ok === false && fetcher.data?.error) {
      setError(fetcher.data.error);
    }
  }, [fetcher.data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "color-mix(in srgb, var(--fg) 3%, var(--bg))", justifyContent: "center", alignItems: "center", padding: "1rem" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: "24rem", width: "100%", padding: "2rem", borderRadius: "0.75rem", border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)", background: "var(--bg)" }}>
        <div>
          <h1 style={{ margin: "0 0 0.5rem 0", fontSize: "1.125rem", fontWeight: 700 }}>
            {docTitle}
          </h1>
          <p style={{ margin: "0", fontSize: "0.875rem", opacity: 0.6 }}>
            This document is password protected
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label htmlFor="password" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
              Password
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", borderRadius: "0.5rem", border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)", padding: "0 0.75rem", background: "color-mix(in srgb, var(--fg) 3%, transparent)" }}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                placeholder="Enter password…"
                style={{ flex: 1, border: "none", background: "transparent", padding: "0.75rem 0", outline: "none", fontSize: "0.875rem" }}
                disabled={fetcher.state !== "idle"}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ border: "none", background: "transparent", cursor: "pointer", padding: "0.5rem", opacity: 0.5, transition: "opacity 0.2s" }}
                disabled={fetcher.state !== "idle"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {error && <p style={{ margin: "0", fontSize: "0.8rem", color: "var(--color-error, #dc2626)" }}>{error}</p>}
          </div>

          <button
            type="submit"
            disabled={fetcher.state !== "idle"}
            style={{ padding: "0.75rem 1rem", borderRadius: "0.5rem", border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)", background: "color-mix(in srgb, var(--accent) 8%, transparent)", color: "var(--accent)", fontWeight: 500, cursor: "pointer", transition: "background-color 0.2s", opacity: fetcher.state !== "idle" ? 0.6 : 1 }}
          >
            {fetcher.state !== "idle" ? "Verifying..." : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function SharePage() {
  const data = useLoaderData<typeof loader>();
  const needsPassword = 'needsPassword' in data ? data.needsPassword : false;
  const docTitle = 'docTitle' in data ? data.docTitle : undefined;
  const shareToken = 'shareToken' in data ? data.shareToken : undefined;

  const document = !needsPassword ? (data as any).document : null;
  const mode = !needsPassword ? (data as any).mode : null;
  const wsUrl = !needsPassword ? (data as any).wsUrl : null;
  const trackChanges: boolean = !needsPassword ? Boolean((data as any).trackChanges) : false;
  const externalEmail: string | null = !needsPassword ? (data as any).externalEmail : null;
  const isEditable = mode === "public_edit";

  // All hooks must be called unconditionally (rules of hooks)
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [saving, setSaving] = useState(false);
  const randomIdentity = useMemo(() => randomGuestIdentity(), []);
  const guestIdentity = useMemo(() => {
    if (externalEmail) {
      return { name: externalEmail, color: PALETTE[Math.abs(hashCode(externalEmail)) % PALETTE.length] };
    }
    return randomIdentity;
  }, [externalEmail, randomIdentity]);

  if (needsPassword) {
    return <PasswordGate docTitle={docTitle || "Document"} token={shareToken || ""} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "color-mix(in srgb, var(--fg) 3%, var(--bg))" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "2.5rem",
          padding: "0 1rem",
          borderBottom: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
          flexShrink: 0,
        }}
      >
        {/* Left group: logo / title */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0, flex: 1 }}>
          <a
            href="/"
            style={{ display: "flex", alignItems: "center", textDecoration: "none", flexShrink: 0 }}
          >
            <LogoIcon style={{ width: "auto", height: "1rem" }} />
          </a>
          <span style={{ opacity: 0.2, fontSize: "0.8rem", flexShrink: 0 }}>/</span>
          <span style={{ fontWeight: 600, fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {document.title}
          </span>
        </div>
        {/* Right side */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
          <PresenceIndicator peers={peers} currentUser={guestIdentity} />
          {isEditable && (
            <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.03em", display: "inline-flex", alignItems: "center", gap: "0.2rem" }}>
              {saving ? (
                <span style={{ opacity: 0.35 }}>saving…</span>
              ) : (
                <span style={{ opacity: 0.35, display: "inline-flex", alignItems: "center", gap: "0.2rem" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage, #66800B)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  saved
                </span>
              )}
            </span>
          )}
          <span
            style={{
              fontSize: "0.6rem",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              opacity: 0.5,
              border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
              borderRadius: "3px",
              padding: "0.15rem 0.4rem",
              lineHeight: 1,
            }}
          >
            {isEditable ? "public edit" : "view only"}
          </span>
        </div>
      </header>

      {isEditable ? (
        <EditableView
          document={document}
          wsUrl={wsUrl}
          shareToken={shareToken ?? ""}
          guestIdentity={guestIdentity}
          onPresenceChange={setPeers}
          onConnectionStatus={setConnectionStatus}
          onSavingChange={setSaving}
        />
      ) : (
        <LiveReadOnlyView
          document={document}
          wsUrl={wsUrl}
          shareToken={shareToken ?? ""}
          guestIdentity={guestIdentity}
          onPresenceChange={setPeers}
          onConnectionStatus={setConnectionStatus}
        />
      )}

    </div>
  );
}

// ─── Read-only view with live Yjs sync ─────────────────────

function LiveReadOnlyView({
  document,
  wsUrl,
  shareToken,
  guestIdentity,
  onPresenceChange,
  onConnectionStatus,
}: {
  document: { id: string; content: string };
  wsUrl: string;
  shareToken: string;
  guestIdentity: { name: string; color: string };
  onPresenceChange: (peers: Peer[]) => void;
  onConnectionStatus: (status: ConnectionStatus) => void;
}) {
  const [editorReady, setEditorReady] = useState(false);
  const docType = getDocumentType(document.content || "");
  const ExtensionEditor = useDocTypeExtension(docType)?.EditorView ?? null;

  return (
    <>
    <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0, position: "relative", cursor: "default" }}>
      {!USE_PM && !editorReady && document.content && !ExtensionEditor && (
        <pre
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            padding: "16px 48px",
            overflow: "auto",
            fontFamily: "var(--font-editor, ui-monospace, monospace)",
            fontSize: "15px",
            lineHeight: "1.6",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            opacity: 0.5,
            pointerEvents: "none",
            margin: 0,
          }}
        >
          {document.content}
        </pre>
      )}
      {ExtensionEditor ? (
        <ExtensionEditor
          initialContent={document.content}
          onChange={() => {}}
          onReady={() => { setEditorReady(true); }}
          readOnly
          docId={document.id}
          wsUrl={wsUrl}
          wsParams={{ token: shareToken }}
          userInfo={{ name: `${guestIdentity.name} (viewer)`, color: guestIdentity.color }}
          onPresenceChange={onPresenceChange}
          onConnectionStatus={onConnectionStatus}
        />
      ) : USE_PM ? (
        <ProseMirrorEditor
          readOnly
          docId={document.id}
          wsUrl={wsUrl}
          wsParams={{ token: shareToken }}
          userInfo={{ name: `${guestIdentity.name} (viewer)`, color: guestIdentity.color }}
          onPresenceChange={onPresenceChange}
          onConnectionStatus={onConnectionStatus}
          onReady={() => { setEditorReady(true); }}
        />
      ) : (
        <Editor
          initialValue={document.content}
          readOnly
          docId={document.id}
          wsUrl={wsUrl}
          wsParams={{ token: shareToken }}
          userInfo={{ name: `${guestIdentity.name} (viewer)`, color: guestIdentity.color }}
          onPresenceChange={onPresenceChange}
          onConnectionStatus={onConnectionStatus}
          onReady={() => { setEditorReady(true); }}
        />
      )}
    </div>
    <DocActionBar content={document.content} showBranding />
    </>
  );
}

// ─── Public editable view ─────────────────────────────────

function EditableView({
  document,
  wsUrl,
  shareToken,
  guestIdentity,
  onPresenceChange,
  onConnectionStatus,
  onSavingChange,
}: {
  document: { id: string; content: string };
  wsUrl: string;
  shareToken: string;
  guestIdentity: { name: string; color: string };
  onPresenceChange: (peers: Peer[]) => void;
  onConnectionStatus: (status: ConnectionStatus) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const fetcher = useFetcher();
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSaving = fetcher.state !== "idle";

  useEffect(() => { onSavingChange(isSaving); }, [isSaving]);
  const [content, setContent] = useState(document.content);
  const [localConnectionStatus, setLocalConnectionStatus] = useState<ConnectionStatus>("connecting");

  const save = useCallback(
    (c: string) => {
      fetcher.submit({ content: c }, { method: "post" });
    },
    [fetcher]
  );

  function scheduleSave(c: string) {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => save(c), 600);
  }

  useEffect(() => {
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, []);

  const [threads, setThreads] = useState<ResolvedThread[]>([]);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const [commentPopup, setCommentPopup] = useState<{ threadId: string; pos: { x: number; y: number } } | null>(null);
  const editorMountRef = useRef<HTMLDivElement | null>(null);
  const [focusedSuggestionId, setFocusedSuggestionId] = useState<string | null>(null);
  const [pmActiveState, setPmActiveState] = useState<PMActiveState | null>(null);
  const [trackChangesState, setTrackChangesState] = useState<TrackChangesActiveState | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [selectionBubble, setSelectionBubble] = useState<{ top: number; left: number } | null>(null);
  const [linkModal, setLinkModal] = useState<
    | { mode: "add"; initialUrl?: string; onApply: (url: string) => void }
    | { mode: "edit"; initialUrl: string; onApply: (url: string) => void }
    | null
  >(null);
  const editorApi = useRef<{
    getContent: () => string;
    format: (b: string, a: string) => void;
    formatLine: (p: string) => void;
    addComment: (body?: string) => string | undefined;
    addReply: (threadId: string, body: string) => void;
    updateComment: (commentId: string, body: string) => void;
    deleteComment: (commentId: string) => void;
    resolveThread: (threadId: string) => void;
    unresolveThread: (threadId: string) => void;
    scrollToPos: (pos: number) => void;
    focus: () => void;
  } | null>(null);


  const docType = getDocumentType(document.content || "");
  const ExtensionEditor = useDocTypeExtension(docType)?.EditorView ?? null;

  return (
    <>
      {!ExtensionEditor && (
        USE_PM
          ? <PMToolbar canEdit editorApiRef={editorApi as any} activeState={pmActiveState} trackChangesState={trackChangesState} onLink={() => setLinkModal({ mode: "add", onApply: (url) => { editorApi.current?.format("[", `](${url})`); } })} />
          : <Toolbar
              onFormat={(b, a) => editorApi.current?.format(b, a)}
              onFormatLine={(p) => editorApi.current?.formatLine(p)}
              onLink={() => setLinkModal({
                mode: "add",
                onApply: (url) => { editorApi.current?.format("[", `](${url})`); },
              })}
            />
      )}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0, position: "relative" }}>
        {!USE_PM && !editorReady && document.content && !ExtensionEditor && (
          <pre
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 1,
              padding: "16px 48px",
              overflow: "auto",
              fontFamily: "var(--font-editor, ui-monospace, monospace)",
              fontSize: "15px",
              lineHeight: "1.6",
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
              opacity: 0.5,
              pointerEvents: "none",
              margin: 0,
            }}
          >
            {document.content}
          </pre>
        )}
        {ExtensionEditor ? (
          <ExtensionEditor
            initialContent={document.content}
            onChange={(val) => {
              setContent(val);
              scheduleSave(val);
            }}
            onReady={() => { setEditorReady(true); }}
            docId={document.id}
            wsUrl={wsUrl}
            wsParams={{ token: shareToken }}
            userInfo={guestIdentity}
            onPresenceChange={onPresenceChange}
            onConnectionStatus={(s) => { setLocalConnectionStatus(s); onConnectionStatus(s); }}
          />
        ) : USE_PM ? (
          <div style={{ flex: 1, position: "relative", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <ProseMirrorEditor
              docId={document.id}
              wsUrl={wsUrl}
              wsParams={{ token: shareToken }}
              userInfo={guestIdentity}
              mountRefOut={editorMountRef}
              onReady={(api) => { editorApi.current = api; setEditorReady(true); }}
              onPresenceChange={onPresenceChange}
              onConnectionStatus={(s) => { setLocalConnectionStatus(s); onConnectionStatus(s); }}
              onChange={(val) => { setContent(val); scheduleSave(val); }}
              onStateChange={setPmActiveState}
              onTrackChangesStateChange={setTrackChangesState}
              onThreadsChange={setThreads}
              onThreadClick={(thread, pos) => { setFocusedThreadId(thread.id); setFocusedSuggestionId(null); setCommentPopup({ threadId: thread.id, pos }); }}
              focusedCommentId={focusedThreadId}
              onSelectionChange={(sel) => {
                if (!sel) { setSelectionBubble(null); setFocusedThreadId(null); return; }
                if (sel.to > sel.from) {
                  setSelectionBubble({ top: sel.top, left: sel.left });
                } else {
                  setSelectionBubble(null);
                  setFocusedThreadId(null);
                  setCommentPopup(null);
                }
              }}
              autoFocus
            />
            {commentPopup && (() => {
              const thread = threads.find(t => t.id === commentPopup.threadId);
              return thread ? (
                <CommentPopup
                  thread={thread}
                  pos={commentPopup.pos}
                  currentUserId={guestIdentity.name}
                  editorApiRef={editorApi as any}
                  editorRef={editorMountRef}
                  onDismiss={() => { setCommentPopup(null); setFocusedThreadId(null); }}
                />
              ) : null;
            })()}
          </div>
        ) : (
          <Editor
            initialValue={document.content}
            onChange={(val) => {
              setContent(val);
              scheduleSave(val);
            }}
            onThreadsChange={setThreads}
            onThreadClick={(thread) => {
                            setFocusedThreadId(thread.id);
              setFocusedSuggestionId(null);
            }}
            onSelectionChange={(sel) => {
              if (sel && sel.to > sel.from) {
                setSelectionBubble({ top: sel.top, left: sel.left });
              } else {
                setSelectionBubble(null);
              }
            }}
            onReady={(api) => { editorApi.current = api; setEditorReady(true); }}
            onEditLink={(currentUrl, apply) => setLinkModal({ mode: "edit", initialUrl: currentUrl, onApply: apply })}
            onPresenceChange={onPresenceChange}
            autoFocus
            docId={document.id}
            wsUrl={wsUrl}
            wsParams={{ token: shareToken }}
            userInfo={guestIdentity}
            userName={guestIdentity.name}
            onConnectionStatus={(s) => { setLocalConnectionStatus(s); onConnectionStatus(s); }}
          />
        )}

        {selectionBubble && (
          <div
            style={{
              position: "fixed",
              top: selectionBubble.top - 42,
              left: selectionBubble.left,
              zIndex: 60,
              display: "flex",
              gap: "0.25rem",
            }}
          >
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                const newId = editorApi.current?.addComment();
                                setFocusedThreadId(newId ?? null);
                setSelectionBubble(null);
              }}
              style={floatingBubbleBtnStyle}
            >
              + Comment
            </button>
          </div>
        )}

      </div>
      <DocActionBar content={content} connectionStatus={localConnectionStatus} showBranding />
      <LinkModal
        open={linkModal !== null}
        mode={linkModal?.mode ?? "add"}
        initialUrl={linkModal?.initialUrl ?? ""}
        onCancel={() => setLinkModal(null)}
        onSubmit={(url) => {
          linkModal?.onApply(url);
          setLinkModal(null);
        }}
      />
    </>
  );
}
