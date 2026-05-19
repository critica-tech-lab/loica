import { useFocusTrap } from "~/components/hooks/useFocusTrap";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-plumage/40" onClick={onCancel}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-[min(24rem,90vw)] flex-col gap-4 rounded-lg border border-fg/15 bg-bg p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 text-sm font-bold">{title}</h3>
        <p className="m-0 text-xs text-fg/60 leading-relaxed">{message}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg border border-fg/15 bg-fg/5 px-4 py-1.5 text-xs font-medium text-fg/60 transition-colors hover:bg-fg/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`cursor-pointer rounded-lg border px-4 py-1.5 text-xs font-medium transition-colors ${
              danger
                ? "border-scarlet/25 bg-scarlet/10 text-scarlet hover:bg-scarlet/20"
                : "border-accent/25 bg-accent/10 text-accent hover:bg-accent/20"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
