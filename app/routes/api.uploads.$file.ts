import { existsSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { uploadsDir as UPLOAD_DIR } from "~/lib/paths.server";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pages": "application/x-iwork-pages-suitetype",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
  ".csv": "text/csv",
  ".json": "application/json",
  ".txt": "text/plain",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
};

export async function loader({ params }: { params: { file: string } }) {
  const filename = params.file;

  // Prevent directory traversal
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = join(UPLOAD_DIR, filename);
  if (!existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const ext = extname(filename).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  const data = readFileSync(filePath);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  // Prevent SVG script execution by forcing download
  if (ext === ".svg") {
    headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  }
  return new Response(data, { headers });
}
