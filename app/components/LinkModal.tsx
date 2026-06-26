import { useState, useEffect } from "react";
import { useFocusTrap } from "~/components/hooks/useFocusTrap";
import { popoverSurface, lisaButton } from "~/lib/popover-styles";

interface LinkModalProps {
  open: boolean;
  initialUrl?: string;
  /** Label shown in the modal heading and submit button. Defaults to "Add link". */
  mode?: "add" | "edit";
  onCancel: () => void;
  onSubmit: (url: string) => void;
}

export function LinkModal({ open, initialUrl = "", mode = "add", onCancel, onSubmit }: LinkModalProps) {
  const [value, setValue] = useState(initialUrl);
  const trapRef = useFocusTrap<HTMLDivElement>(onCancel);

  // Reset the input whenever the modal opens, so stale values don't leak between invocations.
  useEffect(() => {
    if (open) setValue(initialUrl);
  }, [open, initialUrl]);

  if (!open) return null;

  function submit() {
    const raw = value.trim();
    if (!raw) { onCancel(); return; }
    const safe = /^(https?:|mailto:|\/|#)/i.test(raw) ? raw : `https://${raw}`;
    onSubmit(safe);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-plumage/40"
      onClick={onCancel}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add link"
        style={popoverSurface}
        className="flex w-[min(26rem,90vw)] flex-col gap-3 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 text-sm font-semibold">{mode === "edit" ? "Edit link" : "Add link"}</h3>
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="flex flex-col gap-3"
        >
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="example.com or https://…"
            autoFocus
            className="border-[1.5px] border-fg/25 bg-bg px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-fg"
          />
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onCancel} style={lisaButton(false)}>
              Cancel
            </button>
            <button type="submit" style={lisaButton(true)}>
              {mode === "edit" ? "Update link" : "Add link"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
