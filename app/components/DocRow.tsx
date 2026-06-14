import { Form, Link } from "react-router";
import { Draggable } from "~/components/dnd/Draggable";
import { StarIcon, DocIcon, PdfIcon, AttachmentIcon } from "~/components/icons";
import { ActionsMenu } from "~/components/ActionsMenu";
import { timeAgo, formatDate } from "~/lib/ui-utils";
import { useDocTypeExtension } from "~/extensions/hooks";

interface DocRowProps {
  doc: {
    id: string;
    title: string;
    folder_id: string | null;
    public_token: string | null;
    edit_token: string | null;
    created_at: number;
    updated_at: number;
    doc_type?: string | null;
  };
  href: string;
  canEdit: boolean;
  isOwner: boolean;
  isStarred: boolean;
  pdfFile?: string | null;
  isDirectlyShared?: boolean;
  isSelected?: boolean;
  isRenaming?: boolean;
  showCheckbox?: boolean;
  showCreated?: boolean;
  onRename?: () => void;
  onRenameCancel?: () => void;
  onMove: () => void;
  onShare?: () => void;
  onDelete: () => void;
  onUnshare: () => void;
  onToggleStar: () => void;
  onDuplicate?: () => void;
  onCheckboxToggle?: (e: React.MouseEvent | React.ChangeEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
}

export function DocRow({
  doc,
  href,
  canEdit,
  isOwner,
  isStarred,
  pdfFile,
  isDirectlyShared = false,
  isSelected = false,
  isRenaming = false,
  showCheckbox = false,
  showCreated = true,
  onRename,
  onRenameCancel,
  onMove,
  onShare,
  onDelete,
  onUnshare,
  onToggleStar,
  onDuplicate,
  onCheckboxToggle,
  onClick,
}: DocRowProps) {
  const isPublic = !!(doc.public_token || doc.edit_token);
  const ExtRowIcon = useDocTypeExtension(doc.doc_type ?? null)?.rowIcon ?? null;

  return (
    <Draggable
      item={{ type: "doc", id: doc.id, title: doc.title, currentFolderId: doc.folder_id }}
      disabled={!canEdit}
    >
      {({ dragRef, isDragging, attributes, listeners }) => (
        <div
          ref={dragRef}
          {...attributes}
          {...listeners}
          onClick={onClick}
          className={`archive-row group ${onClick ? "cursor-pointer " : ""}${
            isDragging ? "opacity-30" : ""
          }${isSelected && !isDragging ? " bg-accent/[0.06]" : ""}`}
        >
          {showCheckbox && (
            <input
              type="checkbox"
              data-checkbox
              checked={isSelected}
              onChange={onCheckboxToggle as React.ChangeEventHandler<HTMLInputElement>}
              className={`archive-checkbox ${isSelected ? "archive-checkbox-selected" : ""}`}
            />
          )}
          {isStarred && (
            <StarIcon filled className="mr-1 h-3 w-3 shrink-0 text-star" />
          )}
          {pdfFile?.toLowerCase().endsWith(".pdf") ? (
            <PdfIcon className="mr-1.5 h-4 w-4 shrink-0 text-scarlet/70" />
          ) : pdfFile ? (
            <AttachmentIcon className="mr-1.5 h-4 w-4 shrink-0 text-purple/60" />
          ) : ExtRowIcon ? (
            <ExtRowIcon className="mr-1.5 h-4 w-4 shrink-0 text-fg/60" />
          ) : (
            <DocIcon className="mr-1.5 h-4 w-4 shrink-0 text-cyan/60" />
          )}
          {isRenaming && onRenameCancel ? (
            <Form
              method="post"
              className="flex-1"
              onSubmit={() => onRenameCancel()}
            >
              <input type="hidden" name="intent" value="rename-doc" />
              <input type="hidden" name="docId" value={doc.id} />
              <input
                name="title"
                defaultValue={doc.title}
                autoFocus
                className="w-full border-b border-accent/40 bg-transparent px-0 py-0.5 text-base text-fg outline-none"
                onBlur={() => onRenameCancel()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onRenameCancel();
                }}
              />
            </Form>
          ) : onClick ? (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-base font-medium">
              {doc.title}
              {isPublic && <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent/60">public</span>}
              {isDirectlyShared && <span className="shrink-0 rounded-full bg-sage/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-sage/60">shared</span>}
            </span>
          ) : (
            <Link
              to={href}
              target="_blank"
              rel="noopener"
              draggable={false}
              className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-base font-medium no-underline text-fg"
            >
              {doc.title}
              {isPublic && <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent/60">public</span>}
              {isDirectlyShared && <span className="shrink-0 rounded-full bg-sage/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-sage/60">shared</span>}
            </Link>
          )}
          {showCreated && (
            <span className="archive-meta hidden w-20 sm:block" title={formatDate(doc.created_at)}>
              {timeAgo(doc.created_at)}
            </span>
          )}
          <span className="archive-meta w-20" title={formatDate(doc.updated_at)}>
            {timeAgo(doc.updated_at)}
          </span>
          <div className="archive-actions">
            <ActionsMenu
              itemType="doc"
              itemId={doc.id}
              canEdit={canEdit}
              isOwner={isOwner}
              isShared={isPublic}
              isStarred={isStarred}
              onRename={onRename ?? (() => {})}
              onMove={onMove}
              onShare={onShare ?? (() => {})}
              onDelete={onDelete}
              onUnshare={onUnshare}
              onToggleStar={onToggleStar}
              onDuplicate={onDuplicate}
            />
          </div>
        </div>
      )}
    </Draggable>
  );
}
