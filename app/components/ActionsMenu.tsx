import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useToast } from "~/components/Toast";
import {
  MoreHorizontalIcon,
  PencilIcon,
  DownloadIcon,
  ShareIcon,
  UnshareIcon,
  MoveIcon,
  TrashIcon,
  FolderIcon,
  StarIcon,
  CopyIcon,
} from "./icons";

type ItemType = "doc" | "folder" | "shared-folder";

interface ActionsMenuProps {
  itemType: ItemType;
  itemId: string;
  canEdit: boolean;
  isOwner: boolean;
  isShared?: boolean;
  isStarred?: boolean;
  pdfFile?: string | null;
  onRename: () => void;
  onMove: () => void;
  onShare: () => void;
  onDelete?: () => void;
  onUnshare?: () => void;
  onOpen?: () => void;
  onLeave?: () => void;
  onToggleStar?: () => void;
  onDuplicate?: () => void;
}

export function ActionsMenu({
  itemType,
  itemId,
  canEdit,
  isOwner,
  isShared,
  isStarred,
  pdfFile,
  onRename,
  onMove,
  onShare,
  onDelete,
  onUnshare,
  onOpen,
  onLeave,
  onToggleStar,
  onDuplicate,
}: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const { toast } = useToast();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const menuHeight = 280; // estimated max height (~9 items × 28px + padding)
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight && rect.top > menuHeight;
    setPos({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.right,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", updatePos);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  const isDoc = itemType === "doc";
  const isOwnFolder = itemType === "folder";
  const isSharedFolder = itemType === "shared-folder";

  const openUp = pos ? pos.top < (btnRef.current?.getBoundingClientRect().top ?? 0) : false;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="cursor-pointer rounded border-none bg-transparent p-1.5 text-fg/30 transition-colors hover:text-fg/70"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Actions"
        aria-label="Actions"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreHorizontalIcon className="h-3.5 w-3.5" />
      </button>

      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-50 min-w-[160px] rounded-lg border border-fg/15 bg-bg py-1 shadow-lg"
            style={{
              top: openUp ? undefined : pos.top,
              bottom: openUp ? window.innerHeight - pos.top : undefined,
              left: pos.left,
              transform: "translateX(-100%)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Open (shared folders) */}
            {isSharedFolder && onOpen && (
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-fg/5"
                onClick={() => {
                  setOpen(false);
                  onOpen();
                }}
              >
                <FolderIcon className="h-3.5 w-3.5 opacity-50" />
                Open
              </button>
            )}

            {/* Leave (shared folders) */}
            {isSharedFolder && onLeave && (
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-xs text-scarlet transition-colors hover:bg-scarlet/5"
                onClick={() => {
                  setOpen(false);
                  onLeave();
                }}
              >
                <UnshareIcon className="h-3.5 w-3.5 opacity-70" />
                Leave
              </button>
            )}

            {/* Star / Unstar (docs only) */}
            {isDoc && onToggleStar && (
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-fg/5"
                onClick={() => {
                  setOpen(false);
                  onToggleStar();
                }}
              >
                <StarIcon filled={isStarred} className="h-3.5 w-3.5 opacity-50" />
                {isStarred ? "Unstar" : "Star"}
              </button>
            )}

            {/* Duplicate */}
            {isDoc && canEdit && onDuplicate && (
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-fg/5"
                onClick={() => {
                  setOpen(false);
                  onDuplicate();
                }}
              >
                <CopyIcon className="h-3.5 w-3.5 opacity-50" />
                Duplicate
              </button>
            )}

            {/* Rename */}
            {canEdit && (
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-fg/5"
                onClick={() => {
                  setOpen(false);
                  onRename();
                }}
              >
                <PencilIcon className="h-3.5 w-3.5 opacity-50" />
                Rename
              </button>
            )}

            {/* Download options (docs only) */}
            {isDoc && pdfFile ? (
              <a
                href={`/api/uploads/${pdfFile}`}
                download
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg no-underline transition-colors hover:bg-fg/5"
                onClick={() => setOpen(false)}
              >
                <DownloadIcon className="h-3.5 w-3.5 opacity-50" />
                Download PDF
              </a>
            ) : isDoc ? (
              <>
                <a
                  href={`/api/doc-download/${itemId}`}
                  download
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg no-underline transition-colors hover:bg-fg/5"
                  onClick={() => setOpen(false)}
                >
                  <DownloadIcon className="h-3.5 w-3.5 opacity-50" />
                  Download as Markdown
                </a>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-fg/5 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={pdfBusy}
                  onClick={async () => {
                    setOpen(false);
                    setPdfBusy(true);
                    try {
                      const res = await fetch(`/api/doc-pdf/${itemId}`);
                      if (!res.ok) throw new Error("PDF generation failed");
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      const cd = res.headers.get("Content-Disposition");
                      a.download = cd?.match(/filename="?([^"]+)"?/)?.[1] ?? "document.pdf";
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch {
                      toast("PDF generation failed", "error");
                    } finally {
                      setPdfBusy(false);
                    }
                  }}
                >
                  <DownloadIcon className="h-3.5 w-3.5 opacity-50" />
                  {pdfBusy ? "Generating PDF…" : "Download as PDF"}
                </button>
              </>
            ) : null}

            {/* Share */}
            {((isDoc && canEdit) || (isOwnFolder && isOwner)) && (
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-fg/5"
                onClick={() => {
                  setOpen(false);
                  onShare();
                }}
              >
                <ShareIcon className="h-3.5 w-3.5 opacity-50" />
                Share
              </button>
            )}

            {/* Unshare */}
            {isShared && onUnshare && ((isDoc && canEdit) || (isOwnFolder && isOwner)) && (
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-xs text-scarlet transition-colors hover:bg-scarlet/5"
                onClick={() => {
                  setOpen(false);
                  onUnshare();
                }}
              >
                <UnshareIcon className="h-3.5 w-3.5 opacity-70" />
                Unshare
              </button>
            )}

            {/* Move */}
            {canEdit && (
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-fg/5"
                onClick={() => {
                  setOpen(false);
                  onMove();
                }}
              >
                <MoveIcon className="h-3.5 w-3.5 opacity-50" />
                Move
              </button>
            )}

            {/* Delete */}
            {canEdit && onDelete && (
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left text-xs text-scarlet transition-colors hover:bg-scarlet/5"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <TrashIcon className="h-3.5 w-3.5 opacity-70" />
                Move to trash
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
