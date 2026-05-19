import { Form } from "react-router";
import { FolderIcon } from "~/components/icons";

interface NewFolderRowProps {
  onDone: () => void;
}

export function NewFolderRow({ onDone }: NewFolderRowProps) {
  return (
    <Form
      method="post"
      onSubmit={() => onDone()}
      className="flex items-center gap-3 border-b border-fg/[0.06] px-4 py-2.5"
    >
      <input type="hidden" name="intent" value="create-folder" />
      <FolderIcon className="h-4 w-4 shrink-0 text-accent/50" />
      <input
        name="name"
        autoFocus
        placeholder="Folder name…"
        className="flex-1 rounded border border-fg/15 bg-bg px-2 py-1 text-sm text-fg outline-none placeholder:text-fg/25 transition-colors focus:border-accent/40"
        onBlur={() => onDone()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
      />
    </Form>
  );
}
