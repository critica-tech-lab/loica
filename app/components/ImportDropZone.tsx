import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import JSZip from "jszip";

export type ImportFile = {
  path: string;
  title: string;
  content: string;
};

type Props = {
  onImport: (files: ImportFile[]) => void;
  onUploadFile?: (file: File) => void;
  onUploadFiles?: (files: { file: File; path?: string }[]) => void;
  children: ReactNode;
};

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function processZip(file: File): Promise<ImportFile[]> {
  const data = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(data);
  const results: ImportFile[] = [];

  for (const [relativePath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (!relativePath.toLowerCase().endsWith(".md")) continue;
    // Skip macOS resource fork files
    if (relativePath.startsWith("__MACOSX/")) continue;

    const content = await entry.async("text");
    const name = relativePath.replace(/\.md$/i, "");
    // Use the path from the zip as-is (includes folder structure)
    results.push({ path: relativePath, title: name.split("/").pop() || name, content });
  }
  return results;
}

/** Process a list of Files (.md and .zip) into ImportFile[]. Reusable outside of drag-and-drop. */
export async function processImportFiles(files: File[]): Promise<{ imported: ImportFile[]; rejected: number }> {
  const imported: ImportFile[] = [];
  let rejected = 0;

  for (const file of files) {
    const name = file.name.toLowerCase();
    // webkitRelativePath preserves folder structure from <input webkitdirectory>
    const path = file.webkitRelativePath || file.name;
    if (name.endsWith(".md")) {
      const content = await readFileAsText(file);
      const title = file.name.replace(/\.md$/i, "");
      imported.push({ path, title, content });
    } else if (name.endsWith(".zip")) {
      const zipFiles = await processZip(file);
      imported.push(...zipFiles);
    } else {
      rejected++;
    }
  }
  return { imported, rejected };
}

/** Read a FileSystemEntry recursively, returning files with their full paths. */
function readEntry(entry: FileSystemEntry, path: string): Promise<{ file: File; path: string }[]> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([{ file, path: path + file.name }]),
        () => resolve([]),
      );
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const allEntries: FileSystemEntry[] = [];
      // readEntries may return results in batches
      const readBatch = () => {
        reader.readEntries((entries) => {
          if (entries.length === 0) {
            Promise.all(allEntries.map((e) => readEntry(e, path + entry.name + "/")))
              .then((results) => resolve(results.flat()));
          } else {
            allEntries.push(...entries);
            readBatch();
          }
        }, () => resolve([]));
      };
      readBatch();
    } else {
      resolve([]);
    }
  });
}

/** Use DataTransferItemList to get files with directory structure preserved. */
async function readDataTransferItems(items: DataTransferItemList): Promise<{ file: File; path: string }[]> {
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  const results = await Promise.all(entries.map((e) => readEntry(e, "")));
  return results.flat();
}

export function ImportDropZone({ onImport, onUploadFile, onUploadFiles, children }: Props) {
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const onImportRef = useRef(onImport);
  const onUploadFileRef = useRef(onUploadFile);
  const onUploadFilesRef = useRef(onUploadFiles);
  onImportRef.current = onImport;
  onUploadFileRef.current = onUploadFile;
  onUploadFilesRef.current = onUploadFiles;

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }, []);

  const showNoticeRef = useRef(showNotice);
  showNoticeRef.current = showNotice;

  useEffect(() => {
    function handleDragEnter(e: DragEvent) {
      e.preventDefault();
      dragCounter.current++;
      if (dragCounter.current === 1) setDragging(true);
    }

    function handleDragLeave(e: DragEvent) {
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current === 0) setDragging(false);
    }

    function handleDragOver(e: DragEvent) {
      e.preventDefault();
    }

    async function handleDrop(e: DragEvent) {
      e.preventDefault();
      dragCounter.current = 0;
      setDragging(false);

      // Use webkitGetAsEntry to recursively read directories
      let allFiles: { file: File; path: string }[] = [];
      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        allFiles = await readDataTransferItems(e.dataTransfer.items);
      } else {
        // Fallback for browsers without DataTransferItem support
        allFiles = Array.from(e.dataTransfer?.files ?? []).map((f) => ({ file: f, path: f.name }));
      }
      if (allFiles.length === 0) return;

      // Skip macOS package internals (.pages, .key, .numbers directories)
      const packageRe = /\.(?:pages|key|numbers)\//i;
      allFiles = allFiles.filter((f) => !packageRe.test(f.path));

      // .md and .zip go to import pipeline; everything else goes to file upload
      const importFiles: { file: File; path: string }[] = [];
      const uploadFiles: { file: File; path: string }[] = [];
      for (const f of allFiles) {
        const name = f.file.name.toLowerCase();
        if (name.endsWith(".md") || name.endsWith(".zip")) {
          importFiles.push(f);
        } else {
          uploadFiles.push(f);
        }
      }

      // Upload non-markdown files (batch)
      let uploadCount = 0;
      if (uploadFiles.length > 0) {
        if (onUploadFilesRef.current) {
          onUploadFilesRef.current(uploadFiles.map((f) => ({ file: f.file, path: f.path })));
          uploadCount = uploadFiles.length;
        } else if (onUploadFileRef.current) {
          onUploadFileRef.current(uploadFiles[0].file);
          uploadCount = 1;
        }
      }

      // For import, set webkitRelativePath-like path on files
      const importRawFiles = importFiles.map((f) => {
        // processImportFiles uses file.webkitRelativePath || file.name for path
        // We can't set webkitRelativePath, so we create ImportFile entries directly
        return f;
      });
      const importEntries: ImportFile[] = [];
      let rejected = 0;
      for (const { file, path } of importRawFiles) {
        const name = file.name.toLowerCase();
        if (name.endsWith(".md")) {
          const content = await readFileAsText(file);
          const title = file.name.replace(/\.md$/i, "");
          importEntries.push({ path, title, content });
        } else if (name.endsWith(".zip")) {
          const zipFiles = await processZip(file);
          importEntries.push(...zipFiles);
        } else {
          rejected++;
        }
      }
      const skipped = (onUploadFilesRef.current || onUploadFileRef.current) ? rejected : rejected + uploadFiles.length;

      const totalImported = importEntries.length + uploadCount;
      if (importEntries.length > 0) {
        onImportRef.current(importEntries);
      }
      if (totalImported > 0) {
        const msg = `Imported ${totalImported} file${totalImported !== 1 ? "s" : ""}`;
        showNoticeRef.current(skipped > 0 ? `${msg} (${skipped} file${skipped !== 1 ? "s" : ""} skipped)` : msg);
      } else if (skipped > 0) {
        showNoticeRef.current(`Unsupported file type (${skipped} file${skipped !== 1 ? "s" : ""} rejected)`);
      }
    }

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, []);

  return (
    <>
      {children}

      {/* Full-screen drop overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent/40 px-12 py-10">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent/60">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="text-sm text-fg/60">Drop files to import or upload</span>
          </div>
        </div>
      )}

      {/* Toast notice */}
      {notice && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-fg px-4 py-2 text-xs text-bg shadow-lg">
          {notice}
        </div>
      )}
    </>
  );
}
