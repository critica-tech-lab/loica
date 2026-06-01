import { useState } from "react";
import { useDocument } from "~/lib/DocumentContext";
import { timeAgo, formatDate } from "~/lib/ui-utils";
import type { PanelId } from "./ActivityBar";
import type { ResolvedThread } from "./comment-decorations";
import { CommentPanel } from "./CommentPanel";
import { TrackChangesPanel } from "./TrackChangesPanel";
import { VersionPanel } from "./VersionPanel";
import { InlineSharePanel } from "./ShareDialog";
import { useToast } from "~/components/Toast";
import { TEMPLATES } from "~/lib/templates";
import { templateOwners } from "~/extensions";
import { useEnabledExtensionIds } from "~/root";

export function SidePanel() {
  const {
    activePanel,
    setActivePanel,
    document: doc,
    comments,
    user,
    focusedCommentId,
    focusedSuggestionId,
    setFocusedCommentId,
    setFocusedSuggestionId,
    editorApi,
    sendMention,
    content,
    restoreVersion,
    saveVersion,
    creatorName,
    modifierName,
    isShared,
  } = useDocument();

  if (!activePanel) return null;

  const closePanel = () => { setActivePanel(null); setFocusedCommentId(null); setFocusedSuggestionId(null); };

  switch (activePanel) {
    case "comments":
      return (
        <CommentPanel
          threads={comments}
          currentUserId={user.id}
          focusedThreadId={focusedCommentId}
          focusedSuggestionId={focusedSuggestionId}
          onClose={closePanel}
          onScrollTo={(pos) => editorApi.current?.scrollToPos(pos)}
          onReply={(threadId, body) => editorApi.current?.addReply(threadId, body)}
          onEditComment={(commentId, body) => editorApi.current?.updateComment(commentId, body)}
          onDeleteComment={(commentId) => editorApi.current?.deleteComment(commentId)}
          onResolveThread={(threadId) => { editorApi.current?.resolveThread(threadId); setActivePanel(null); setFocusedCommentId(null); }}
          onUnresolveThread={(threadId) => editorApi.current?.unresolveThread(threadId)}
          onFinish={() => editorApi.current?.focus()}
          onMention={sendMention}
        />
      );

    case "history":
      return (
        <VersionPanel
          inline
          docId={doc.id}
          onClose={closePanel}
          onRestore={restoreVersion}
          onSaveVersion={saveVersion}
        />
      );

    case "share":
      return (
        <SharePanel
          docId={doc.id}
          publicToken={doc.public_token ?? null}
          editToken={doc.edit_token ?? null}
          shareExpiresAt={doc.share_expires_at ?? null}
          hasPassword={!!doc.share_password_hash}
          onClose={closePanel}
        />
      );

    case "info":
      return (
        <InfoPanel
          docId={doc.id}
          content={content}
          onClose={closePanel}
          onInsertTemplate={!isShared ? (text) => editorApi.current?.insertAt(0, text) : undefined}
          creatorName={creatorName}
          modifierName={modifierName}
          createdAt={doc.created_at ? Number(doc.created_at) : null}
          updatedAt={doc.updated_at ? Number(doc.updated_at) : null}
        />
      );

    case "changes":
      return (
        <PanelShell onClose={closePanel} title="Changes">
          <TrackChangesPanel />
        </PanelShell>
      );

    default:
      return null;
  }
}

function PanelShell({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "280px", borderLeft: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)", background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 1rem", borderBottom: "1px solid color-mix(in srgb, var(--fg) 8%, transparent)", flexShrink: 0 }}>
        <span style={{ fontWeight: 600, fontSize: "0.85rem", fontFamily: "var(--font-ui)" }}>{title}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "color-mix(in srgb, var(--fg) 55%, transparent)", fontSize: "1rem", lineHeight: 1 }} aria-label="Close">×</button>
      </div>
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

// ─── Share panel ─────────────────────────────────────────

function SharePanel({
  docId,
  publicToken,
  editToken,
  shareExpiresAt,
  hasPassword,
  onClose,
}: {
  docId: string;
  publicToken: string | null;
  editToken: string | null;
  shareExpiresAt: number | null;
  hasPassword: boolean;
  onClose: () => void;
}) {
  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <span className="text-[0.85rem] font-bold">Share</span>
        <button onClick={onClose} className="side-panel-close">&times;</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <InlineSharePanel
          docId={docId}
          publicToken={publicToken}
          editToken={editToken}
          shareExpiresAt={shareExpiresAt}
          hasPassword={hasPassword}
          onClose={onClose}
          embedded
        />
      </div>
    </div>
  );
}

// ─── Info panel ──────────────────────────────────────────


function generateToc(content: string): string {
  const lines = content.split("\n");
  const toc: string[] = ["## Table of Contents\n"];
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (!match) continue;
    const level = match[1].length;
    const text = match[2].trim();
    const slug = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    const indent = "  ".repeat(level - 1);
    toc.push(`${indent}- [${text}](#${slug})`);
  }
  return toc.join("\n") + "\n\n";
}

function InfoPanel({
  docId,
  content,
  onClose,
  onInsertTemplate,
  creatorName,
  modifierName,
  createdAt,
  updatedAt,
}: {
  docId: string;
  content: string;
  onClose: () => void;
  onInsertTemplate?: (text: string) => void;
  creatorName?: string | null;
  modifierName?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);
  const { toast } = useToast();
  const enabledExtensionIds = useEnabledExtensionIds();

  async function downloadExport(
    url: string,
    fallbackName: string,
    setBusy: (b: boolean) => void,
    errorMsg: string
  ) {
    setBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const cd = res.headers.get("Content-Disposition");
      a.download = cd?.match(/filename="?([^"]+)"?/)?.[1] ?? fallbackName;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast(errorMsg, "error");
    } finally {
      setBusy(false);
    }
  }

  const hasMetadata = !!(creatorName || modifierName || createdAt || updatedAt);

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <span className="text-[0.85rem] font-bold">Info</span>
        <button onClick={onClose} className="side-panel-close">&times;</button>
      </div>

      <div className="info-panel-body">
        {/* ── Metadata card ── */}
        {hasMetadata && (
          <div className="info-card">
            {creatorName && (
              <div className="info-card-row">
                <span className="info-card-label">Author</span>
                <span className="info-card-value">{creatorName}</span>
              </div>
            )}
            {createdAt && (
              <div className="info-card-row">
                <span className="info-card-label">Created</span>
                <span className="info-card-value" title={formatDate(createdAt)}>{timeAgo(createdAt)}</span>
              </div>
            )}
            {modifierName && (
              <div className="info-card-row">
                <span className="info-card-label">Last edited by</span>
                <span className="info-card-value">{modifierName}</span>
              </div>
            )}
            {updatedAt && (
              <div className="info-card-row">
                <span className="info-card-label">Modified</span>
                <span className="info-card-value" title={formatDate(updatedAt)}>{timeAgo(updatedAt)}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Export downloads ── */}
        <div className="info-section">
          <div className="info-section-label">Download as</div>
          <div className="info-export-grid">
            <a href={`/api/doc-download/${docId}`} download className="info-export-pill">
              <span className="info-export-pill-icon">MD</span>
              Markdown
            </a>
            <button
              disabled={pdfBusy}
              className="info-export-pill"
              onClick={() =>
                downloadExport(
                  `/api/doc-pdf/${docId}`,
                  "document.pdf",
                  setPdfBusy,
                  "Could not generate PDF. Try again or download as Markdown instead."
                )
              }
            >
              <span className="info-export-pill-icon">PDF</span>
              {pdfBusy ? "Preparing..." : "PDF document"}
            </button>
            <button
              disabled={docxBusy}
              className="info-export-pill"
              onClick={() =>
                downloadExport(
                  `/api/doc-docx/${docId}`,
                  "document.docx",
                  setDocxBusy,
                  "Could not generate Word file. Try again or download as Markdown instead."
                )
              }
            >
              <span className="info-export-pill-icon">DOC</span>
              {docxBusy ? "Preparing..." : "Word document"}
            </button>
          </div>
        </div>

        {/* ── Insert templates ── */}
        {onInsertTemplate && (
          <div className="info-section">
            <div className="info-section-label">Insert</div>
            <div className="info-template-list">
              <button
                className="info-template-btn"
                onClick={() => {
                  const toc = generateToc(content);
                  onInsertTemplate(toc);
                }}
              >
                <span className="info-template-icon">#</span>
                Table of contents
              </button>
              {TEMPLATES.filter((t) => {
                const owner = templateOwners.get(t.id);
                return !owner || enabledExtensionIds.has(owner);
              }).map((tpl) => (
                <button
                  key={tpl.id}
                  className="info-template-btn"
                  onClick={() => {
                    onInsertTemplate(tpl.generateContent());
                    onClose();
                  }}
                >
                  <span className="info-template-icon">{tpl.icon}</span>
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
