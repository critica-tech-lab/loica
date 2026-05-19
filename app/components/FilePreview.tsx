import { useState } from "react";
import { useFetcher } from "react-router";
import { AppShell } from "~/components/AppShell";
import { UserMenu } from "~/components/UserMenu";
import { StarIcon } from "~/components/icons";

function getFileCategory(filename: string): "pdf" | "image" | "audio" | "video" | "other" {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if ([".mp3", ".wav", ".flac", ".ogg"].includes(ext)) return "audio";
  if ([".mp4", ".mov", ".avi", ".webm"].includes(ext)) return "video";
  return "other";
}

export function FilePreviewContent({ file, title }: { file: string; title: string }) {
  const url = `/api/uploads/${file}`;
  const category = getFileCategory(file);

  if (category === "pdf") {
    return <iframe src={url} style={{ flex: 1, border: "none", width: "100%", height: "100%" }} title={title} />;
  }

  if (category === "image") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", padding: "2rem" }}>
        <img src={url} alt={title} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "0.5rem" }} />
      </div>
    );
  }

  if (category === "audio") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <audio controls src={url} style={{ width: "min(32rem, 90%)" }} />
      </div>
    );
  }

  if (category === "video") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", padding: "2rem" }}>
        <video controls src={url} style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: "0.5rem" }} />
      </div>
    );
  }

  const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.5rem" }}>
      <div style={{ fontSize: "3rem", opacity: 0.3 }}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <span style={{ fontSize: "0.85rem", opacity: 0.5 }}>{ext.slice(1).toUpperCase()} file</span>
      <a
        href={url}
        download
        style={{
          fontSize: "0.8rem", textDecoration: "none",
          color: "var(--fg)", padding: "0.5rem 1.5rem",
          border: "1px solid color-mix(in srgb, var(--fg) 20%, transparent)",
          borderRadius: "0.375rem",
        }}
      >
        Download
      </a>
    </div>
  );
}

interface FilePreviewProps {
  document: { id: string; title: string; pdf_file: string; public_token: string | null; edit_token: string | null };
  user: { id: string; name: string; is_admin?: boolean | number };
  starred: boolean;
  breadcrumbs: React.ReactNode;
}

export function FilePreview({ document, user, starred, breadcrumbs }: FilePreviewProps) {
  const saveFetcher = useFetcher();
  const starFetcher = useFetcher();
  const [title, setTitle] = useState(document.title);
  const [localStarred, setLocalStarred] = useState(starred);

  const navLeft = (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
      {breadcrumbs}
      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          saveFetcher.submit({ intent: "save", title: e.target.value }, { method: "post" });
        }}
        style={{
          fontSize: "0.8rem", fontWeight: 600,
          background: "none", border: "none", color: "var(--fg)", outline: "none",
          width: "min(20rem, 40vw)", padding: 0,
        }}
      />
    </div>
  );

  const isStarred = localStarred;

  const navActions = (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <button
        onClick={() => {
          setLocalStarred((prev) => !prev);
          starFetcher.submit({ intent: "toggle-star" }, { method: "post" });
        }}
        title={isStarred ? "Unstar" : "Star"}
        style={{
          background: "none", border: "none", cursor: "pointer", padding: "0.2rem", lineHeight: 1,
          color: isStarred ? "var(--color-tawny, #DA702C)" : "color-mix(in srgb, var(--fg) 25%, transparent)",
        }}
      >
        <StarIcon filled={isStarred} className="h-4 w-4" />
      </button>
      <a
        href={`/api/uploads/${document.pdf_file}`}
        download
        style={{
          fontSize: "0.7rem", opacity: 0.5, textDecoration: "none", color: "var(--fg)",
          padding: "0.2rem 0.5rem", border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
          borderRadius: "0.25rem",
        }}
      >
        Download
      </a>
      <UserMenu userName={user.name} isAdmin={!!user.is_admin} />
    </div>
  );

  return (
    <AppShell navLeft={navLeft} navActions={navActions}>
      <FilePreviewContent file={document.pdf_file} title={document.title} />
    </AppShell>
  );
}
