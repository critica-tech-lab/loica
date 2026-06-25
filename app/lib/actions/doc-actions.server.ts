import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redirect } from "react-router";
import { uploadsDir } from "~/lib/paths.server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  createDocument,
  createPdfDocument,
  trashDocument,
  getDocument,
  getDocumentsByIds,
  moveDocument,
  moveDocumentToWorkspace,
  updateDocument,
  setViewShare,
  setEditShare,
  unshareDocument,
  toggleStar,
  updateShareSettings,
} from "~/lib/document.server";
import {
  getFolder,
  createFolder,
  trashFolder,
  renameFolder,
  moveFolder,
  moveFolderToWorkspace,
  findFolderByName,
} from "~/lib/folder.server";
import { getMembership } from "~/lib/workspace.server";
import { shareDocWithUser, shareDocWithGroup, shareDocWithExternal, unshareDoc as unshareDocShare } from "~/lib/doc-sharing.server";
import { unshareAllFolder, shareFolder, unshareFolder, leaveFolderShare } from "~/lib/sharing.server";
import { getClientIp, checkRateLimit } from "~/lib/rate-limit.server";
import { sendExternalShareNotification } from "~/lib/email.server";
import { db, prep } from "~/lib/db.server";
import { getPublicOrigin } from "~/lib/url.server";
import { randomDocName } from "~/lib/ui-utils";
import { TEMPLATES } from "~/lib/templates";
import { templateOwners } from "~/extensions";
import { getEnabledExtensionIdSet } from "~/extensions/index.server";
import {
  docIdSchema,
  titleSchema,
  contentSchema,
  emailSchema,
  folderIdSchema,
  permissionSchema,
} from "~/lib/validation.server";
import { createNotification } from "~/lib/notification.server";

/** Common context passed from routes into shared action handlers. */
export interface ActionContext {
  user: { id: string; is_admin?: boolean };
  workspace: { id: string };
  role: string;
  form: FormData;
  request: Request;
}

// ── Simple handlers ──────────────────────────────────────────

export function handleToggleStar(ctx: ActionContext) {
  const docId = String(ctx.form.get("docId") || "");
  const newState = toggleStar(ctx.user.id, docId);
  return { starred: newState };
}

export function handleCreateFolder(ctx: ActionContext, parentFolderId: string | null) {
  const name = String(ctx.form.get("name") || "").trim();
  if (!name) return null;
  const result = createFolder(ctx.workspace.id, ctx.user.id, name, parentFolderId);
  if (!result) return { error: "A folder with that name already exists." };
  return null;
}

export function handleRenameDoc(ctx: ActionContext) {
  const docId = String(ctx.form.get("docId"));
  const title = String(ctx.form.get("title") || "").trim();

  // Validate inputs
  try {
    docIdSchema.parse(docId);
    titleSchema.parse(title || "");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: "Invalid input" };
    }
    throw error;
  }

  if (!title) return null;
  const doc = getDocument(docId);
  if (doc && doc.workspace_id === ctx.workspace.id) {
    updateDocument(docId, { title });
  }
  return null;
}

export function handleRenameFolder(ctx: ActionContext) {
  const fid = String(ctx.form.get("folderId"));
  const name = String(ctx.form.get("name") || "").trim();
  if (!name) return null;
  const f = getFolder(fid);
  if (!f || f.workspace_id !== ctx.workspace.id) return null;
  if (!renameFolder(fid, name)) return { error: "A folder with that name already exists." };
  return null;
}

// ── Move handlers ────────────────────────────────────────────

export function handleMoveDoc(ctx: ActionContext) {
  const docId = String(ctx.form.get("docId"));
  const targetFolderId = ctx.form.get("targetFolderId");
  const target = targetFolderId ? String(targetFolderId) : null;

  // Validate inputs
  try {
    docIdSchema.parse(docId);
    if (target) folderIdSchema.parse(target);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: "Invalid input" };
    }
    throw error;
  }

  const doc = getDocument(docId);
  if (!doc || doc.workspace_id !== ctx.workspace.id) return null;
  if (target) {
    const tf = getFolder(target);
    if (!tf || tf.workspace_id !== ctx.workspace.id) return null;
  }
  moveDocument(docId, target);
  return null;
}

/**
 * Move a folder. If the moved folder is the current folder (in folder views),
 * pass `currentFolderId` and `redirectPath` to redirect after move.
 */
export function handleMoveFolder(
  ctx: ActionContext,
  opts?: { currentFolderId?: string; redirectPath?: (targetId: string | null) => string },
) {
  const fid = String(ctx.form.get("folderId"));
  const f = getFolder(fid);
  if (!f || f.workspace_id !== ctx.workspace.id) return null;
  const targetFolderId = ctx.form.get("targetFolderId");
  const target = targetFolderId ? String(targetFolderId) : null;
  if (target) {
    const tf = getFolder(target);
    if (!tf || tf.workspace_id !== ctx.workspace.id) return null;
  }
  try {
    moveFolder(fid, target);
  } catch {
    // circular move — ignore
  }
  if (opts?.currentFolderId && fid === opts.currentFolderId && opts.redirectPath) {
    throw redirect(opts.redirectPath(target));
  }
  return null;
}

// ── Cross-workspace move handlers ────────────────────────────

export function handleMoveDocToWorkspace(ctx: ActionContext) {
  const docId = String(ctx.form.get("docId") || "");
  const targetWorkspaceId = String(ctx.form.get("targetWorkspaceId") || "");
  const targetFolderId = ctx.form.get("targetFolderId");
  const target = targetFolderId ? String(targetFolderId) : null;

  if (!docId || !targetWorkspaceId) return null;

  const doc = getDocument(docId);
  if (!doc || doc.workspace_id !== ctx.workspace.id) return null;

  // Verify user has edit access to the target workspace
  const targetRole = getMembership(targetWorkspaceId, ctx.user.id, ctx.user.is_admin);
  if (!targetRole || targetRole === "viewer") return null;

  // Verify target folder belongs to target workspace (if specified)
  if (target) {
    const tf = getFolder(target);
    if (!tf || tf.workspace_id !== targetWorkspaceId) return null;
  }

  moveDocumentToWorkspace(docId, targetWorkspaceId, target);
  return null;
}

export function handleMoveFolderToWorkspace(ctx: ActionContext) {
  const folderId = String(ctx.form.get("folderId") || "");
  const targetWorkspaceId = String(ctx.form.get("targetWorkspaceId") || "");
  const targetFolderId = ctx.form.get("targetFolderId");
  const target = targetFolderId ? String(targetFolderId) : null;

  if (!folderId || !targetWorkspaceId) return null;

  const folder = getFolder(folderId);
  if (!folder || folder.workspace_id !== ctx.workspace.id) return null;

  // Verify user has edit access to the target workspace
  const targetRole = getMembership(targetWorkspaceId, ctx.user.id, ctx.user.is_admin);
  if (!targetRole || targetRole === "viewer") return null;

  // Verify target folder belongs to target workspace (if specified)
  if (target) {
    const tf = getFolder(target);
    if (!tf || tf.workspace_id !== targetWorkspaceId) return null;
  }

  try {
    moveFolderToWorkspace(folderId, targetWorkspaceId, target);
  } catch {
    return { error: "Cannot move folder — name conflict or invalid target" };
  }
  return null;
}

// ── Delete / trash handlers ──────────────────────────────────

/**
 * Trash a document. `isOwner` means the user can delete any doc in the workspace;
 * otherwise only docs they created.
 */
export function handleTrashDoc(ctx: ActionContext, isOwner: boolean) {
  const docId = String(ctx.form.get("docId"));

  // Validate input
  try {
    docIdSchema.parse(docId);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: "Invalid input" };
    }
    throw error;
  }

  const doc = getDocument(docId);
  if (doc && doc.workspace_id === ctx.workspace.id && (isOwner || doc.created_by === ctx.user.id)) {
    trashDocument(docId, ctx.user.id);
  }
  return null;
}

/**
 * Trash a folder. If `currentFolderId` and `redirectPath` are provided,
 * redirect when deleting the current folder.
 */
export function handleTrashFolder(
  ctx: ActionContext,
  opts?: { currentFolderId?: string; redirectPath?: string },
) {
  const fid = String(ctx.form.get("folderId"));
  const target = getFolder(fid);
  if (target && target.workspace_id === ctx.workspace.id) {
    trashFolder(fid, ctx.user.id);
    if (opts?.currentFolderId && fid === opts.currentFolderId && opts.redirectPath) {
      throw redirect(opts.redirectPath);
    }
  }
  return null;
}

// ── Share handlers ───────────────────────────────────────────

export async function handleShareDoc(ctx: ActionContext) {
  const rl = checkRateLimit(getClientIp(ctx.request), { windowMs: 5 * 60 * 1000, max: 20, prefix: "share" });
  if (!rl.allowed) return { ok: false, error: "Too many share requests. Try again later." };
  const email = String(ctx.form.get("email") || "").trim().toLowerCase();
  const docId = String(ctx.form.get("docId") || "");

  // Validate inputs
  try {
    emailSchema.parse(email);
    docIdSchema.parse(docId);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: "Invalid input" };
    }
    throw error;
  }

  if (!email) return { ok: false, error: "Missing email" };
  const doc = getDocument(docId);
  if (!doc || doc.workspace_id !== ctx.workspace.id) return { ok: false, error: "Document not found" };
  const targetUser = prep<{ id: string }, [string]>(
    "SELECT id FROM users WHERE email = ?"
  ).get(email);
  if (!targetUser) {
    const { token: inviteToken } = shareDocWithExternal(docId, email, ctx.user.id);
    const origin = getPublicOrigin(ctx.request);
    const editUrl = `${origin}/s/${inviteToken}`;
    const doc = getDocument(docId);
    const sharerName = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?").get(ctx.user.id)?.name ?? "Someone";
    sendExternalShareNotification(email, doc?.title ?? "Untitled", sharerName, editUrl);
    return { ok: true, sharedWith: email };
  }
  if (targetUser.id === ctx.user.id) return { ok: false, error: "Cannot share with yourself" };
  const targetName = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?").get(targetUser.id)?.name ?? email;
  shareDocWithUser(docId, targetUser.id, ctx.user.id, getPublicOrigin(ctx.request));
  return { ok: true, sharedWith: targetName };
}

export function handleShareDocGroup(ctx: ActionContext) {
  const rl = checkRateLimit(getClientIp(ctx.request), { windowMs: 5 * 60 * 1000, max: 20, prefix: "share" });
  if (!rl.allowed) throw new Response("Too many share requests. Try again later.", { status: 429 });
  const docId = String(ctx.form.get("docId") || "");
  const groupId = String(ctx.form.get("groupId") || "").trim();
  if (!groupId) return { ok: false, error: "Please select a group first" };
  const doc = getDocument(docId);
  if (!doc || doc.workspace_id !== ctx.workspace.id) throw new Response("Not found", { status: 404 });
  shareDocWithGroup(docId, groupId, ctx.user.id, getPublicOrigin(ctx.request));
  return { ok: true };
}

export function handleUnshareDoc(ctx: ActionContext) {
  // shareId = remove a specific user/group share; docId = remove public tokens
  const shareId = ctx.form.get("shareId");
  if (shareId) {
    unshareDocShare(String(shareId), ctx.workspace.id);
    return { ok: true };
  }
  const docId = String(ctx.form.get("docId"));
  const doc = getDocument(docId);
  if (!doc || doc.workspace_id !== ctx.workspace.id) return null;
  unshareDocument(docId);
  return null;
}

export async function handleToggleDocView(ctx: ActionContext) {
  const docId = String(ctx.form.get("docId"));
  const enabled = ctx.form.get("enabled") === "true";
  const doc = getDocument(docId);
  if (!doc || doc.workspace_id !== ctx.workspace.id) return null;
  const token = await setViewShare(docId, enabled);
  const updated = getDocument(docId);
  return { viewToken: token, shareExpiresAt: updated?.share_expires_at ?? null, hasPassword: !!updated?.share_password_hash };
}

export async function handleToggleDocEdit(ctx: ActionContext) {
  const docId = String(ctx.form.get("docId"));
  const enabled = ctx.form.get("enabled") === "true";
  const doc = getDocument(docId);
  if (!doc || doc.workspace_id !== ctx.workspace.id) return null;
  const token = await setEditShare(docId, enabled);
  const updated = getDocument(docId);
  return { editToken: token, shareExpiresAt: updated?.share_expires_at ?? null, hasPassword: !!updated?.share_password_hash };
}

export async function handleUpdateShareSettings(ctx: ActionContext) {
  const docId = String(ctx.form.get("docId"));
  const doc = getDocument(docId);
  if (!doc || doc.workspace_id !== ctx.workspace.id) return null;

  const expiresAtRaw = ctx.form.get("expiresAt");
  // undefined = not submitted (don't touch), null = clear, number = set
  const expiresAt = expiresAtRaw !== null
    ? (String(expiresAtRaw) ? Math.floor(new Date(String(expiresAtRaw)).getTime() / 1000) : null)
    : undefined;

  const password = ctx.form.get("sharePassword");
  const clearPassword = ctx.form.get("clearPassword") === "true";

  await updateShareSettings(docId, {
    expiresAt,
    password: clearPassword ? null : (password ? String(password) : undefined),
  });

  return { ok: true };
}

export function handleUnshareAllFolder(ctx: ActionContext, ownerRoles: string[]) {
  if (!ownerRoles.includes(ctx.role)) return { error: "Only owners can remove shares." };
  const folderId = String(ctx.form.get("folderId"));
  const f = getFolder(folderId);
  if (!f || f.workspace_id !== ctx.workspace.id) return null;
  unshareAllFolder(folderId);
  return null;
}

// ── Bulk handlers ────────────────────────────────────────────

export function handleBulkDelete(ctx: ActionContext, isOwner: boolean) {
  const ids = String(ctx.form.get("docIds") || "").split(",").filter(Boolean);
  const docs = getDocumentsByIds(ids);
  let deleted = 0;
  for (const doc of docs) {
    if (doc.workspace_id === ctx.workspace.id && (isOwner || doc.created_by === ctx.user.id)) {
      trashDocument(doc.id, ctx.user.id);
      deleted++;
    }
  }
  return { bulkDeleted: deleted };
}

export function handleBulkUnshare(ctx: ActionContext) {
  const ids = String(ctx.form.get("docIds") || "").split(",").filter(Boolean);
  const docs = getDocumentsByIds(ids);
  let unshared = 0;
  for (const doc of docs) {
    if (doc.workspace_id === ctx.workspace.id && (doc.public_token || doc.edit_token)) {
      unshareDocument(doc.id);
      unshared++;
    }
  }
  return { bulkUnshared: unshared };
}

// ── Create doc ───────────────────────────────────────────────

export function handleCreateDoc(
  ctx: ActionContext,
  folderId: string | null,
  redirectPath: (docId: string) => string,
) {
  const templateId = String(ctx.form.get("template") || "");
  // Reject templates owned by a disabled extension (defence in depth — the
  // New menu already hides them, but a malicious POST shouldn't bypass).
  const owner = templateId ? templateOwners.get(templateId) : null;
  const templateIsAllowed = !owner || getEnabledExtensionIdSet().has(owner);
  const template = templateId && templateIsAllowed ? TEMPLATES.find((t) => t.id === templateId) : null;
  const title = String(ctx.form.get("title") || randomDocName()).trim();
  const content = template ? template.generateContent() : undefined;
  const doc = createDocument(ctx.workspace.id, ctx.user.id, title, folderId, content);
  throw redirect(redirectPath(doc.id));
}

export function handleDuplicateDoc(
  ctx: ActionContext,
  redirectPath: (docId: string) => string,
) {
  const docId = String(ctx.form.get("docId") || "");
  const doc = getDocument(docId);
  if (!doc || doc.workspace_id !== ctx.workspace.id) {
    throw new Response("Not found", { status: 404 });
  }
  const copy = createDocument(
    doc.workspace_id,
    ctx.user.id,
    `Copy of ${doc.title}`,
    doc.folder_id,
    doc.content ?? undefined,
  );
  throw redirect(redirectPath(copy.id));
}

// ── File Upload ──────────────────────────────────────────────

const UPLOAD_DIR = uploadsDir;
const UPLOAD_MAX_SIZE = 20 * 1024 * 1024; // 20 MB

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".pdf", ".pages",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".mp3", ".wav", ".flac", ".ogg",
  ".mp4", ".mov", ".avi", ".webm",
  ".zip", ".rar", ".gz", ".tar",
  ".csv", ".json", ".txt",
]);

function getAllowedExtension(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filename.slice(dot).toLowerCase();
  return ALLOWED_UPLOAD_EXTENSIONS.has(ext) ? ext : null;
}

export async function handleUploadFile(ctx: ActionContext, folderId: string | null) {
  const file = ctx.form.get("file");
  if (!file || !(file instanceof File)) throw new Response("Missing file", { status: 400 });
  if (file.size > UPLOAD_MAX_SIZE) throw new Response("File too large (max 20MB)", { status: 400 });

  const ext = getAllowedExtension(file.name);
  if (!ext) throw new Response("Unsupported file type", { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  // If a relative path is provided (from folder upload), create intermediate folders
  const relativePath = ctx.form.get("path");
  if (relativePath && typeof relativePath === "string") {
    const parts = relativePath.split("/");
    if (parts.length > 1) {
      let parentFolderId = folderId;
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        const existing = findFolderByName(ctx.workspace.id, parentFolderId, folderName);
        if (existing) {
          parentFolderId = existing.id;
        } else {
          const newFolder = createFolder(ctx.workspace.id, ctx.user.id, folderName, parentFolderId);
          parentFolderId = newFolder ? newFolder.id : (findFolderByName(ctx.workspace.id, parentFolderId, folderName)?.id ?? parentFolderId);
        }
      }
      folderId = parentFolderId;
    }
  }

  const baseTitle = file.name || "Untitled";
  const force = ctx.form.get("force") === "true";

  // Check for duplicate with same title in same folder
  if (!force) {
    const folderClause = folderId
      ? "folder_id = ?"
      : "folder_id IS NULL";
    const params = folderId
      ? [ctx.workspace.id, baseTitle, folderId]
      : [ctx.workspace.id, baseTitle];
    const existing = db.prepare(
      `SELECT id FROM documents
       WHERE workspace_id = ? AND title = ? AND ${folderClause}
         AND pdf_file IS NOT NULL AND deleted_at IS NULL
       LIMIT 1`
    ).get(...params);
    if (existing) {
      return { duplicate: true, duplicateTitle: baseTitle };
    }
  }

  // Deduplicate title: "Name (2)", "Name (3)", etc.
  let title = baseTitle;
  const likePattern = `${baseTitle} (%)`;
  const folderClause2 = folderId ? "folder_id = ?" : "folder_id IS NULL";
  const params2 = folderId
    ? [ctx.workspace.id, baseTitle, likePattern, folderId]
    : [ctx.workspace.id, baseTitle, likePattern];
  const countRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM documents
     WHERE workspace_id = ? AND (title = ? OR title LIKE ?)
       AND ${folderClause2} AND pdf_file IS NOT NULL AND deleted_at IS NULL`
  ).get(...params2) as { cnt: number } | undefined;
  if (countRow && countRow.cnt > 0) {
    title = `${baseTitle} (${countRow.cnt + 1})`;
  }

  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

  const filename = `${nanoid(16)}${ext}`;
  writeFileSync(join(UPLOAD_DIR, filename), buffer);

  const doc = createPdfDocument(ctx.workspace.id, ctx.user.id, title, filename, folderId);
  return { uploadedFile: true, docId: doc.id };
}

export async function handleUploadFiles(ctx: ActionContext, folderId: string | null) {
  const files = ctx.form.getAll("files");
  const paths = ctx.form.getAll("paths");
  if (files.length === 0) throw new Response("No files provided", { status: 400 });

  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

  const results: { docId: string }[] = [];
  // Cache folder lookups/creates to avoid re-querying for same path segments
  const folderCache = new Map<string, string | null>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!(file instanceof File)) continue;
    if (file.size > UPLOAD_MAX_SIZE) continue; // skip oversized files silently in batch

    // file.name may contain path separators (e.g. from webkitRelativePath)
    const fileName = file.name.split("/").pop() || file.name;
    const ext = getAllowedExtension(fileName);
    if (!ext) continue; // skip unsupported types silently in batch

    const buffer = Buffer.from(await file.arrayBuffer());

    // Resolve folder from relative path
    let targetFolderId = folderId;
    const relativePath = typeof paths[i] === "string" ? (paths[i] as string) : fileName;
    const parts = relativePath.split("/");
    if (parts.length > 1) {
      // Build folder hierarchy from path segments (excluding filename)
      const folderPath = parts.slice(0, -1);
      let parentFolderId = folderId;
      let cacheKey = folderId || "__root__";
      for (const folderName of folderPath) {
        cacheKey += "/" + folderName;
        const cached = folderCache.get(cacheKey);
        if (cached !== undefined) {
          parentFolderId = cached;
        } else {
          const existing = findFolderByName(ctx.workspace.id, parentFolderId, folderName);
          if (existing) {
            parentFolderId = existing.id;
          } else {
            const newFolder = createFolder(ctx.workspace.id, ctx.user.id, folderName, parentFolderId);
            parentFolderId = newFolder ? newFolder.id : (findFolderByName(ctx.workspace.id, parentFolderId, folderName)?.id ?? parentFolderId);
          }
          folderCache.set(cacheKey, parentFolderId);
        }
      }
      targetFolderId = parentFolderId;
    }

    // Deduplicate title
    const baseTitle = fileName || "Untitled";
    let title = baseTitle;
    const likePattern = `${baseTitle} (%)`;
    const folderClause = targetFolderId ? "folder_id = ?" : "folder_id IS NULL";
    const params = targetFolderId
      ? [ctx.workspace.id, baseTitle, likePattern, targetFolderId]
      : [ctx.workspace.id, baseTitle, likePattern];
    const countRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM documents
       WHERE workspace_id = ? AND (title = ? OR title LIKE ?)
         AND ${folderClause} AND pdf_file IS NOT NULL AND deleted_at IS NULL`
    ).get(...params) as { cnt: number } | undefined;
    if (countRow && countRow.cnt > 0) {
      title = `${baseTitle} (${countRow.cnt + 1})`;
    }

    const filename = `${nanoid(16)}${ext}`;
    writeFileSync(join(UPLOAD_DIR, filename), buffer);
    const doc = createPdfDocument(ctx.workspace.id, ctx.user.id, title, filename, targetFolderId);
    results.push({ docId: doc.id });
  }

  return { uploadedFiles: true, count: results.length };
}

// ── Import ───────────────────────────────────────────────────

export function handleImport(ctx: ActionContext, defaultFolderId: string | null) {
  const json = ctx.form.get("files");
  if (!json || typeof json !== "string") return null;
  let files: { path: string; title: string; content: string }[];
  try {
    files = JSON.parse(json);
  } catch {
    return null;
  }
  const folderMap = new Map<string, string>();
  let imported = 0;
  for (const file of files) {
    const parts = file.path.split("/");
    let parentFolderId: string | null = defaultFolderId;
    if (parts.length > 1) {
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        const folderPath = parts.slice(0, i + 1).join("/");
        if (folderMap.has(folderPath)) {
          parentFolderId = folderMap.get(folderPath)!;
        } else {
          const existing = findFolderByName(ctx.workspace.id, parentFolderId, folderName);
          if (existing) {
            parentFolderId = existing.id;
          } else {
            const newFolder = createFolder(ctx.workspace.id, ctx.user.id, folderName, parentFolderId);
            if (newFolder) {
              parentFolderId = newFolder.id;
            }
            if (!newFolder) {
              const retry = findFolderByName(ctx.workspace.id, parentFolderId, folderName);
              if (retry) parentFolderId = retry.id;
            }
          }
          folderMap.set(folderPath, parentFolderId!);
        }
      }
    }
    createDocument(ctx.workspace.id, ctx.user.id, file.title, parentFolderId, file.content);
    imported++;
  }
  return { imported };
}

// ── Dispatch ─────────────────────────────────────────────────

export interface DispatchOptions {
  folderId?: string | null;
  docUrl: (id: string) => string;
  ownerRoles?: string[];
  folderRedirect?: {
    currentFolderId: string;
    redirectPath: string | ((target: string | null) => string);
  };
}

export function dispatchAction(
  ctx: ActionContext,
  intent: FormDataEntryValue | null,
  opts: DispatchOptions
): unknown {
  const isOwner = (opts.ownerRoles ?? ["owner"]).includes(ctx.role);
  const fid = opts.folderId ?? null;

  if (intent === "toggle-star") return handleToggleStar(ctx);
  if (intent === "create" || intent === "create-doc") return handleCreateDoc(ctx, fid, opts.docUrl);
  if (intent === "create-folder") return handleCreateFolder(ctx, fid);
  if (intent === "delete" || intent === "delete-doc") return handleTrashDoc(ctx, isOwner);
  if (intent === "delete-folder") return handleTrashFolder(ctx, opts.folderRedirect as { currentFolderId?: string; redirectPath?: string } | undefined);
  if (intent === "rename-doc") return handleRenameDoc(ctx);
  if (intent === "rename-folder") return handleRenameFolder(ctx);
  if (intent === "move-doc") return handleMoveDoc(ctx);
  if (intent === "move-folder") return handleMoveFolder(ctx, opts.folderRedirect as { currentFolderId?: string; redirectPath?: (targetId: string | null) => string } | undefined);
  if (intent === "toggle-doc-view") return handleToggleDocView(ctx);
  if (intent === "toggle-doc-edit") return handleToggleDocEdit(ctx);
  if (intent === "unshare-doc") return handleUnshareDoc(ctx);
  if (intent === "unshare-all-folder") return handleUnshareAllFolder(ctx, opts.ownerRoles ?? ["owner"]);
  if (intent === "bulk-delete") return handleBulkDelete(ctx, isOwner);
  if (intent === "bulk-unshare") return handleBulkUnshare(ctx);
  if (intent === "share-doc") return handleShareDoc(ctx);
  if (intent === "share-doc-group") return handleShareDocGroup(ctx);
  if (intent === "duplicate-doc") return handleDuplicateDoc(ctx, opts.docUrl);
  if (intent === "move-doc-to-workspace") return handleMoveDocToWorkspace(ctx);
  if (intent === "move-folder-to-workspace") return handleMoveFolderToWorkspace(ctx);
  if (intent === "import") return handleImport(ctx, fid);
  if (intent === "upload-file") return handleUploadFile(ctx, fid);
  if (intent === "upload-files") return handleUploadFiles(ctx, fid);
  if (intent === "share-folder") return handleShareFolder(ctx, opts.ownerRoles ?? ["owner"]);
  if (intent === "unshare-folder") return handleUnshareFolder(ctx, opts.ownerRoles ?? ["owner"]);
  if (intent === "leave-folder") return handleLeaveFolderShare(ctx);
  return null;
}

// ── Folder sharing ──────────────────────────────────────────

export function handleShareFolder(ctx: ActionContext, ownerRoles: string[]) {
  if (!ownerRoles.includes(ctx.role)) return { error: "You don't have permission to share folders." };
  const rl = checkRateLimit(getClientIp(ctx.request), { windowMs: 5 * 60 * 1000, max: 20, prefix: "share" });
  if (!rl.allowed) return { error: "Too many share requests. Try again later." };
  const targetFolderId = String(ctx.form.get("folderId"));
  const f = getFolder(targetFolderId);
  if (!f || f.workspace_id !== ctx.workspace.id) return null;
  const shareType = String(ctx.form.get("shareType"));
  const origin = getPublicOrigin(ctx.request);
  if (shareType === "group") {
    const groupId = String(ctx.form.get("groupId") || "").trim();
    if (!groupId) return { error: "Select a group." };
    shareFolder(targetFolderId, { groupId }, ctx.user.id, origin);
    return { success: "Folder shared with group." };
  }
  if (shareType === "user") {
    const email = String(ctx.form.get("email") || "").trim().toLowerCase();
    if (!email) return { error: "Enter an email." };
    const target = prep<{ id: string }, [string]>("SELECT id FROM users WHERE email = ?")
      .get(email);
    if (!target) return { error: "User not found." };
    shareFolder(targetFolderId, { userId: target.id }, ctx.user.id, origin);
    return { success: "Folder shared." };
  }
  return null;
}

export function handleUnshareFolder(ctx: ActionContext, ownerRoles: string[]) {
  if (!ownerRoles.includes(ctx.role)) return { error: "You don't have permission to remove shares." };
  const shareId = String(ctx.form.get("shareId"));
  unshareFolder(shareId);
  return { success: "Share removed." };
}

export function handleLeaveFolderShare(ctx: ActionContext) {
  const folderId = String(ctx.form.get("folderId"));
  leaveFolderShare(folderId, ctx.user.id);
  return null;
}
