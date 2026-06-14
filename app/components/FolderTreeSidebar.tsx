import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { nameColor, formatStorage } from "~/lib/ui-utils";
import { FolderTreeNode, docIndent } from "./FolderTreeNode";
import { DocIcon, PdfIcon, AttachmentIcon } from "~/components/icons";
import { useDndState } from "~/components/dnd/DndProvider";
import { Droppable } from "~/components/dnd/Droppable";
import type { FolderSummary } from "~/lib/folder.server";
import { SidebarCreateMenu } from "./SidebarCreateMenu";

export type TeamspaceNavItem = { id: string; name: string; icon?: string | null };

export interface FolderTreeSidebarProps {
  activeSection: { type: "workspace"; id: string } | { type: "teamspace"; id: string };
  activeView?: "recent" | "favorites" | "shared" | "trash" | "members" | null;
  activeItemId?: string | null;
  expandAncestors?: string[];

  workspaceName: string;
  workspaceId: string;
  rootFolders?: FolderSummary[];
  rootDocs?: { id: string; title: string; pdf_file?: string | null }[];

  teamspaces?: TeamspaceNavItem[];
  sharedCount?: number;
  storageBytes?: number;
  /** When true, sidebar auto-collapses on mount with animation (used by doc views) */
  autoCollapse?: boolean;
  /** When true, sidebar fetches its own data on mount instead of using props */
  lazy?: boolean;
}

function useLocalStorageSet(key: string, initial: string[] = []): [Set<string>, (updater: (prev: Set<string>) => Set<string>) => void] {
  const [value, setValue] = useState<Set<string>>(() => new Set(initial));

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) setValue(new Set(JSON.parse(stored)));
    } catch {}
  }, [key]);

  const update = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setValue((prev) => {
      const next = updater(prev);
      try { localStorage.setItem(key, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [key]);

  return [value, update];
}

function useLocalStorageBool(key: string, initial = false): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) setValue(stored === "true");
    } catch {}
  }, [key]);

  const update = useCallback((v: boolean) => {
    setValue(v);
    try { localStorage.setItem(key, String(v)); } catch {}
  }, [key]);

  return [value, update];
}

function useLocalStorageJson<T extends Record<string, boolean>>(key: string, initial: T): [T, (updater: (prev: T) => T) => void] {
  const [value, setValue] = useState<T>(() => {
    return initial;
  });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) setValue((prev) => ({ ...prev, ...JSON.parse(stored) }));
    } catch {}
  }, [key]);

  const update = useCallback((updater: (prev: T) => T) => {
    setValue((prev) => {
      const next = updater(prev);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [key]);

  return [value, update];
}

// Inline SVG icons for smart views
function RecentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function StarViewIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function SharedIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function MembersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SectionChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform var(--ease-out)" }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25">
      <rect x="0.5" y="0.5" width="15" height="15" />
      <line x1="5.5" y1="0.5" x2="5.5" y2="15.5" />
    </svg>
  );
}

interface LazyTreeData {
  folders: FolderSummary[];
  docs: { id: string; title: string; pdf_file: string | null }[];
}

function LazyTeamspaceTree({
  teamspaceId,
  activeItemId,
  expandedFolders,
  onToggle,
  crossWorkspaceId,
  refreshToken,
}: {
  teamspaceId: string;
  activeItemId?: string | null;
  expandedFolders: Set<string>;
  onToggle: (folderId: string) => void;
  crossWorkspaceId?: string;
  refreshToken?: number;
}) {
  // Plain `fetch` instead of `useFetcher.load` to avoid RR's fog-of-war
  // manifest discovery (see FolderTreeSidebar comment for details).
  const [data, setData] = useState<LazyTreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const hasFetched = useRef(false);
  const urlPrefix = `/t/${teamspaceId}`;

  function fetchData() {
    hasFetched.current = true;
    let cancelled = false;
    fetch(`/api/folder-children/${teamspaceId}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { /* leave null */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }

  useEffect(() => {
    if (hasFetched.current) return;
    return fetchData();
  }, [teamspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!refreshToken) return;
    hasFetched.current = false;
    setData(null);
    setLoading(true);
    fetchData();
  }, [refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) {
    return (
      <div className="py-1.5 pl-6 text-[11px] text-fg/25 italic">Loading...</div>
    );
  }

  if (!data) return null;

  const { folders, docs } = data;

  return (
    <div className="py-0.5">
      {folders.map((folder) => (
        <FolderTreeNode
          key={folder.id}
          folder={folder}
          depth={0}
          activeItemId={activeItemId}
          workspaceId={teamspaceId}
          expandedFolders={expandedFolders}
          onToggle={onToggle}
          urlPrefix={urlPrefix}
          crossWorkspaceId={crossWorkspaceId}
          refreshToken={refreshToken}
        />
      ))}
      {docs.map((doc) => {
        const isPdf = doc.pdf_file?.toLowerCase().endsWith(".pdf");
        const isFile = !!doc.pdf_file && !isPdf;
        return (
          <a
            key={doc.id}
            href={`${urlPrefix}/doc/${doc.id}`}
            className={`sidebar-item ${activeItemId === doc.id ? "sidebar-item-active" : ""}`}
            style={{ paddingLeft: "1.625rem" }}
            data-tree-item={doc.id}
          >
            {isPdf ? (
              <PdfIcon className="h-3.5 w-3.5 shrink-0 text-scarlet/60" />
            ) : isFile ? (
              <AttachmentIcon className="h-3.5 w-3.5 shrink-0 text-purple/50" />
            ) : (
              <DocIcon className="h-3.5 w-3.5 shrink-0 text-cyan/50" />
            )}
            <span className="truncate">{doc.title || "Untitled"}</span>
          </a>
        );
      })}
    </div>
  );
}

export function FolderTreeSidebar({
  activeSection,
  activeView,
  activeItemId,
  expandAncestors,
  workspaceName,
  workspaceId,
  rootFolders: propRootFolders,
  rootDocs: propRootDocs,
  teamspaces: propTeamspaces,
  sharedCount: propSharedCount,
  storageBytes: propStorageBytes,
  autoCollapse,
  lazy,
}: FolderTreeSidebarProps) {
  // Lazy sidebar data: hit the API directly with `fetch` rather than
  // `useFetcher.load`, which would trigger RR's fog-of-war route discovery
  // (`/__manifest?paths=…`). Vite serves the manifest with `cache-control:
  // immutable`, so any single empty/aborted response gets stuck in Firefox's
  // cache and surfaces as "JSON.parse: unexpected end of data" thereafter.
  type SidebarData = {
    rootFolders: FolderSummary[];
    rootDocs: { id: string; title: string; pdf_file?: string | null }[];
    teamspaces: TeamspaceNavItem[];
    sharedCount: number;
    storageBytes: number;
  };
  const [sidebarData, setSidebarData] = useState<SidebarData | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const fetchSidebarData = useCallback(() => {
    fetch(`/api/sidebar-data/${workspaceId}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setSidebarData(data); })
      .catch(() => { /* keep prop fallbacks */ });
  }, [workspaceId]);

  useEffect(() => {
    if (!lazy) return;
    fetchSidebarData();
  }, [lazy, fetchSidebarData]);

  useEffect(() => {
    function handleRefresh() {
      if (lazy) fetchSidebarData();
      setRefreshToken((t) => t + 1);
    }
    window.addEventListener("loica:sidebar-refresh", handleRefresh);
    return () => window.removeEventListener("loica:sidebar-refresh", handleRefresh);
  }, [lazy, fetchSidebarData]);

  const rootFolders = sidebarData?.rootFolders ?? propRootFolders ?? [];
  const rootDocs = sidebarData?.rootDocs ?? propRootDocs ?? [];
  const teamspaces = sidebarData?.teamspaces ?? propTeamspaces;
  const sharedCount = sidebarData?.sharedCount ?? propSharedCount;
  const storageBytes = sidebarData?.storageBytes ?? propStorageBytes;
  const [userCollapsed, setUserCollapsed] = useLocalStorageBool("loica:sidebar-manual-collapse", false);

  // In doc views: sidebar starts open, then animates closed after a brief delay
  // In other views: respect the persisted user preference
  const [docCollapsed, setDocCollapsed] = useState(false);
  const collapsed = autoCollapse ? docCollapsed : userCollapsed;

  useEffect(() => {
    if (autoCollapse) {
      const timer = setTimeout(() => setDocCollapsed(true), 400);
      return () => clearTimeout(timer);
    }
  }, [autoCollapse]);
  const toggleCollapse = useCallback(() => {
    if (autoCollapse) {
      setDocCollapsed((v) => !v);
    } else {
      setUserCollapsed(!userCollapsed);
    }
  }, [autoCollapse, userCollapsed, setUserCollapsed]);
  const [expandedFolders, setExpandedFolders] = useLocalStorageSet("loica:expanded-folders");
  const [sectionState, setSectionState] = useLocalStorageJson("loica:sidebar-sections", {} as Record<string, boolean>);
  const hasAutoExpanded = useRef(false);

  useEffect(() => {
    if (expandAncestors && expandAncestors.length > 0 && !hasAutoExpanded.current) {
      hasAutoExpanded.current = true;
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const id of expandAncestors) next.add(id);
        return next;
      });
    }
  }, [expandAncestors, setExpandedFolders]);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeItemId && scrollAreaRef.current) {
      requestAnimationFrame(() => {
        const container = scrollAreaRef.current;
        const el = container?.querySelector(`[data-tree-item="${activeItemId}"]`) as HTMLElement | null;
        if (!el || !container) return;
        const elTop = el.offsetTop;
        const elBottom = elTop + el.offsetHeight;
        const viewTop = container.scrollTop;
        const viewBottom = viewTop + container.clientHeight;
        if (elTop < viewTop) {
          container.scrollTop = elTop;
        } else if (elBottom > viewBottom) {
          container.scrollTop = elBottom - container.clientHeight;
        }
      });
    }
  }, [activeItemId]);

  const handleToggle = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, [setExpandedFolders]);

  const toggleSection = useCallback((sectionId: string) => {
    setSectionState((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, [setSectionState]);

  const isSectionExpanded = useCallback((sectionId: string, isActiveSection: boolean) => {
    if (sectionId in sectionState) return sectionState[sectionId];
    return isActiveSection;
  }, [sectionState]);

  // Compute smart view URLs based on active section
  const isInTeamspace = activeSection.type === "teamspace";
  const viewBase = isInTeamspace ? `/t/${activeSection.id}` : "/w";

  const smartViews = [
    { key: "recent" as const, label: "Recent", href: `${viewBase}/recent`, icon: RecentIcon },
    { key: "favorites" as const, label: "Favorites", href: `${viewBase}/favorites`, icon: StarViewIcon },
    ...(isInTeamspace
      ? [{ key: "members" as const, label: "Members", href: `/t/${activeSection.id}/members`, icon: MembersIcon }]
      : [{ key: "shared" as const, label: "Shared", href: "/shared", icon: SharedIcon }]),
    ...(isInTeamspace
      ? [{ key: "trash" as const, label: "Trash", href: `/t/${activeSection.id}/trash`, icon: TrashIcon }]
      : [{ key: "trash" as const, label: "Trash", href: "/trash", icon: TrashIcon }]),
  ];

  const { enabled: dndEnabled } = useDndState();
  const isWorkspaceActive = activeSection.type === "workspace";
  const wsExpanded = isSectionExpanded("workspace", isWorkspaceActive);
  const wsUrlPrefix = "/w";

  return (
    <aside className={`${collapsed ? "sidebar-collapsed" : "sidebar"} hidden flex-shrink-0 flex-col md:flex`}>
      {/* Header — toggle button */}
      <div className="sidebar-header" style={{ justifyContent: collapsed ? "center" : undefined }}>
        {!collapsed && <Link to="/w" prefetch="intent" className="truncate no-underline text-inherit">{workspaceName || "Files"}</Link>}
        <button
          type="button"
          onClick={toggleCollapse}
          className="sidebar-header-btn"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <CollapseIcon />
        </button>
      </div>

      <div className="sidebar-content" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

      {/* Search pill */}
      <button
        type="button"
        className="sidebar-search-pill"
        onClick={() => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "k",
              metaKey: true,
              bubbles: true,
            })
          );
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        Search
        <kbd>&#8984;K</kbd>
      </button>

      {/* Smart view links */}
      <div className="flex flex-col py-1">
        {smartViews.map((v) => (
          <Link
            key={v.key}
            to={v.href}
            prefetch="intent"
            className={`sidebar-item ${activeView === v.key ? "sidebar-item-active" : ""}`}
          >
            <v.icon className="h-3.5 w-3.5 shrink-0 opacity-40" />
            <span className="truncate">{v.label}</span>
            {v.key === "shared" && sharedCount ? (
              <span className="sidebar-badge">{sharedCount}</span>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="sidebar-divider" />

      {/* Scrollable sections area */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto">
        {/* My Files section */}
        <div className="flex flex-col">
          {dndEnabled ? (
            <Droppable target={{ type: "root", id: null, ...(activeSection.type === "teamspace" ? { workspaceId } : {}) }}>
              {({ dropRef, isOver, isInvalid }) => (
                <div
                  ref={dropRef}
                  role="button"
                  tabIndex={0}
                  className={`sidebar-section-header${
                    isOver && !isInvalid ? " sidebar-drop-over" : ""
                  }${isInvalid ? " sidebar-drop-invalid" : ""}`}
                  onClick={() => toggleSection("workspace")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSection("workspace"); } }}
                >
                  <SectionChevron expanded={wsExpanded} />
                  <Link
                    to="/w"
                    prefetch="intent"
                    className="flex-1 truncate text-left no-underline text-inherit"
                    onClick={(e) => e.stopPropagation()}
                  >
                    My Files
                  </Link>
                  <SidebarCreateMenu
                    actionUrl="/w"
                    docIntent="create"
                    folderIntent="create-folder"
                  />
                </div>
              )}
            </Droppable>
          ) : (
            <div
              role="button"
              tabIndex={0}
              className="sidebar-section-header"
              onClick={() => toggleSection("workspace")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSection("workspace"); } }}
            >
              <SectionChevron expanded={wsExpanded} />
              <a
                href="/w"
                className="flex-1 truncate text-left no-underline text-inherit"
                onClick={(e) => e.stopPropagation()}
              >
                My Files
              </a>
              <SidebarCreateMenu
                actionUrl="/w"
                docIntent="create"
                folderIntent="create-folder"
              />
            </div>
          )}
          {wsExpanded && (
            <div className="py-0.5">
              {rootFolders.map((folder) => (
                <FolderTreeNode
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  activeItemId={activeItemId}
                  workspaceId={workspaceId}
                  expandedFolders={expandedFolders}
                  onToggle={handleToggle}
                  urlPrefix={wsUrlPrefix}
                  crossWorkspaceId={activeSection.type === "teamspace" ? workspaceId : undefined}
                  refreshToken={refreshToken}
                />
              ))}
              {rootDocs.map((doc) => {
                const isPdf = doc.pdf_file?.toLowerCase().endsWith(".pdf");
                const isFile = !!doc.pdf_file && !isPdf;
                return (
                  <Link
                    key={doc.id}
                    to={`/w/doc/${doc.id}`}
                    target="_blank"
                    rel="noopener"
                    className={`sidebar-item ${activeItemId === doc.id ? "sidebar-item-active" : ""}`}
                    style={{ paddingLeft: `${docIndent(0)}rem` }}
                    data-tree-item={doc.id}
                  >
                    {isPdf ? (
                      <PdfIcon className="h-3.5 w-3.5 shrink-0 text-scarlet/60" />
                    ) : isFile ? (
                      <AttachmentIcon className="h-3.5 w-3.5 shrink-0 text-purple/50" />
                    ) : (
                      <DocIcon className="h-3.5 w-3.5 shrink-0 text-cyan/50" />
                    )}
                    <span className="truncate">{doc.title || "Untitled"}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Teamspace sections */}
        {teamspaces && teamspaces.map((ts) => {
          const isTs = activeSection.type === "teamspace" && activeSection.id === ts.id;
          const tsExpanded = isSectionExpanded(`ts-${ts.id}`, isTs);

          const isCrossWorkspace = !(activeSection.type === "teamspace" && activeSection.id === ts.id);
          const tsDropTarget = { type: "root" as const, id: null, ...(isCrossWorkspace ? { workspaceId: ts.id } : {}) };

          const tsHeader = (
            dropRef?: (el: HTMLElement | null) => void,
            isOver?: boolean,
            isInvalid?: boolean,
          ) => (
            <div
              ref={dropRef}
              role="button"
              tabIndex={0}
              className={`sidebar-section-header${
                isOver && !isInvalid ? " sidebar-drop-over" : ""
              }${isInvalid ? " sidebar-drop-invalid" : ""}`}
              onClick={() => toggleSection(`ts-${ts.id}`)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSection(`ts-${ts.id}`); } }}
            >
              <SectionChevron expanded={tsExpanded} />
              <Link
                to={`/t/${ts.id}`}
                prefetch="intent"
                className="flex flex-1 items-center gap-1.5 truncate text-left no-underline text-inherit"
                onClick={(e) => e.stopPropagation()}
              >
                {ts.icon ? (
                  <img src={ts.icon} alt="" className="h-3 w-3 shrink-0 rounded object-cover" />
                ) : (
                  <span
                    className="flex h-3 w-3 shrink-0 items-center justify-center rounded text-[0.4rem] font-bold text-white"
                    style={{ backgroundColor: nameColor(ts.name) }}
                  >
                    {ts.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="truncate">{ts.name}</span>
              </Link>
              <SidebarCreateMenu
                actionUrl={`/t/${ts.id}`}
                docIntent="create"
                folderIntent="create-folder"
              />
            </div>
          );

          return (
            <div key={ts.id} className="flex flex-col">
              {dndEnabled ? (
                <Droppable target={tsDropTarget}>
                  {({ dropRef, isOver, isInvalid }) => tsHeader(dropRef, isOver, isInvalid)}
                </Droppable>
              ) : (
                tsHeader()
              )}
              {tsExpanded && (
                <LazyTeamspaceTree
                  teamspaceId={ts.id}
                  activeItemId={activeItemId}
                  expandedFolders={expandedFolders}
                  onToggle={handleToggle}
                  crossWorkspaceId={isCrossWorkspace ? ts.id : undefined}
                  refreshToken={refreshToken}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {storageBytes !== undefined && (
        <div className="sidebar-footer">
          <span className="text-[0.6rem] text-fg/20">
            {formatStorage(storageBytes)}
          </span>
        </div>
      )}
      </div>{/* end sidebar-content */}
    </aside>
  );
}
