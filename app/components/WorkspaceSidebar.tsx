import { HomeIcon, ClockIcon, StarIcon, ShareIcon, TrashIcon, SettingsIcon } from "./icons";
import { nameColor, formatStorage } from "~/lib/ui-utils";

export type TeamspaceNavItem = { id: string; name: string; icon?: string | null };

export interface WorkspaceSidebarProps {
  sharedCount: number;
  activePath: "home" | "recent" | "favorites" | "shared" | "trash" | "settings" | "folder" | null;
  storageBytes?: number;
  teamspaces?: TeamspaceNavItem[];
}

const NAV_ITEMS = [
  { key: "home", label: "Home", href: "/w", icon: HomeIcon, activeKeys: ["home", "folder"] },
  { key: "recent", label: "Recent", href: "/w/recent", icon: ClockIcon, activeKeys: ["recent"] },
  { key: "favorites", label: "Favorites", href: "/w/favorites", icon: StarIcon, activeKeys: ["favorites"] },
  { key: "shared", label: "Shared with me", href: "/shared", icon: ShareIcon, activeKeys: ["shared"], badge: true },
  { key: "trash", label: "Trash", href: "/trash", icon: TrashIcon, activeKeys: ["trash"] },
] as const;

const BOTTOM_ITEMS = [
  { key: "settings", label: "Settings", href: "/settings", icon: SettingsIcon, activeKeys: ["settings"] },
] as const;

function NavLink({ item, activePath, sharedCount }: {
  item: typeof NAV_ITEMS[number] | typeof BOTTOM_ITEMS[number];
  activePath: WorkspaceSidebarProps["activePath"];
  sharedCount?: number;
}) {
  const isActive = activePath !== null && (item.activeKeys as readonly string[]).includes(activePath);
  const Icon = item.icon;
  const hasBadge = "badge" in item && item.badge;
  return (
    <a
      href={item.href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] no-underline transition-colors ${
        isActive
          ? "bg-fg/[0.06] font-semibold text-fg"
          : "text-fg/70 hover:bg-fg/[0.04] hover:text-fg/90"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {item.label}
      {hasBadge && sharedCount !== undefined && sharedCount > 0 && (
        <span className="ml-auto rounded-full bg-fg/[0.08] px-1.5 py-0.5 text-[0.6rem] leading-none text-fg/50">
          {sharedCount}
        </span>
      )}
    </a>
  );
}

export function WorkspaceSidebar({
  sharedCount,
  activePath,
  storageBytes,
  teamspaces,
}: WorkspaceSidebarProps) {
  return (
    <aside className="hidden w-56 flex-shrink-0 flex-col border-r border-fg/[0.08] bg-fg/[0.02] overflow-y-auto md:flex">
      {/* Search trigger */}
      <div className="px-3 pt-3 pb-1">
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "k",
                metaKey: true,
                bubbles: true,
              })
            );
          }}
          className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg border border-fg/[0.08] bg-transparent px-3 py-1.5 text-[13px] text-fg/50 transition-colors hover:border-fg/15 hover:text-fg/70"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Search…
          <kbd className="ml-auto rounded border border-fg/10 px-1 py-0.5 text-[0.6rem] leading-none text-fg/25">⌘K</kbd>
        </button>
      </div>

      {/* Main nav links */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3 pt-2">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.key} item={item} activePath={activePath} sharedCount={sharedCount} />
        ))}

        {/* Teamspaces section */}
        {teamspaces && teamspaces.length > 0 && (
          <div className="mt-3 flex flex-col gap-0.5">
            <div className="px-3 pb-1 text-[0.6rem] font-bold uppercase tracking-wider text-fg/30">
              Teamspaces
            </div>
            {teamspaces.map((ts) => (
              <a
                key={ts.id}
                href={`/t/${ts.id}`}
                className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] text-fg/70 no-underline transition-colors hover:bg-fg/[0.04] hover:text-fg/90"
              >
                {ts.icon ? (
                  <img src={ts.icon} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
                ) : (
                  <div
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[0.55rem] font-bold text-white"
                    style={{ backgroundColor: nameColor(ts.name) }}
                  >
                    {ts.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="truncate">{ts.name}</span>
              </a>
            ))}
          </div>
        )}

        {/* Bottom nav (pushed to bottom) */}
        <div className="mt-auto flex flex-col gap-0.5 pb-3 pt-2">
          {BOTTOM_ITEMS.map((item) => (
            <NavLink key={item.key} item={item} activePath={activePath} />
          ))}
          {storageBytes !== undefined && (
            <div className="mt-1 px-3 text-[11px] text-fg/30">
              {formatStorage(storageBytes)} used
            </div>
          )}
        </div>
      </nav>
    </aside>
  );
}
