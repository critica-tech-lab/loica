import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { HTMLAttributes, KeyboardEvent, ReactNode, Ref } from "react";
import { createPortal } from "react-dom";

export type MenuEntry =
  | {
      kind: "item";
      label: string;
      icon?: ReactNode;
      /** Smaller second line under the label. */
      hint?: string;
      href?: string;
      /** With `href`: save the target instead of navigating to it. */
      download?: boolean;
      onSelect?: () => void;
      /** Shortcut hint shown at the end of the row, e.g. "Mod+K". */
      keys?: string;
      disabled?: boolean;
      tone?: "normal" | "quiet" | "danger";
      /** Native tooltip. Defaults to the label. */
      title?: string;
    }
  | { kind: "header"; label: string; leading?: ReactNode }
  | {
      /** A row of compact buttons for same-kind choices, e.g. download formats. */
      kind: "pills";
      heading?: string;
      items: { label: string; onSelect: () => void; title?: string }[];
    }
  | { kind: "separator" };

export enum MenuAlign {
  Start = "start",
  End = "end",
}

/**
 * Anchored: absolutely positioned under the trigger. Floating: rendered in
 * a portal with fixed coordinates, so it is not clipped by a scrolling or
 * overflow-hidden ancestor (list rows), flips above when there is no room
 * below, and closes when the page scrolls.
 */
export enum MenuPlacement {
  Anchored = "anchored",
  Floating = "floating",
}

export enum MenuDensity {
  Regular = "regular",
  Compact = "compact",
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
  placement?: MenuPlacement;
  density?: MenuDensity;
}

const TYPEAHEAD_RESET_MS = 500;
const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';
const ANCHOR_GAP_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

const MIN_WIDTH = {
  [MenuDensity.Regular]: "220px",
  [MenuDensity.Compact]: "170px",
};

const containerStyle: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
  borderRadius: "var(--radius-lg)",
  padding: "4px",
  boxShadow: "var(--shadow-md)",
  zIndex: "var(--z-panel)",
};

const ITEM_BASE =
  "flex w-full items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 text-left " +
  "no-underline cursor-pointer outline-none transition-[opacity,background] " +
  "aria-disabled:cursor-default aria-disabled:opacity-30";

const DENSITY_CLASS = {
  [MenuDensity.Regular]: "py-2 text-[length:var(--fs-sm)]",
  [MenuDensity.Compact]: "py-1.5 text-[length:var(--fs-xs)]",
};

const TONE_CLASS = {
  normal: "text-fg opacity-80 hover:bg-fg/5 hover:opacity-100 focus-visible:bg-fg/5 focus-visible:opacity-100",
  quiet: "text-fg opacity-55 hover:bg-fg/5 hover:opacity-90 focus-visible:bg-fg/5 focus-visible:opacity-90",
  danger: "text-scarlet hover:bg-scarlet/5 focus-visible:bg-scarlet/5",
};

const PILL_CLASS =
  "flex-1 cursor-pointer rounded-sm border border-transparent bg-fg/5 px-2 py-1 " +
  "text-[length:var(--fs-2xs)] font-medium uppercase tracking-wide text-fg/65 outline-none " +
  "transition-colors hover:bg-fg hover:text-bg focus-visible:bg-fg focus-visible:text-bg";

/**
 * Dropdown menu: click-outside, Escape, arrow/Home/End/type-ahead
 * navigation, and focus return to the trigger on close.
 *
 *   [trigger] --click/ArrowDown--> opens, focuses first item (keyboard)
 *   item focus moves with arrows (wraps); Escape -> close + focus trigger
 */
export function Menu({
  entries,
  renderTrigger,
  align = MenuAlign.Start,
  placement = MenuPlacement.Anchored,
  density = MenuDensity.Regular,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [floatPos, setFloatPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusFirstRef = useRef(false);
  const typeahead = useRef({ text: "", timer: 0 });
  const listId = useId();
  const floating = placement === MenuPlacement.Floating;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setFloatPos(null);
    if (returnFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const items = useCallback(
    () => Array.from(listRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []),
    [],
  );

  // Floating: place the list once it is measurable. Below the trigger, or
  // above when it would not fit below but fits above; kept inside the viewport.
  useLayoutEffect(() => {
    if (!open || !floating || !triggerRef.current || !listRef.current) {
      return;
    }
    const trigger = triggerRef.current.getBoundingClientRect();
    const width = listRef.current.offsetWidth;
    const height = listRef.current.offsetHeight;
    const fitsBelow = window.innerHeight - trigger.bottom - ANCHOR_GAP_PX >= height;
    const fitsAbove = trigger.top - ANCHOR_GAP_PX >= height;
    const openUp = !fitsBelow && fitsAbove;

    const top = openUp ? trigger.top - height - ANCHOR_GAP_PX : trigger.bottom + ANCHOR_GAP_PX;
    const wantedLeft = align === MenuAlign.End ? trigger.right - width : trigger.left;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN_PX;
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(wantedLeft, maxLeft));
    setFloatPos({ top: Math.max(VIEWPORT_MARGIN_PX, top), left });
  }, [open, floating, align]);

  // Close on outside press. Focus is left where the user clicked. A
  // floating list lives in a portal, so it is checked separately.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPress(e: MouseEvent) {
      const target = e.target as Node;
      const inside = rootRef.current?.contains(target) || listRef.current?.contains(target);
      if (!inside) {
        close(false);
      }
    }
    document.addEventListener("mousedown", onPress);
    return () => document.removeEventListener("mousedown", onPress);
  }, [open, close]);

  // A floating list does not follow its trigger: close it when the page
  // scrolls or resizes (scrolling inside the list itself is fine).
  useEffect(() => {
    if (!open || !floating) {
      return;
    }
    function onScroll(e: Event) {
      if (listRef.current?.contains(e.target as Node)) {
        return;
      }
      close(false);
    }
    function onResize() {
      close(false);
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, floating, close]);

  // Opened by keyboard: move focus into the list. Pointer opens keep focus on the trigger.
  useEffect(() => {
    if (!open || !focusFirstRef.current) {
      return;
    }
    focusFirstRef.current = false;
    items()[0]?.focus();
  }, [open, items, floatPos]);

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
    if (open) {
      close(false);
      return;
    }
    setOpen(true);
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

  const closeMenu = () => close(false);
  const list = (
    <div
      ref={listRef}
      id={listId}
      role="menu"
      onKeyDown={onListKeyDown}
      // Rows are often clickable; a click in a portal would still bubble to them.
      onClick={floating ? (e) => e.stopPropagation() : undefined}
      style={
        floating
          ? {
              ...containerStyle,
              position: "fixed",
              minWidth: MIN_WIDTH[density],
              top: floatPos?.top ?? 0,
              left: floatPos?.left ?? 0,
              // Hidden until measured, so it never flashes at the wrong spot.
              visibility: floatPos ? "visible" : "hidden",
            }
          : {
              ...containerStyle,
              position: "absolute",
              top: `calc(100% + ${ANCHOR_GAP_PX}px)`,
              minWidth: MIN_WIDTH[density],
              [align === MenuAlign.End ? "right" : "left"]: 0,
            }
      }
    >
      {entries.map((entry, i) => renderEntry(entry, i, density, closeMenu))}
    </div>
  );

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      {renderTrigger(triggerProps, open)}
      {open && (floating ? typeof document !== "undefined" && createPortal(list, document.body) : list)}
    </div>
  );
}

function renderEntry(entry: MenuEntry, index: number, density: MenuDensity, closeMenu: () => void) {
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

  if (entry.kind === "pills") {
    return (
      <div key={index} role="group" aria-label={entry.heading} className="px-1 pb-1.5 pt-1">
        {entry.heading && (
          <span className="block px-1.5 pb-1 text-[length:var(--fs-2xs)] font-medium uppercase tracking-wider text-fg/45">
            {entry.heading}
          </span>
        )}
        <div className="flex items-stretch gap-1">
          {entry.items.map((pill) => (
            <button
              key={pill.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              title={pill.title ?? pill.label}
              className={PILL_CLASS}
              onClick={() => {
                closeMenu();
                pill.onSelect();
              }}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const className = `${ITEM_BASE} ${DENSITY_CLASS[density]} ${TONE_CLASS[entry.tone ?? "normal"]}`;
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
      <a
        key={index}
        role="menuitem"
        tabIndex={-1}
        href={entry.href}
        download={entry.download || undefined}
        title={entry.title ?? entry.label}
        className={className}
        onClick={closeMenu}
      >
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
      title={entry.title ?? entry.label}
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
