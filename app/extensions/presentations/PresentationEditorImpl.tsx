import { useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import { ProseMirrorEditor } from "~/components/ProseMirrorEditor";
import { PMToolbar } from "~/components/PMToolbar";
import type { EditorApi } from "~/lib/DocumentContext";
import type { PMActiveState } from "~/components/editor/types";
import type { ExtensionEditorViewProps } from "~/extensions/types";
import { splitSlides, parseSlide } from "./PresentView";
import slideThemeUrl from "./slide-theme-loica.css?url";

// Slide separators in the editor: render the `---` <hr> as a labeled, dashed
// slide break (numbered via a CSS counter) so the doc reads as a deck.
const SLIDE_EDITOR_CSS = `
.loica-slide-editor .ProseMirror { counter-reset: loica-slide 1; }
.loica-slide-editor .ProseMirror hr {
  counter-increment: loica-slide;
  border: none;
  border-top: 2px dashed var(--border, #d4d4d8);
  background: none;
  height: 0;
  margin: 2.6em 0;
  overflow: visible;
  position: relative;
}
.loica-slide-editor .ProseMirror hr::after {
  content: "◆ Slide " counter(loica-slide);
  position: absolute;
  top: -0.82em;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.12em 0.75em;
  background: var(--bg, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 999px;
  font-size: 0.64rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted, #9a9a9a);
  white-space: nowrap;
}
.loica-slide-editor .ProseMirror hr.ProseMirror-selectednode {
  outline: none;
  border-top-color: var(--accent, #AF3029);
}`;

/**
 * Presentation editing surface: the standard ProseMirror toolbar + collaborative
 * editor on the left, a live slide preview on the right. No CodeMirror — the doc
 * stays PM/markdown-canonical; the preview re-renders the editor's markdown (via
 * getMarkdown) through the same splitSlides/marked path as Present mode, themed
 * with the Loica slide CSS so it matches the deck.
 */
export function PresentationEditorImpl({
  initialContent,
  onChange,
  onReady,
  readOnly,
  docId,
  wsUrl,
  wsParams,
  userInfo,
  onConnectionStatus,
  onPresenceChange,
}: ExtensionEditorViewProps) {
  const apiRef = useRef<EditorApi | null>(null);
  const [markdown, setMarkdown] = useState(initialContent ?? "");
  const [activeState, setActiveState] = useState<PMActiveState | null>(null);

  // Inject the Loica slide theme once so preview cards match the real deck.
  useEffect(() => {
    const id = "loica-slide-theme";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = slideThemeUrl;
    document.head.appendChild(link);
  }, []);

  // Style the editor's slide separators (`---` → <hr>) as labeled slide breaks
  // so the markdown reads as a deck, not a flat doc.
  useEffect(() => {
    const id = "loica-slide-editor-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = SLIDE_EDITOR_CSS;
    document.head.appendChild(style);
  }, []);

  const refresh = useCallback(() => {
    const md = apiRef.current?.getMarkdown?.();
    if (typeof md === "string") setMarkdown(md);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {!readOnly && (
        <PMToolbar activeState={activeState} editorApiRef={apiRef} canEdit />
      )}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div className="loica-slide-editor" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <ProseMirrorEditor
            docId={docId ?? ""}
            wsUrl={wsUrl ?? ""}
            wsParams={wsParams}
            userInfo={userInfo ?? { name: "?", color: "#888888" }}
            readOnly={readOnly}
            autoFocus={!readOnly}
            onReady={(api) => {
              apiRef.current = api;
              onReady?.();
              refresh();
            }}
            onChange={() => {
              onChange(apiRef.current?.getMarkdown?.() ?? "");
              refresh();
            }}
            onStateChange={setActiveState}
            onConnectionStatus={onConnectionStatus}
            onPresenceChange={onPresenceChange}
          />
        </div>
        <SlidePreview markdown={markdown} />
      </div>
    </div>
  );
}

// ─── Live slide preview ───────────────────────────────────────────────────────

function SlidePreview({ markdown }: { markdown: string }) {
  marked.setOptions({ gfm: true, breaks: false });
  // Flatten vertical sub-slides into a single top-to-bottom thumbnail stack.
  const slides = splitSlides(markdown).flat();

  // Render each slide at full deck size, then scale the whole stage down — this
  // preserves the real slide proportions (headings, spacing, centering) instead
  // of reflowing a shrunk webpage.
  const PANEL = 340;
  const PAD = 16;
  const STAGE_W = 960;
  const STAGE_H = 540; // 16:9
  const cardW = PANEL - PAD * 2;
  const scale = cardW / STAGE_W;

  return (
    <div
      style={{
        width: PANEL,
        flexShrink: 0,
        overflowY: "auto",
        background: "var(--nc-bg-2, #f6f8fa)",
        borderLeft: "1px solid var(--border, #e5e7eb)",
        padding: PAD,
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {slides.length} slide{slides.length === 1 ? "" : "s"}
      </div>
      {slides.map((slide, i) => {
        const { body, attrs } = parseSlide(slide);
        const html = marked.parse(body || "&nbsp;") as string;
        // Honour a per-slide data-background color so the thumbnail matches.
        const bgMatch = attrs.match(/data-background(?:-color)?=["']?(#[0-9a-fA-F]{3,8}|[a-z]+)["']?/);
        const bg = bgMatch ? bgMatch[1] : undefined;
        return (
          <div key={i} style={{ position: "relative", marginBottom: 12 }}>
            <div style={{ position: "absolute", top: 4, left: 6, fontSize: 10, opacity: 0.4, zIndex: 2, color: "#888" }}>
              {i + 1}
            </div>
            {/* Card: fixed thumbnail box that clips the scaled full-size stage. */}
            <div
              style={{
                width: cardW,
                height: cardW * (STAGE_H / STAGE_W),
                overflow: "hidden",
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: 6,
                background: bg ?? "var(--r-background-color, #FFFCF0)",
              }}
            >
              {/* Stage: full deck dimensions + real font size, scaled down. */}
              <div
                className="reveal"
                style={{
                  width: STAGE_W,
                  height: STAGE_H,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  ...(bg ? { ["--r-background-color" as string]: bg } : {}),
                }}
              >
                <div
                  className="slides"
                  style={{ width: "100%", height: "100%" }}
                >
                  <section
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      padding: "0 60px",
                      boxSizing: "border-box",
                    }}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
