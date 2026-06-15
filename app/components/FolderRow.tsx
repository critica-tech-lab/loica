import { Form, Link } from "react-router";
import { Draggable } from "~/components/dnd/Draggable";
import { Droppable } from "~/components/dnd/Droppable";
import { ActionsMenu } from "~/components/ActionsMenu";
import { FolderIcon } from "~/components/icons";
import { timeAgo, formatDate } from "~/lib/ui-utils";

interface FolderRowProps {
  folder: { id: string; name: string; parent_id: string | null; created_at: number };
  href: string;
  canEdit: boolean;
  isOwner: boolean;
  isShared: boolean;
  isSelected?: boolean;
  isRenaming: boolean;
  showBorder: boolean;
  showCheckbox?: boolean;
  showCreated?: boolean;
  onRename: () => void;
  onRenameCancel: () => void;
  onMove: () => void;
  onShare: () => void;
  onDelete: () => void;
  onUnshare: () => void;
  onCheckboxToggle?: (e: React.MouseEvent | React.ChangeEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
}

export function FolderRow({
  folder,
  href,
  canEdit,
  isOwner,
  isShared,
  isSelected = false,
  isRenaming,
  showBorder,
  showCheckbox = false,
  showCreated = true,
  onRename,
  onRenameCancel,
  onMove,
  onShare,
  onDelete,
  onUnshare,
  onCheckboxToggle,
  onClick,
}: FolderRowProps) {
  const f = folder;

  return (
    <Draggable
      item={{ type: "folder", id: f.id, title: f.name, currentFolderId: f.parent_id }}
      disabled={!canEdit}
    >
      {({ dragRef, isDragging, attributes, listeners }) => (
        <Droppable target={{ type: "folder", id: f.id }} disabled={!canEdit}>
          {({ dropRef, isOver, isInvalid }) => (
            <div
              ref={(el) => { dragRef(el); dropRef(el); }}
              {...attributes}
              {...listeners}
              onClick={onClick}
              className={`archive-row group ${onClick ? "cursor-pointer " : ""}${
                isDragging ? "opacity-30" : ""
              }${isOver && !isInvalid ? " bg-accent/5 ring-2 ring-inset ring-accent/30" : ""}${
                isInvalid ? " bg-scarlet/5 ring-2 ring-inset ring-scarlet/30" : ""
              }${isSelected && !isDragging && !isOver ? " bg-accent/[0.06]" : ""}`}
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
              <FolderIcon className="mr-1.5 h-4 w-4 shrink-0 text-tawny/80" />
              {isRenaming ? (
                <Form
                  method="post"
                  className="flex-1"
                  onSubmit={() => onRenameCancel()}
                >
                  <input type="hidden" name="intent" value="rename-folder" />
                  <input type="hidden" name="folderId" value={f.id} />
                  <input
                    name="name"
                    defaultValue={f.name}
                    autoFocus
                    className="w-full border-b border-accent/40 bg-transparent px-0 py-0.5 text-base text-fg outline-none"
                    onBlur={() => onRenameCancel()}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") onRenameCancel();
                    }}
                  />
                </Form>
              ) : onClick ? (
                <span className="min-w-0 flex-1 truncate text-base font-medium">
                  {f.name}
                  {isShared && <span className="ml-1.5 shrink-0 rounded-full bg-sage/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-sage/60">shared</span>}
                </span>
              ) : (
                <Link
                  to={href}
                  prefetch="intent"
                  draggable={false}
                  className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-base font-medium no-underline text-fg"
                >
                  {f.name}
                  {isShared && <span className="shrink-0 rounded-full bg-sage/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-sage/60">shared</span>}
                </Link>
              )}
              {showCreated && (
                <span className="archive-meta hidden w-20 sm:block" title={formatDate(f.created_at)}>
                  {timeAgo(f.created_at)}
                </span>
              )}
              <span className="archive-meta w-20">&mdash;</span>
              <div className="archive-actions">
                <ActionsMenu
                  itemType="folder"
                  itemId={f.id}
                  canEdit={canEdit}
                  isOwner={isOwner}
                  isShared={isShared}
                  onRename={onRename}
                  onMove={onMove}
                  onShare={onShare}
                  onDelete={onDelete}
                  onUnshare={onUnshare}
                />
              </div>
            </div>
          )}
        </Droppable>
      )}
    </Draggable>
  );
}
