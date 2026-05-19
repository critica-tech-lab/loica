import { useEffect, useRef } from "react";

/**
 * Traps keyboard focus inside a modal/dialog.
 * Returns a ref to attach to the container element.
 * Handles Tab/Shift+Tab cycling and Esc to close.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(onClose?: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first focusable element
    const focusable = getFocusableElements(el);
    if (focusable.length > 0) {
      (focusable[0] as HTMLElement).focus();
    } else {
      el.focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && onClose) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== "Tab" || !el) return;

      const focusableEls = getFocusableElements(el);
      if (focusableEls.length === 0) return;

      const first = focusableEls[0] as HTMLElement;
      const last = focusableEls[focusableEls.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    el.addEventListener("keydown", handleKeyDown);

    return () => {
      el.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return ref;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}
