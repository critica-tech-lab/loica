import { createContext, useCallback, useContext, useState } from "react";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
  action?: ToastAction;
  duration: number;
}

export interface ToastOptions {
  type?: Toast["type"];
  /** Optional action button (e.g. Undo). Clicking runs `onClick` then dismisses the toast. */
  action?: ToastAction;
  /** How long the toast stays on screen, in ms. Default 3500ms; undo toasts typically want longer (~8000ms). */
  duration?: number;
}

interface ToastContextValue {
  toast: (message: string, opts?: ToastOptions | Toast["type"]) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>((message, opts) => {
    const id = nextId++;
    const normalized: ToastOptions = typeof opts === "string"
      ? { type: opts }
      : (opts ?? {});
    const duration = normalized.duration ?? 3500;
    setToasts((prev) => [
      ...prev,
      {
        id,
        message,
        type: normalized.type ?? "info",
        action: normalized.action,
        duration,
      },
    ]);
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          style={{
            position: "fixed",
            top: "1rem",
            right: "1rem",
            zIndex: 200,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            alignItems: "flex-end",
            pointerEvents: "none",
          }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.6rem",
                fontSize: "0.8rem",
                padding: t.action ? "0.35rem 0.35rem 0.35rem 0.85rem" : "0.5rem 1rem",
                borderRadius: "var(--radius-lg)",
                border: "1px solid",
                borderColor:
                  t.type === "error"
                    ? "var(--color-scarlet, #AF3029)"
                    : t.type === "success"
                      ? "var(--color-sage, #66800B)"
                      : "color-mix(in srgb, var(--fg) 15%, transparent)",
                background: "var(--bg)",
                color: "var(--fg)",
                boxShadow: "var(--shadow-md)",
                animation: "toast-in 0.2s ease-out",
                pointerEvents: "auto",
              }}
            >
              <span>{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    letterSpacing: "-0.005em",
                    padding: "0.3rem 0.75rem",
                    background: "color-mix(in srgb, var(--fg) 8%, transparent)",
                    color: "var(--fg)",
                    border: "none",
                    borderRadius: "calc(var(--radius-lg) - 4px)",
                    cursor: "pointer",
                    transition: "background 120ms ease-out, color 120ms ease-out",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--fg)"; e.currentTarget.style.color = "var(--bg)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--fg) 8%, transparent)"; e.currentTarget.style.color = "var(--fg)"; }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
