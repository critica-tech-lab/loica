import type { FolderSummary } from "~/lib/folder.server";

export function getDescendantIds(
  folders: FolderSummary[],
  folderId: string
): Set<string> {
  const ids = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const f of folders) {
      if (f.parent_id === pid && !ids.has(f.id)) {
        ids.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return ids;
}
