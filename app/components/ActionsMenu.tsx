import { useState } from "react";
import { useToast } from "~/components/Toast";
import { Menu, MenuAlign, MenuDensity, MenuPlacement } from "~/components/Menu";
import type { MenuEntry } from "~/components/Menu";
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

const ICON = "h-3.5 w-3.5";

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
  const [pdfBusy, setPdfBusy] = useState(false);
  const { toast } = useToast();

  const isDoc = itemType === "doc";
  const isOwnFolder = itemType === "folder";
  const isSharedFolder = itemType === "shared-folder";
  const canShare = (isDoc && canEdit) || (isOwnFolder && isOwner);

  async function downloadPdf() {
    setPdfBusy(true);
    try {
      const res = await fetch(`/api/doc-pdf/${itemId}`);
      if (!res.ok) {
        throw new Error("PDF generation failed");
      }
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
  }

  const entries: MenuEntry[] = [];

  if (isSharedFolder && onOpen) {
    entries.push({ kind: "item", label: "Open", icon: <FolderIcon className={ICON} />, onSelect: onOpen });
  }
  if (isSharedFolder && onLeave) {
    entries.push({ kind: "item", label: "Leave", icon: <UnshareIcon className={ICON} />, tone: "danger", onSelect: onLeave });
  }
  if (isDoc && onToggleStar) {
    entries.push({
      kind: "item",
      label: isStarred ? "Unstar" : "Star",
      icon: <StarIcon filled={isStarred} className={ICON} />,
      onSelect: onToggleStar,
    });
  }
  if (isDoc && canEdit && onDuplicate) {
    entries.push({ kind: "item", label: "Duplicate", icon: <CopyIcon className={ICON} />, onSelect: onDuplicate });
  }
  if (canEdit) {
    entries.push({ kind: "item", label: "Rename", icon: <PencilIcon className={ICON} />, onSelect: onRename });
  }

  if (isDoc && pdfFile) {
    entries.push({
      kind: "item",
      label: "Download PDF",
      icon: <DownloadIcon className={ICON} />,
      href: `/api/uploads/${pdfFile}`,
      download: true,
    });
  } else if (isDoc) {
    entries.push({
      kind: "item",
      label: "Download as Markdown",
      icon: <DownloadIcon className={ICON} />,
      href: `/api/doc-download/${itemId}`,
      download: true,
    });
    entries.push({
      kind: "item",
      label: pdfBusy ? "Generating PDF…" : "Download as PDF",
      icon: <DownloadIcon className={ICON} />,
      disabled: pdfBusy,
      onSelect: downloadPdf,
    });
  }

  if (canShare) {
    entries.push({ kind: "item", label: "Share", icon: <ShareIcon className={ICON} />, onSelect: onShare });
  }
  if (isShared && onUnshare && canShare) {
    entries.push({ kind: "item", label: "Unshare", icon: <UnshareIcon className={ICON} />, tone: "danger", onSelect: onUnshare });
  }
  if (canEdit) {
    entries.push({ kind: "item", label: "Move", icon: <MoveIcon className={ICON} />, onSelect: onMove });
  }
  if (canEdit && onDelete) {
    entries.push({ kind: "item", label: "Move to trash", icon: <TrashIcon className={ICON} />, tone: "danger", onSelect: onDelete });
  }

  return (
    <Menu
      placement={MenuPlacement.Floating}
      align={MenuAlign.End}
      density={MenuDensity.Compact}
      entries={entries}
      renderTrigger={({ onClick, ...props }) => (
        <button
          {...props}
          type="button"
          // The trigger sits inside a clickable row.
          onClick={(e) => {
            e.stopPropagation();
            onClick?.(e);
          }}
          className="cursor-pointer rounded border-none bg-transparent p-1.5 text-fg/30 transition-colors hover:text-fg/70"
          title="Actions"
          aria-label="Actions"
        >
          <MoreHorizontalIcon className="h-3.5 w-3.5" />
        </button>
      )}
    />
  );
}
