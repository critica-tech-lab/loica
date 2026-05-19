import JSZip from "jszip";
import type { Route } from "./+types/api.admin-user-export.$userId";
import { requireAdmin } from "~/lib/auth.server";
import { db, prep } from "~/lib/db.server";
import { getWorkspaceDocuments, getDocument } from "~/lib/document.server";
import { getAllWorkspaceFolders } from "~/lib/folder.server";

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.+$/, "")
    .trim() || "untitled";
}

export async function loader({ params, request }: Route.LoaderArgs) {
  requireAdmin(request);

  const userId = params.userId;
  const user = prep<{ name: string }, [string]>("SELECT name FROM users WHERE id = ?")
    .get(userId);
  if (!user) throw new Response("User not found", { status: 404 });

  // Get all workspaces the user owns
  const workspaces = prep<{ id: string; name: string }, [string]>(
      `SELECT w.id, w.name FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ? AND wm.role = 'owner'`
    )
    .all(userId);

  const zip = new JSZip();
  const usedWsNames = new Set<string>();

  for (const ws of workspaces) {
    // Ensure unique workspace folder names in ZIP
    let wsDir = sanitizeFilename(ws.name);
    if (usedWsNames.has(wsDir.toLowerCase())) {
      let counter = 2;
      while (usedWsNames.has(`${wsDir} (${counter})`.toLowerCase())) counter++;
      wsDir = `${wsDir} (${counter})`;
    }
    usedWsNames.add(wsDir.toLowerCase());

    // Build folder ID → path map
    const folders = getAllWorkspaceFolders(ws.id);
    const folderMap = new Map(folders.map((f) => [f.id, f]));
    const pathCache = new Map<string, string>();

    function getFolderPath(folderId: string): string {
      if (pathCache.has(folderId)) return pathCache.get(folderId)!;
      const folder = folderMap.get(folderId);
      if (!folder) return "";
      const parentPath = folder.parent_id ? getFolderPath(folder.parent_id) : "";
      const path = parentPath
        ? `${parentPath}/${sanitizeFilename(folder.name)}`
        : sanitizeFilename(folder.name);
      pathCache.set(folderId, path);
      return path;
    }

    const docSummaries = getWorkspaceDocuments(ws.id);
    const usedNames = new Map<string, Set<string>>();

    function uniqueName(dir: string, base: string, ext: string): string {
      if (!usedNames.has(dir)) usedNames.set(dir, new Set());
      const names = usedNames.get(dir)!;
      let candidate = `${base}${ext}`;
      let counter = 1;
      while (names.has(candidate.toLowerCase())) {
        counter++;
        candidate = `${base} (${counter})${ext}`;
      }
      names.add(candidate.toLowerCase());
      return candidate;
    }

    for (const summary of docSummaries) {
      const doc = getDocument(summary.id);
      if (!doc) continue;

      const dir = doc.folder_id ? getFolderPath(doc.folder_id) : "";
      const baseName = sanitizeFilename(doc.title);
      const fileName = uniqueName(dir, baseName, ".md");
      const fullDir = dir ? `${wsDir}/${dir}` : wsDir;
      const fullPath = `${fullDir}/${fileName}`;

      zip.file(fullPath, doc.content ?? "");
    }
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const safeName = sanitizeFilename(user.name);

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName}-export.zip"`,
    },
  });
}
