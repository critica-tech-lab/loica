import { useState, useRef, useEffect, useCallback } from "react";
import { PlusIcon, DocAddIcon, FolderAddIcon, UploadIcon, FolderIcon, ChevronDownIcon } from "./icons";
import { processImportFiles, type ImportFile } from "./ImportDropZone";
import { TEMPLATES } from "~/lib/templates";
import { templateOwners } from "~/extensions";
import { useEnabledExtensionIds } from "~/root";

interface NewButtonProps {
  onCreateDoc: () => void;
  /** True while a create request is in flight: blocks a second click or shortcut from making a duplicate. */
  creating?: boolean;
  /** Called when a template button is clicked. `templateId` is the id of the
   *  selected entry from `TEMPLATES` (e.g. "spreadsheet", "report"). */
  onCreateFromTemplate: (templateId: string) => void;
  onCreateFolder: () => void;
  onImport: (files: ImportFile[]) => void;
  onUploadFile?: (file: File) => void;
  onUploadFiles?: (files: { file: File; path?: string }[]) => void;
}

const NEW_DOC_SHORTCUT_LABEL = "Ctrl+Alt+N";

export function NewButton({ onCreateDoc, creating = false, onCreateFromTemplate, onCreateFolder, onImport, onUploadFile, onUploadFiles }: NewButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Read through refs so the shortcut listener is attached once, not on
  // every render (callers pass a fresh onCreateDoc closure each time).
  const onCreateDocRef = useRef(onCreateDoc);
  const creatingRef = useRef(creating);
  onCreateDocRef.current = onCreateDoc;
  creatingRef.current = creating;
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const enabledExtensionIds = useEnabledExtensionIds();
  // Built-in templates always show; extension templates only when their
  // owner extension is enabled by admin (template id ≠ extension id, hence
  // the lookup).
  const visibleTemplates = TEMPLATES.filter((t) => {
    const owner = templateOwners.get(t.id);
    return !owner || enabledExtensionIds.has(owner);
  });

  // Ctrl/Cmd+Alt+N: new blank document. Cmd+N / Ctrl+N alone belong to the browser.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isShortcut = e.altKey && (e.ctrlKey || e.metaKey) && e.code === "KeyN";
      if (!isShortcut) return;
      e.preventDefault();
      if (creatingRef.current) return;
      onCreateDocRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      // .md and .zip go to import pipeline; everything else goes to file upload
      const importable: File[] = [];
      const uploadable: File[] = [];
      // macOS app packages (.pages, .key, .numbers) are directories;
      // webkitdirectory traverses into them, exposing internal files we can't use.
      const packageRe = /\.(?:pages|key|numbers)\//i;
      for (const f of files) {
        if (f.webkitRelativePath && packageRe.test(f.webkitRelativePath)) continue;
        const name = f.name.toLowerCase();
        if (name.endsWith(".md") || name.endsWith(".zip")) {
          importable.push(f);
        } else {
          uploadable.push(f);
        }
      }
      if (uploadable.length > 0 && (onUploadFiles || onUploadFile)) {
        if (onUploadFiles) {
          onUploadFiles(uploadable.map((f) => ({ file: f, path: f.webkitRelativePath || undefined })));
        } else if (onUploadFile) {
          onUploadFile(uploadable[0]);
        }
      }
      if (importable.length > 0) {
        const { imported } = await processImportFiles(importable);
        if (imported.length > 0) onImport(imported);
      }
      e.target.value = "";
      setMenuOpen(false);
    },
    [onImport, onUploadFile, onUploadFiles]
  );

  return (
    <div className="relative" ref={menuRef}>
      {/* Split button: the main part creates a blank document right away;
          the chevron opens templates, folder and upload options. */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onCreateDoc()}
          disabled={creating}
          title={`New document (${NEW_DOC_SHORTCUT_LABEL})`}
          className="flex cursor-pointer items-center gap-1.5 rounded-l-md border-none bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-60"
        >
          <PlusIcon className="h-4 w-4" />
          New
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More ways to create"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex cursor-pointer items-center rounded-r-md border-0 border-l border-solid border-accent-fg/25 bg-accent px-1.5 text-accent-fg transition-opacity hover:opacity-90"
        >
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {menuOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 min-w-[180px] rounded-lg border border-fg/[0.1] bg-bg shadow-lg">
          <button
            type="button"
            onClick={() => { onCreateDoc(); setMenuOpen(false); }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-t-lg border-none bg-transparent px-3 py-2 text-left text-sm text-fg/70 transition-colors hover:bg-fg/[0.04] hover:text-fg/90"
          >
            <DocAddIcon className="h-4 w-4 shrink-0 opacity-50" />
            New document
          </button>
          {visibleTemplates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => { onCreateFromTemplate(tpl.id); setMenuOpen(false); }}
              className="flex w-full cursor-pointer items-center gap-2.5 border-none bg-transparent px-3 py-2 text-left text-sm text-fg/70 transition-colors hover:bg-fg/[0.04] hover:text-fg/90"
            >
              {tpl.Icon
                ? <tpl.Icon className="h-4 w-4 shrink-0 opacity-50" />
                : <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-xs opacity-60">{tpl.icon}</span>}
              New {tpl.label.toLowerCase()}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { onCreateFolder(); setMenuOpen(false); }}
            className="flex w-full cursor-pointer items-center gap-2.5 border-none bg-transparent px-3 py-2 text-left text-sm text-fg/70 transition-colors hover:bg-fg/[0.04] hover:text-fg/90"
          >
            <FolderAddIcon className="h-4 w-4 shrink-0 opacity-50" />
            New folder
          </button>
          <div className="mx-2 border-t border-fg/[0.06]" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full cursor-pointer items-center gap-2.5 border-none bg-transparent px-3 py-2 text-left text-sm text-fg/70 transition-colors hover:bg-fg/[0.04] hover:text-fg/90"
          >
            <UploadIcon className="h-4 w-4 shrink-0 opacity-50" />
            Upload file
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-b-lg border-none bg-transparent px-3 py-2 text-left text-sm text-fg/70 transition-colors hover:bg-fg/[0.04] hover:text-fg/90"
          >
            <FolderIcon className="h-4 w-4 shrink-0 opacity-50" />
            Upload folder
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.zip,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pages,.png,.jpg,.jpeg,.gif,.webp,.svg,.mp3,.wav,.flac,.ogg,.mp4,.mov,.avi,.webm,.csv,.json,.txt,.rar,.gz,.tar"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        /* @ts-expect-error webkitdirectory is not in React types */
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
