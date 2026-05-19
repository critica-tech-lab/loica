import { useFetcher } from "react-router";
import { NewButton } from "~/components/NewButton";
import { armUndoCreate } from "~/lib/undoCreate";
import { ImportDropZone } from "~/components/ImportDropZone";
import { StarIcon } from "~/components/icons";
import { timeAgo } from "~/lib/ui-utils";
import { useImport } from "~/components/hooks/useImport";

interface StarredDoc {
  id: string;
  title: string;
  updated_at: number;
}

export function FavoritesView({
  starredDocs,
  canEdit,
  getDocHref,
}: {
  starredDocs: StarredDoc[];
  canEdit: boolean;
  getDocHref: (docId: string) => string;
}) {
  const starFetcher = useFetcher();
  const createFetcher = useFetcher();
  const { handleImport } = useImport();

  return (
    <ImportDropZone onImport={handleImport}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <div className="flex items-center justify-between">
          <h1 className="section-header">Favorites</h1>
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

        {starredDocs.length === 0 ? (
          <div className="archive-empty">
            <p>No favorites yet.</p>
            <p>Star a document to see it here.</p>
          </div>
        ) : (
          <div className="archive-list">
            <div className="archive-header">
              <span className="flex-1">Name</span>
              <span className="w-20 shrink-0 text-right">Modified</span>
              <span className="w-8 shrink-0" />
            </div>
            {starredDocs.map((doc) => (
              <a
                key={doc.id}
                href={getDocHref(doc.id)}
                className="archive-row group no-underline"
              >
                <StarIcon filled className="mr-1.5 h-3 w-3 shrink-0 text-star" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                  {doc.title}
                </span>
                <span className="archive-meta w-20">
                  {timeAgo(doc.updated_at)}
                </span>
                <div className="archive-actions">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      starFetcher.submit({ intent: "toggle-star", docId: doc.id }, { method: "post" });
                    }}
                    title="Unstar"
                    className="shrink-0 cursor-pointer border-none bg-transparent p-0.5 leading-none"
                    style={{ color: "var(--color-star)" }}
                  >
                    <StarIcon filled className="h-3 w-3" />
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
