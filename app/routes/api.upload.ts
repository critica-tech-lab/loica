import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { getSessionUser } from "~/lib/auth.server";
import { uploadsDir as UPLOAD_DIR } from "~/lib/paths.server";
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB
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

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return new Response("Expected multipart/form-data", { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return new Response("Missing file", { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return new Response("File too large (max 10MB)", { status: 400 });
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
  writeFileSync(join(UPLOAD_DIR, filename), buffer);

  return Response.json({ url: `/api/uploads/${filename}` });
}
