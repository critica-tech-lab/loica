import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { resolveUploadPath, uploadsDir } from "~/lib/paths.server";

// Guards the one thing every upload-embedding exporter depends on for
// safety: this session's WeasyPrint SSRF/LFI fix (presentations PDF export)
// and the core pdfmake/docx exporter both resolve image src through this
// function instead of duplicating the traversal check themselves.
describe("resolveUploadPath", () => {
  test("resolves a well-formed /api/uploads/<file> reference", () => {
    expect(resolveUploadPath("/api/uploads/abc123.png")).toBe(join(uploadsDir, "abc123.png"));
  });

  test("rejects a bare '..' filename (parent-dir escape)", () => {
    expect(resolveUploadPath("/api/uploads/..")).toBeNull();
  });

  test("rejects a path-traversal filename", () => {
    expect(resolveUploadPath("/api/uploads/../../etc/passwd")).toBeNull();
  });

  test("rejects an absolute filesystem path smuggled as the filename", () => {
    expect(resolveUploadPath("/api/uploads//etc/passwd")).toBeNull();
  });

  test("rejects a remote URL (the SSRF vector)", () => {
    expect(resolveUploadPath("http://169.254.169.254/latest/meta-data/")).toBeNull();
  });

  test("rejects a file:// URL (the LFI vector)", () => {
    expect(resolveUploadPath("file:///etc/hostname")).toBeNull();
  });

  test("rejects a reference outside the /api/uploads/ prefix", () => {
    expect(resolveUploadPath("/etc/passwd")).toBeNull();
  });

  test("rejects an empty string", () => {
    expect(resolveUploadPath("")).toBeNull();
  });
});
