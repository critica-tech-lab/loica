import { useState, useMemo } from "react";

export type SortCol = "name" | "created" | "modified";
export type SortDir = "asc" | "desc";

interface Folder {
  id: string;
  name: string;
  created_at: number;
}

interface Doc {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export function useSortState<F extends Folder, D extends Doc>(
  folders: F[],
  documents: D[],
  starredSet: Set<string>,
) {
  const [sortCol, setSortCol] = useState<SortCol>("modified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "name" ? "asc" : "desc");
    }
  }

  const sortedFolders = useMemo(() => {
    const sorted = [...folders];
    const dir = sortDir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      if (sortCol === "name") return dir * a.name.localeCompare(b.name);
      if (sortCol === "created") return dir * (a.created_at - b.created_at);
      if (sortCol === "modified") return dir * (a.created_at - b.created_at); // fallback to created
      return 0;
    });
    return sorted;
  }, [folders, sortCol, sortDir]);

  const sortedDocuments = useMemo(() => {
    const sorted = [...documents];
    const dir = sortDir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      // Starred docs always on top
      const aStar = starredSet.has(a.id) ? 0 : 1;
      const bStar = starredSet.has(b.id) ? 0 : 1;
      if (aStar !== bStar) return aStar - bStar;
      if (sortCol === "name") return dir * a.title.localeCompare(b.title);
      if (sortCol === "created") return dir * (a.created_at - b.created_at);
      if (sortCol === "modified") return dir * (a.updated_at - b.updated_at);
      return 0;
    });
    return sorted;
  }, [documents, sortCol, sortDir, starredSet]);

  return { sortCol, sortDir, toggleSort, sortedFolders, sortedDocuments };
}
