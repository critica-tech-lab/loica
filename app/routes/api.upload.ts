import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { getSessionUser } from "~/lib/auth.server";
import { uploadsDir as UPLOAD_DIR } from "~/lib/paths.server";
import { getRateLimitKey, checkRateLimit } from "~/lib/rate-limit.server";
import { MAX_UPLOAD_FILE_BYTES } from "~/lib/document.server";
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
};

export async function action({ request }: { request: Request }) {
  const user = getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const rl = checkRateLimit(getRateLimitKey(request, user.id), { windowMs: 5 * 60 * 1000, max: 30, prefix: "upload" });
  if (!rl.allowed) {
    return new Response("Too many uploads. Try again later.", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSeconds) },
    });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return new Response("Expected multipart/form-data", { status: 400 });
  }

  // Reject an oversized body before buffering the whole multipart payload —
  // Content-Length covers the multipart envelope too, so it's a slight
  // overestimate of the file's own size, but still catches the obvious case
  // without reading anything off the wire.
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_FILE_BYTES) {
    return new Response(`File too large (max ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)}MB)`, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return new Response("Missing file", { status: 400 });
  }

  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    return new Response(`File too large (max ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)}MB)`, { status: 400 });
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return new Response(`Unsupported file type: ${file.type}`, { status: 400 });
  }

  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  const filename = `${nanoid(16)}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(UPLOAD_DIR, filename), buffer);

  return Response.json({ url: `/api/uploads/${filename}` });
}
