import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { HTMLAttributes, KeyboardEvent, ReactNode, Ref } from "react";

export type MenuEntry =
  | {
      kind: "item";
      label: string;
      icon?: ReactNode;
      /** Smaller second line under the label. */
      hint?: string;
      href?: string;
      onSelect?: () => void;
      /** Shortcut hint shown at the end of the row, e.g. "Mod+K". */
      keys?: string;
      disabled?: boolean;
      tone?: "normal" | "quiet";
    }
  | { kind: "header"; label: string; leading?: ReactNode }
  | { kind: "separator" };

export enum MenuAlign {
  Start = "start",
  End = "end",
}

export type MenuTriggerProps = HTMLAttributes<HTMLElement> & {
  ref: Ref<HTMLButtonElement>;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
};

interface MenuProps {
  entries: MenuEntry[];
  renderTrigger: (props: MenuTriggerProps, open: boolean) => ReactNode;
  align?: MenuAlign;
}

const TYPEAHEAD_RESET_MS = 500;
const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';

const containerStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  minWidth: "220px",
  background: "var(--bg)",
  border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
  borderRadius: "var(--radius-lg)",
  padding: "4px",
  boxShadow: "var(--shadow-md)",
  zIndex: "var(--z-panel)",
};

const ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-[length:var(--fs-sm)] " +
  "text-fg no-underline cursor-pointer outline-none transition-[opacity,background] " +
  "hover:bg-fg/5 focus-visible:bg-fg/5 aria-disabled:cursor-default aria-disabled:opacity-30";

const TONE_CLASS = {
  normal: "opacity-80 hover:opacity-100 focus-visible:opacity-100",
  quiet: "opacity-55 hover:opacity-90 focus-visible:opacity-90",
};

/**
 * Dropdown menu: click-outside, Escape, arrow/Home/End/type-ahead
 * navigation, and focus return to the trigger on close.
 *
 *   [trigger] --click/ArrowDown--> opens, focuses first item (keyboard)
 *   item focus moves with arrows (wraps); Escape -> close + focus trigger
 */
export function Menu({ entries, renderTrigger, align = MenuAlign.Start }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusFirstRef = useRef(false);
  const typeahead = useRef({ text: "", timer: 0 });
  const listId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const items = useCallback(
    () => Array.from(listRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []),
    [],
  );

  // Close on outside press. Focus is left where the user clicked.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPress(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close(false);
      }
    }
    document.addEventListener("mousedown", onPress);
    return () => document.removeEventListener("mousedown", onPress);
  }, [open, close]);

  // Opened by keyboard: move focus into the list. Pointer opens keep focus on the trigger.
  useEffect(() => {
    if (!open || !focusFirstRef.current) {
      return;
    }
    focusFirstRef.current = false;
    items()[0]?.focus();
  }, [open, items]);

  function openWithKeyboard() {
    focusFirstRef.current = true;
    setOpen(true);
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
      return;
    }
    e.preventDefault();
    if (open) {
      items()[e.key === "ArrowDown" ? 0 : items().length - 1]?.focus();
      return;
    }
    openWithKeyboard();
  }

  function onTriggerClick(e: React.MouseEvent<HTMLElement>) {
    // detail === 0: activated with Enter/Space, so treat as keyboard.
    if (!open && e.detail === 0) {
      openWithKeyboard();
      return;
    }
    setOpen((v) => !v);
  }

  function moveFocus(delta: number) {
    const list = items();
    if (list.length === 0) {
      return;
    }
    const current = list.indexOf(document.activeElement as HTMLElement);
    const next = (current + delta + list.length) % list.length;
    list[next].focus();
  }

  function onTypeahead(key: string) {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.text += key.toLowerCase();
    state.timer = window.setTimeout(() => { state.text = ""; }, TYPEAHEAD_RESET_MS);

    const list = items();
    const match = list.find((el) => el.textContent?.trim().toLowerCase().startsWith(state.text));
    match?.focus();
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveFocus(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-1);
        return;
      case "Home":
        e.preventDefault();
        items()[0]?.focus();
        return;
      case "End":
        e.preventDefault();
        items().at(-1)?.focus();
        return;
      case "Escape":
        e.preventDefault();
        close(true);
        return;
      case "Tab":
        close(false);
        return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
      onTypeahead(e.key);
    }
  }

  const triggerProps: MenuTriggerProps = {
    ref: triggerRef,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? listId : undefined,
    onClick: onTriggerClick,
    onKeyDown: onTriggerKeyDown,
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      {renderTrigger(triggerProps, open)}
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="menu"
          onKeyDown={onListKeyDown}
          style={{ ...containerStyle, [align === MenuAlign.End ? "right" : "left"]: 0 }}
        >
          {entries.map((entry, i) => renderEntry(entry, i, () => close(false)))}
        </div>
      )}
    </div>
  );
}

function renderEntry(entry: MenuEntry, index: number, closeMenu: () => void) {
  if (entry.kind === "separator") {
    return (
      <div
        key={index}
        role="separator"
        style={{ height: "1px", margin: "4px -4px", background: "color-mix(in srgb, var(--fg) 8%, transparent)" }}
      />
    );
  }

  if (entry.kind === "header") {
    return (
      <div
        key={index}
        role="presentation"
        className="flex items-center gap-2.5 px-2.5 pb-2 pt-1.5"
      >
        {entry.leading}
        <span className="min-w-0 truncate text-[length:var(--fs-sm)] font-semibold text-fg">{entry.label}</span>
      </div>
    );
  }

  const className = `${ITEM_CLASS} ${TONE_CLASS[entry.tone ?? "normal"]}`;
  const content = (
    <>
      {entry.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{entry.icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block">{entry.label}</span>
        {entry.hint && <span className="block text-[length:var(--fs-2xs)] opacity-50">{entry.hint}</span>}
      </span>
      {entry.keys && <kbd className="font-mono text-[length:var(--fs-2xs)] opacity-50">{entry.keys}</kbd>}
    </>
  );

  if (entry.href && !entry.disabled) {
    return (
      <a key={index} role="menuitem" tabIndex={-1} href={entry.href} className={className} onClick={closeMenu}>
        {content}
      </a>
    );
  }

  return (
    <button
      key={index}
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={entry.disabled || undefined}
      aria-keyshortcuts={entry.keys}
      className={className}
      onClick={() => {
        if (entry.disabled) {
          return;
        }
        closeMenu();
        entry.onSelect?.();
      }}
    >
      {content}
    </button>
  );
}
