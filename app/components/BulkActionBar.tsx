import { TrashIcon, UnshareIcon } from "~/components/icons";

interface BulkActionBarProps {
  selectedCount: number;
  hasPublicInSelection: boolean;
  disabled: boolean;
  onDelete: () => void;
  onUnshare: () => void;
  onClear: () => void;
}

export function BulkActionBar({
  selectedCount,
  hasPublicInSelection,
  disabled,
  onDelete,
  onUnshare,
  onClear,
}: BulkActionBarProps) {
  return (
    <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-fg/15 bg-bg px-4 py-2.5 shadow-lg">
      <span className="text-xs font-medium text-fg/60">
        {selectedCount} doc{selectedCount > 1 ? "s" : ""} selected
      </span>
      <div className="h-4 w-px bg-fg/10" />
      {hasPublicInSelection && (
        <button
          type="button"
          disabled={disabled}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-tawny/25 bg-tawny/[0.08] px-3 py-1.5 text-xs font-medium text-tawny transition-colors hover:bg-tawny/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onUnshare}
        >
          <UnshareIcon className="h-3.5 w-3.5" />
          Unshare
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-scarlet/25 bg-scarlet/[0.08] px-3 py-1.5 text-xs font-medium text-scarlet transition-colors hover:bg-scarlet/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onDelete}
      >
        <TrashIcon className="h-3.5 w-3.5" />
        Move to trash
      </button>
      <button
        type="button"
        className="ml-1 cursor-pointer border-none bg-transparent p-1 text-fg/30 transition-colors hover:text-fg/60"
        onClick={onClear}
        title="Clear selection"
      >
        &times;
      </button>
    </div>
  );
}
