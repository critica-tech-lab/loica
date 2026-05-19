import JSZip from "jszip";
import type { Route } from "./+types/api.workspace-export.$id";
import { getSessionUser } from "~/lib/auth.server";
import { getWorkspace, getMembership } from "~/lib/workspace.server";
import { getWorkspaceDocuments, getDocument } from "~/lib/document.server";
import { getAllWorkspaceFolders } from "~/lib/folder.server";

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.+$/, "")
    .trim() || "untitled";
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = getSessionUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const workspaceId = params.id;
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Response("Not found", { status: 404 });

  const role = getMembership(workspaceId, user.id, user.is_admin);
  if (!role) throw new Response("Forbidden", { status: 403 });

  // Build folder ID → path map
  const folders = getAllWorkspaceFolders(workspaceId);
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

  // Get all docs in workspace
  const docSummaries = getWorkspaceDocuments(workspaceId);
  const zip = new JSZip();

  // Track used filenames per directory to handle duplicates
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
    const fullPath = dir ? `${dir}/${fileName}` : fileName;

    zip.file(fullPath, doc.content ?? "");
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const safeName = sanitizeFilename(workspace.name);

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName}.zip"`,
    },
  });
}
