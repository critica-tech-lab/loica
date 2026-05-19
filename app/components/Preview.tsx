import DOMPurify from "dompurify";
import { marked } from "marked";
import createFootnotes from "marked-footnote";
import { useMemo } from "react";
import { highlightExtension } from "~/lib/marked-highlight";
import { renumberFootnotesForDisplay } from "~/lib/templates";

marked.use({ extensions: highlightExtension });
marked.use(createFootnotes());

// Allow footnote-generated id/href attributes through DOMPurify
DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "id" || data.attrName === "href") {
    data.forceKeepAttr = true;
  }
});

interface PreviewProps {
  content: string;
}

export function Preview({ content }: PreviewProps) {
  const html = useMemo(
    () =>
      content.trim()
        ? DOMPurify.sanitize(String(marked.parse(renumberFootnotesForDisplay(content))))
        : "<p style=\"opacity:0.4;font-style:italic\">Nothing to preview yet.</p>",
    [content]
  );

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "0.375rem 2.5rem",
          fontSize: "0.7rem",
          opacity: 0.4,
          borderBottom: "1px solid color-mix(in srgb, var(--fg) 10%, transparent)",
          flexShrink: 0,
        }}
      >
        preview
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "2rem 2.5rem",
          fontSize: "0.9rem",
          lineHeight: 1.8,
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
