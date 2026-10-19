import { useFetcher } from "react-router";
import { armUndoCreate } from "~/lib/undoCreate";
import { extensionTemplates, templateOwners } from "~/extensions";
import { useEnabledExtensionIds } from "~/root";
import { Menu, MenuDensity, MenuPlacement } from "~/components/Menu";
import type { MenuEntry } from "~/components/Menu";

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function DocSvg() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FolderSvg() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

interface SidebarCreateMenuProps {
  /** Route action URL to submit to (e.g. "/w", "/w/folder/abc", "/t/xyz") */
  actionUrl: string;
  /** Intent for creating a new document */
  docIntent: string;
  /** Intent for creating a new folder */
  folderIntent: string;
  /** Extra hidden fields to include (e.g. folderId) */
  extraFields?: Record<string, string>;
  /** Additional CSS class for the trigger button */
  className?: string;
}

export function SidebarCreateMenu({
  actionUrl,
  docIntent,
  folderIntent,
  extraFields,
  className = "",
}: SidebarCreateMenuProps) {
  const fetcher = useFetcher();
  const enabledExtensionIds = useEnabledExtensionIds();

  // Extension templates whose owner is enabled by admin.
  const visibleTemplates = extensionTemplates.filter((t) => {
    const owner = templateOwners.get(t.id);
    return !owner || enabledExtensionIds.has(owner);
  });

  function handleCreate(opts: { kind: "doc" | "folder" | "template"; templateId?: string }) {
    const data: Record<string, string> = {
      intent: opts.kind === "folder" ? folderIntent : docIntent,
      ...(extraFields ?? {}),
    };
    if (opts.kind === "folder") {
      data.name = "New folder";
    }
    if (opts.kind === "template" && opts.templateId) {
      data.template = opts.templateId;
    }
    if (opts.kind !== "folder") {
      const flashKind = opts.kind === "template" ? opts.templateId! : "doc";
      armUndoCreate(flashKind, typeof window !== "undefined" ? window.location.pathname : "/");
    }
    fetcher.submit(data, { method: "post", action: actionUrl });
  }

  const entries: MenuEntry[] = [
    { kind: "item", label: "New document", icon: <DocSvg />, onSelect: () => handleCreate({ kind: "doc" }) },
    ...visibleTemplates.map((tpl): MenuEntry => {
      const Icon = tpl.Icon;
      return {
        kind: "item",
        label: `New ${tpl.label.toLowerCase()}`,
        icon: Icon ? <Icon className="w-3 h-3" /> : <span style={{ fontSize: 12, lineHeight: "12px" }}>{tpl.icon}</span>,
        onSelect: () => handleCreate({ kind: "template", templateId: tpl.id }),
      };
    }),
    { kind: "item", label: "New folder", icon: <FolderSvg />, onSelect: () => handleCreate({ kind: "folder" }) },
  ];

  return (
    <Menu
      placement={MenuPlacement.Floating}
      density={MenuDensity.Compact}
      entries={entries}
      renderTrigger={({ ref, onClick, ...props }) => (
        <button
          {...props}
          ref={ref}
          type="button"
          // The trigger sits inside links and clickable rows.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick?.(e);
          }}
          className={`sidebar-create-btn ${className}`}
          title="Create new..."
        >
          <PlusIcon />
        </button>
      )}
    />
  );
}
