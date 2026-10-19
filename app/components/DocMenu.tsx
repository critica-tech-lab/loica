import { Menu, MenuAlign, MenuDensity } from "~/components/Menu";
import type { MenuEntry } from "~/components/Menu";

export type DocMenuItem =
  | {
      kind?: "action";
      label: string;
      icon?: React.ReactNode;
      onClick: () => void;
      title?: string;
    }
  | { kind: "separator" }
  | {
      /**
       * A row of compact pill buttons, used for same-kind actions like
       * picking a download format.
       */
      kind: "pills";
      heading?: string;
      items: { label: string; onClick: () => void; title?: string }[];
    };

interface DocMenuProps {
  items: DocMenuItem[];
  /** Accessible label for the trigger button. Default: "Document actions". */
  label?: string;
}

function toEntry(item: DocMenuItem): MenuEntry {
  if (item.kind === "separator") {
    return { kind: "separator" };
  }
  if (item.kind === "pills") {
    return {
      kind: "pills",
      heading: item.heading,
      items: item.items.map((p) => ({ label: p.label, title: p.title, onSelect: p.onClick })),
    };
  }
  return { kind: "item", label: item.label, icon: item.icon, title: item.title, onSelect: item.onClick };
}

/**
 * Topbar "⋯" menu for document-level actions (favorites, formatting toggle,
 * version history, downloads, etc). Separate from the avatar menu, which is
 * reserved for user/account actions.
 */
export function DocMenu({ items, label = "Document actions" }: DocMenuProps) {
  return (
    <Menu
      align={MenuAlign.End}
      density={MenuDensity.Compact}
      entries={items.map(toEntry)}
      renderTrigger={({ ref, ...props }, open) => (
        <button
          {...props}
          ref={ref}
          type="button"
          aria-label={label}
          title={label}
          className={
            "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[5px] border-none p-0 " +
            "transition-colors hover:bg-fg/5 hover:text-fg " +
            (open ? "bg-fg/10 text-fg" : "bg-transparent text-fg/55")
          }
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      )}
    />
  );
}
