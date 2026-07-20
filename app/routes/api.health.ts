import fs from "node:fs";
import { execSync } from "node:child_process";
import { db } from "~/lib/db.server";
import { dbPath as DB_PATH } from "~/lib/paths.server";
import { requireAdmin } from "~/lib/auth.server";
import type { LoaderFunctionArgs } from "react-router";

const startTime = Date.now();

function getFileSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function getDiskFree(): { available: number; total: number; percent: number } | null {
  try {
    // Works on both macOS and Linux
    const output = execSync("df -k .", { encoding: "utf8", timeout: 5000 });
    const lines = output.trim().split("\n");
    const parts = lines[1].split(/\s+/);
    // df -k columns: Filesystem 1K-blocks Used Available Capacity Mounted
    const total = parseInt(parts[1], 10) * 1024;
    const available = parseInt(parts[3], 10) * 1024;
    const percent = Math.round(((total - available) / total) * 100);
    return { available, total, percent };
  } catch {
    return null;
  }
}

// Detailed infra metrics (db/WAL size, disk free/used, uptime) are admin-only:
// they are reconnaissance for an attacker and were previously served to anyone.
// Liveness monitors want /api/healthz, which is unauthenticated by design and
// carries none of this — the client-side server-down poll uses that one.
export function loader({ request }: LoaderFunctionArgs) {
  requireAdmin(request);

  let dbOk = false;
  let walMode = false;
  try {
    db.prepare("SELECT 1").get();
    dbOk = true;
    const journalMode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string } | undefined;
    walMode = journalMode?.journal_mode === "wal";
  } catch {
    // db unreachable
  }

  const dbSize = getFileSize(DB_PATH);
  const walSize = getFileSize(DB_PATH + "-wal");
  const shmSize = getFileSize(DB_PATH + "-shm");
  const disk = getDiskFree();

  const status = dbOk ? "ok" : "error";
  const code = dbOk ? 200 : 503;

  // Warn if WAL file is over 50MB or disk usage is over 90%
  const warnings: string[] = [];
  if (walSize && walSize > 50 * 1024 * 1024) {
    warnings.push(`WAL file is large (${Math.round(walSize / 1024 / 1024)}MB) — consider checkpointing`);
  }
  if (disk && disk.percent > 90) {
    warnings.push(`Disk usage is high (${disk.percent}%) — free up space`);
  }

  return new Response(
    JSON.stringify({
      status: warnings.length > 0 ? "warn" : status,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      db: {
        connected: dbOk,
        walMode,
        sizeBytes: dbSize,
        walSizeBytes: walSize,
        shmSizeBytes: shmSize,
      },
      disk: disk
        ? {
            availableBytes: disk.available,
            totalBytes: disk.total,
            usedPercent: disk.percent,
          }
        : null,
      warnings,
    }),
    {
      status: code,
      headers: { "Content-Type": "application/json" },
    }
  );
}
