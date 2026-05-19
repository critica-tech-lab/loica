import { useFetcher } from "react-router";
import { NewButton } from "~/components/NewButton";
import { armUndoCreate } from "~/lib/undoCreate";
import { ImportDropZone } from "~/components/ImportDropZone";
import { StarIcon } from "~/components/icons";
import { timeAgo, formatDate } from "~/lib/ui-utils";
import { useImport } from "~/components/hooks/useImport";
import { useMemo } from "react";

interface RecentDoc {
  id: string;
  title: string;
  updated_at: number;
  modifier_name: string | null;
  folder_name: string | null;
}

interface StarredDoc {
  id: string;
}

export function RecentView({
  recentDocs,
  starredDocs,
  canEdit,
  getDocHref,
  emptyLabel = "workspace",
}: {
  recentDocs: RecentDoc[];
  starredDocs: StarredDoc[];
  canEdit: boolean;
  getDocHref: (docId: string) => string;
  emptyLabel?: string;
}) {
  const starFetcher = useFetcher();
  const createFetcher = useFetcher();
  const { handleImport } = useImport();
  const starredSet = useMemo(() => new Set(starredDocs.map((d) => d.id)), [starredDocs]);

  return (
    <ImportDropZone onImport={handleImport}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <div className="flex items-center justify-between">
          <h1 className="section-header">Recent</h1>
          {canEdit && (
            <NewButton
              onCreateDoc={() => {
                armUndoCreate("doc", typeof window !== "undefined" ? window.location.pathname : "/");
                createFetcher.submit({ intent: "create" }, { method: "post" });
              }}
              onCreateFromTemplate={(templateId) => {
                armUndoCreate(templateId, typeof window !== "undefined" ? window.location.pathname : "/");
                createFetcher.submit({ intent: "create", template: templateId }, { method: "post" });
              }}
              onCreateFolder={() => {}}
              onImport={handleImport}
            />
          )}
        </div>

        {recentDocs.length === 0 ? (
          <div className="archive-empty">
            <p>No recently modified documents.</p>
            <p>Documents modified in this {emptyLabel} will appear here.</p>
          </div>
        ) : (
          <div className="archive-list">
            <div className="archive-header">
              <span className="flex-1">Name</span>
              <span className="w-24 shrink-0 text-right">Modified by</span>
              <span className="hidden w-24 shrink-0 text-right sm:block">Location</span>
              <span className="w-20 shrink-0 text-right">Modified</span>
              <span className="w-8 shrink-0" />
            </div>
            {recentDocs.map((doc) => (
              <a
                key={doc.id}
                href={getDocHref(doc.id)}
                className="archive-row group no-underline"
              >
                {starredSet.has(doc.id) && (
                  <StarIcon filled className="mr-1.5 h-3 w-3 shrink-0 text-star" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                  {doc.title}
                </span>
                <span className="archive-meta w-24">
                  {doc.modifier_name ?? "\u2014"}
                </span>
                <span className="archive-meta hidden w-24 sm:block">
                  {doc.folder_name ?? "/"}
                </span>
                <span className="archive-meta w-20" title={formatDate(doc.updated_at)}>
                  {timeAgo(doc.updated_at)}
                </span>
                <div className="archive-actions">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      starFetcher.submit({ intent: "toggle-star", docId: doc.id }, { method: "post" });
                    }}
                    title={starredSet.has(doc.id) ? "Unstar" : "Star"}
                    className="shrink-0 cursor-pointer border-none bg-transparent p-0.5 leading-none"
                    style={{
                      color: starredSet.has(doc.id) ? "var(--color-star)" : "color-mix(in srgb, var(--fg) 25%, transparent)",
                    }}
                  >
                    <StarIcon filled={starredSet.has(doc.id)} className="h-3 w-3" />
                  </button>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </ImportDropZone>
  );
}
