import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";

// Load .env into process.env (for SSR where Vite doesn't auto-load non-VITE_ vars)
try {
  const envPath = join(process.cwd(), ".env");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch { /* .env not found — that's fine */ }

const dbPath = join(process.cwd(), "app.db");

export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("auto_vacuum = INCREMENTAL");
db.pragma("wal_autocheckpoint = 1000");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -64000");
db.pragma("mmap_size = 30000000");
db.pragma("temp_store = MEMORY");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT UNIQUE NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    joined_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (workspace_id, user_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id    TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    created_by   TEXT NOT NULL REFERENCES users(id),
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by   TEXT NOT NULL REFERENCES users(id),
    title        TEXT NOT NULL DEFAULT 'Untitled',
    content      TEXT NOT NULL DEFAULT '',
    visibility   TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public_view', 'public_edit')),
    public_token TEXT UNIQUE,
    yjs_state    BLOB,
    folder_id    TEXT REFERENCES folders(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS group_members (
    group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('admin', 'member')) DEFAULT 'member',
    status    TEXT NOT NULL CHECK (status IN ('pending', 'accepted')) DEFAULT 'accepted',
    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (group_id, user_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS document_versions (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    auto        INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS folder_shares (
    id         TEXT PRIMARY KEY,
    folder_id  TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    group_id   TEXT REFERENCES groups(id) ON DELETE CASCADE,
    user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK (permission IN ('editor', 'viewer')) DEFAULT 'editor',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (folder_id, group_id, user_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS document_shares (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
    group_id    TEXT REFERENCES groups(id) ON DELETE CASCADE,
    external_email TEXT,
    permission  TEXT NOT NULL DEFAULT 'editor',
    status      TEXT NOT NULL DEFAULT 'pending',
    created_by  TEXT NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// ─── App settings helpers ─────────────────────────────────

/**
 * Typed `db.prepare` wrapper using the codebase's calling convention:
 * `<Result, Bind>` (Result first). The native better-sqlite3 signature is
 * the opposite (`<Bind, Result>`), so call sites that wrote `db.prepare<X, Y>(…)`
 * with the intuitive ordering had their generics silently swapped — TS
 * inferred row types as the bind tuple. Using `prep<…>` everywhere fixes
 * that without rewriting every call site's generic order.
 */
export function prep<
  Result = unknown,
  Bind extends unknown[] | object = unknown[],
>(source: string): Bind extends unknown[]
  ? import("better-sqlite3").Statement<Bind, Result>
  : import("better-sqlite3").Statement<[Bind], Result> {
  return db.prepare(source) as never;
}

export function getSetting(key: string): string | null {
  const row = prep<{ value: string }, [string]>(
    "SELECT value FROM app_settings WHERE key = ?"
  ).get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

// Environment overrides act as a hard floor: when an operator disables local
// login / registration via env, an admin cannot re-open it from the settings
// UI. Use DISABLE_LOCAL_LOGIN=true for an SSO-only install (no password login,
// no signup), or REGISTRATION_OPEN=false to close signups while keeping local
// login working.
export function isRegistrationOpen(): boolean {
  if (process.env.DISABLE_LOCAL_LOGIN === "true") return false;
  if (process.env.REGISTRATION_OPEN === "false") return false;
  return getSetting("registration_open") !== "false";
}

export function isLocalLoginEnabled(): boolean {
  if (process.env.DISABLE_LOCAL_LOGIN === "true") return false;
  return getSetting("local_login_enabled") !== "false";
}

/**
 * Extension activation. The DB stores a JSON array of enabled extension IDs
 * in the `enabled_extensions` setting. When the setting is absent (fresh
 * install), we return `null` so callers can apply their own default ("all
 * registered are enabled" — preserves today's behaviour). The admin UI
 * persists an explicit list once the user toggles anything.
 */
export function getEnabledExtensionIds(): string[] | null {
  const raw = getSetting("enabled_extensions");
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export function setEnabledExtensionIds(ids: string[]): void {
  setSetting("enabled_extensions", JSON.stringify(ids));
}

// Migrations for existing DBs
try { db.exec("ALTER TABLE documents ADD COLUMN yjs_state BLOB"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE documents ADD COLUMN edit_token TEXT"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("CREATE UNIQUE INDEX idx_documents_edit_token ON documents(edit_token) WHERE edit_token IS NOT NULL"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE documents ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_folders_workspace_parent ON folders(workspace_id, parent_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_documents_folder ON documents(workspace_id, folder_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("UPDATE users SET is_admin = 1 WHERE rowid = (SELECT MIN(rowid) FROM users)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_group_members_user ON group_members(user_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_folder_shares_folder ON folder_shares(folder_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_folder_shares_group ON folder_shares(group_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_folder_shares_user ON folder_shares(user_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE folder_shares ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted'"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_doc_versions_doc ON document_versions(document_id, created_at DESC)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE UNIQUE INDEX idx_folders_unique_name ON folders(workspace_id, COALESCE(parent_id, ''), name)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE group_members ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted'"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_doc_shares_doc ON document_shares(document_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_doc_shares_user ON document_shares(user_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("UPDATE app_settings SET key = 'enabled_extensions' WHERE key = 'enabled_plugins' AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'enabled_extensions')"); } catch (e) { console.error("[db migration]", e); }
try { db.exec("DELETE FROM app_settings WHERE key = 'enabled_plugins'"); } catch (e) { console.error("[db migration]", e); }
db.exec(`CREATE TABLE IF NOT EXISTS auth_links (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  sub        TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, provider)
)`);
try { db.exec("CREATE UNIQUE INDEX idx_auth_links_provider_sub ON auth_links(provider, sub)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE document_shares ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE CASCADE"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_doc_shares_group ON document_shares(group_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// ─── Trash (soft-delete) columns ─────────────────────────
try { db.exec("ALTER TABLE documents ADD COLUMN deleted_at INTEGER"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE documents ADD COLUMN deleted_by TEXT"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE folders ADD COLUMN deleted_at INTEGER"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE folders ADD COLUMN deleted_by TEXT"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_documents_deleted ON documents(deleted_by, deleted_at) WHERE deleted_at IS NOT NULL"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_folders_deleted ON folders(deleted_by, deleted_at) WHERE deleted_at IS NOT NULL"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// Fix: unique folder name index should exclude soft-deleted folders
try { db.exec("DROP INDEX IF EXISTS idx_folders_unique_name"); } catch (e) { console.error("[db migration]", e); }
try { db.exec("CREATE UNIQUE INDEX idx_folders_unique_name ON folders(workspace_id, COALESCE(parent_id, ''), name) WHERE deleted_at IS NULL"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// ─── FTS5 full-text search ───────────────────────────────
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      title, content,
      content=documents, content_rowid=rowid
    )
  `);
} catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// Triggers to keep FTS in sync
try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
    END
  `);
} catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, title, content) VALUES('delete', OLD.rowid, OLD.title, OLD.content);
    END
  `);
} catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, title, content) VALUES('delete', OLD.rowid, OLD.title, OLD.content);
      INSERT INTO documents_fts(rowid, title, content) VALUES (NEW.rowid, NEW.title, NEW.content);
    END
  `);
} catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// Populate FTS index from existing data
try { db.exec("INSERT INTO documents_fts(documents_fts) VALUES('rebuild')"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// ─── Comments ─────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    thread_id   TEXT REFERENCES comments(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    body        TEXT NOT NULL DEFAULT '',
    anchor_from TEXT,
    anchor_to   TEXT,
    anchor_text TEXT,
    resolved    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

try { db.exec("CREATE INDEX idx_comments_doc ON comments(document_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_comments_thread ON comments(thread_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_folder_shares_user_status ON folder_shares(user_id, status)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_folder_shares_folder_status ON folder_shares(folder_id, status)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_doc_shares_user_status ON document_shares(user_id, status)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_group_members_user_status ON group_members(user_id, status)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE documents ADD COLUMN comments_migrated INTEGER NOT NULL DEFAULT 0"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }

// ─── updated_by tracking ─────────────────────────────────
try { db.exec("ALTER TABLE documents ADD COLUMN updated_by TEXT"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }

// ─── Teamspace migrations ────────────────────────────────

// 1a. Add type column to workspaces
try { db.exec("ALTER TABLE workspaces ADD COLUMN type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'team'))"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }

// 1b. Add workspace_id column to groups
try { db.exec("ALTER TABLE groups ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("CREATE UNIQUE INDEX idx_groups_workspace ON groups(workspace_id) WHERE workspace_id IS NOT NULL"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// 1c. Add 'admin' role to workspace_members CHECK constraint
// SQLite doesn't allow ALTER CHECK, so recreate the table atomically.
{
  // Recovery: if a previous migration was interrupted after DROP but before RENAME,
  // workspace_members_new exists but workspace_members doesn't — finish the rename.
  const hasNew = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='workspace_members_new'").get();
  const hasOld = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='workspace_members'").get();
  if (hasNew && !hasOld) {
    console.warn("[db migration 1c] Recovering interrupted migration — renaming workspace_members_new");
    db.exec("ALTER TABLE workspace_members_new RENAME TO workspace_members");
  } else if (hasNew) {
    // Leftover from some other partial run — drop the stale temp table
    db.exec("DROP TABLE workspace_members_new");
  }

  // Check if 'admin' is already in the CHECK constraint via schema inspection
  const schemaRow = prep<{ sql: string }, []>(
    "SELECT sql FROM sqlite_schema WHERE type='table' AND name='workspace_members'"
  ).get();
  const hasAdminRole = schemaRow?.sql?.includes("'admin'");

  if (!hasAdminRole) {
    // Wrap in a transaction so the table is never absent if the process is killed
    const doMigrate = db.transaction(() => {
      db.exec(`CREATE TABLE workspace_members_new (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role         TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'admin', 'viewer')),
        joined_at    INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (workspace_id, user_id)
      )`);
      db.exec(`INSERT INTO workspace_members_new SELECT * FROM workspace_members`);
      db.exec(`DROP TABLE workspace_members`);
      db.exec(`ALTER TABLE workspace_members_new RENAME TO workspace_members`);
    });
    try {
      doMigrate();
    } catch (e) {
      console.error("[db migration 1c]", e);
    }
  }
}

// ─── Performance indexes ─────────────────────────────────
try { db.exec("CREATE INDEX idx_sessions_user_id ON sessions(user_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_sessions_expires_at ON sessions(expires_at)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_documents_workspace_id ON documents(workspace_id)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_documents_workspace_deleted ON documents(workspace_id, deleted_at)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_documents_updated_at ON documents(workspace_id, updated_at DESC) WHERE deleted_at IS NULL"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_documents_created_by ON documents(created_by) WHERE deleted_at IS NULL"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// ─── Workspace icon ──────────────────────────────────────
try { db.exec("ALTER TABLE workspaces ADD COLUMN icon TEXT"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }

// ─── PDF documents ───────────────────────────────────────
try { db.exec("ALTER TABLE documents ADD COLUMN pdf_file TEXT"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }

// ─── Rename personal workspaces to "My documents" ───────
try {
  db.exec(`UPDATE workspaces SET name = 'My documents' WHERE type = 'personal' AND name LIKE '%''s workspace'`);
} catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// ─── User stars ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS user_stars (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, document_id)
  )
`);

// ─── User recent docs ───────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS user_recent_docs (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    viewed_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, document_id)
  )
`);

// ─── Teamspace data migration ────────────────────────────
// For each group that has group folder_shares and doesn't yet have a workspace,
// create a team workspace and migrate the shared folder tree.
{
  function toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
  }

  function uniqueSlugForMigration(base: string): string {
    let slug = base || "teamspace";
    let attempt = 0;
    while (true) {
      const candidate = attempt === 0 ? slug : `${slug}-${attempt}`;
      const existing = db
        .prepare("SELECT id FROM workspaces WHERE slug = ?")
        .get(candidate) as { id: string } | undefined;
      if (!existing) return candidate;
      attempt++;
    }
  }

  const groupFolderShares = db.prepare(`
    SELECT DISTINCT fs.group_id, fs.folder_id, g.name as group_name, g.created_by
    FROM folder_shares fs
    JOIN groups g ON g.id = fs.group_id
    WHERE g.workspace_id IS NULL
      AND fs.group_id IS NOT NULL
      AND fs.status = 'accepted'
  `).all() as Array<{ group_id: string; folder_id: string; group_name: string; created_by: string }>;

  for (const share of groupFolderShares) {
    db.transaction(() => {
      // 1. Create team workspace
      const wsId = nanoid(16);
      const slug = uniqueSlugForMigration(toSlug(share.group_name));
      db.prepare(
        "INSERT INTO workspaces (id, name, slug, created_by, type) VALUES (?, ?, ?, ?, 'team')"
      ).run(wsId, share.group_name, slug, share.created_by);

      // 2. Link group to workspace
      db.prepare("UPDATE groups SET workspace_id = ? WHERE id = ?")
        .run(wsId, share.group_id);

      // 3. Move folder tree to new workspace
      const descendantFolders = db.prepare(`
        WITH RECURSIVE tree(id) AS (
          SELECT id FROM folders WHERE id = ?
          UNION ALL
          SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
        )
        SELECT id FROM tree
      `).all(share.folder_id) as Array<{ id: string }>;

      const folderIds = descendantFolders.map(r => r.id);
      if (folderIds.length > 0) {
        const placeholders = folderIds.map(() => "?").join(",");
        db.prepare(`UPDATE folders SET workspace_id = ? WHERE id IN (${placeholders})`)
          .run(wsId, ...folderIds);
        db.prepare(`UPDATE documents SET workspace_id = ? WHERE folder_id IN (${placeholders})`)
          .run(wsId, ...folderIds);
      }

      // 4. Add group members as workspace_members
      const members = db.prepare(
        "SELECT user_id, role FROM group_members WHERE group_id = ? AND status = 'accepted'"
      ).all(share.group_id) as Array<{ user_id: string; role: string }>;

      for (const m of members) {
        const wsRole = m.role === "admin" ? "admin" : "editor";
        db.prepare(
          "INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)"
        ).run(wsId, m.user_id, wsRole);
      }

      // 5. Remove the group folder_share (access now via workspace_members)
      db.prepare("DELETE FROM folder_shares WHERE folder_id = ? AND group_id = ?")
        .run(share.folder_id, share.group_id);

      // 6. Flatten: move the shared folder's contents to root, then delete the folder
      db.prepare("UPDATE documents SET folder_id = NULL WHERE folder_id = ?")
        .run(share.folder_id);
      db.prepare("UPDATE folders SET parent_id = NULL WHERE parent_id = ?")
        .run(share.folder_id);
      db.prepare("DELETE FROM folders WHERE id = ?")
        .run(share.folder_id);
    })();
  }
}

// ─── Notifications ───────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    link       TEXT,
    read_at    INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

try { db.exec("CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// ─── External email shares ───────────────────────────────
try { db.exec("ALTER TABLE document_shares ADD COLUMN external_email TEXT"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }

// Recreate document_shares to fix UNIQUE constraint — old constraint was
// UNIQUE(document_id, user_id) which breaks when the same user shares a doc
// with multiple external emails. New constraints: UNIQUE(document_id, user_id)
// only when external_email IS NULL, enforced via unique indexes instead.
{
  const needsMigration = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='document_shares'"
  ).get() as { sql: string } | undefined;
  if (needsMigration?.sql?.includes("UNIQUE (document_id, user_id)")) {
    db.exec(`
      CREATE TABLE document_shares_new (
        id          TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
        group_id    TEXT REFERENCES groups(id) ON DELETE CASCADE,
        external_email TEXT,
        permission  TEXT NOT NULL DEFAULT 'editor',
        status      TEXT NOT NULL DEFAULT 'pending',
        created_by  TEXT NOT NULL REFERENCES users(id),
        created_at  INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO document_shares_new SELECT id, document_id, user_id, group_id, external_email, permission, status, created_by, created_at FROM document_shares;
      DROP TABLE document_shares;
      ALTER TABLE document_shares_new RENAME TO document_shares;
      CREATE UNIQUE INDEX idx_doc_shares_user_doc ON document_shares(document_id, user_id) WHERE external_email IS NULL AND group_id IS NULL;
      CREATE UNIQUE INDEX idx_doc_shares_external ON document_shares(document_id, external_email) WHERE external_email IS NOT NULL;
      CREATE INDEX idx_doc_shares_doc ON document_shares(document_id);
      CREATE INDEX idx_doc_shares_user ON document_shares(user_id);
      CREATE INDEX idx_doc_shares_group ON document_shares(group_id);
      CREATE INDEX idx_doc_shares_user_status ON document_shares(user_id, status);
    `);
  }
}

// ─── Client error log ────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS client_errors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
    message    TEXT NOT NULL,
    stack      TEXT,
    url        TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);
try { db.exec("CREATE INDEX idx_client_errors_created ON client_errors(created_at DESC)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

// ─── Server error log ────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS server_errors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT NOT NULL DEFAULT 'uncaught', -- 'uncaught', 'migration', 'loader', 'action'
    message    TEXT NOT NULL,
    stack      TEXT,
    url        TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);
try { db.exec("CREATE INDEX idx_server_errors_created ON server_errors(created_at DESC)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }

const stmtInsertServerError = db.prepare(
  "INSERT INTO server_errors (source, message, stack, url) VALUES (?, ?, ?, ?)"
);

export function logServerError(source: string, error: unknown, url?: string) {
  try {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? null) : null;
    stmtInsertServerError.run(source, msg.slice(0, 2000), stack ? stack.slice(0, 5000) : null, url ?? null);
  } catch {
    // never throw from an error logger
  }
}

// Swallow EPIPE on stdout/stderr so a closed log pipe doesn't escalate to
// uncaughtException — otherwise the handler below would write to the same
// broken pipe, retrigger itself, and fill server_errors in a tight loop.
process.stdout.on("error", (err: NodeJS.ErrnoException) => { if (err.code !== "EPIPE") throw err; });
process.stderr.on("error", (err: NodeJS.ErrnoException) => { if (err.code !== "EPIPE") throw err; });

function isEpipe(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as NodeJS.ErrnoException).code === "EPIPE";
}

// Capture process-level crashes so they appear in the admin panel
process.on("uncaughtException", (err) => {
  if (isEpipe(err)) return;
  console.error("[uncaughtException]", err);
  logServerError("uncaught", err);
});
process.on("unhandledRejection", (reason) => {
  if (isEpipe(reason)) return;
  console.error("[unhandledRejection]", reason);
  logServerError("uncaught", reason instanceof Error ? reason : new Error(String(reason)));
});

// ─── Clean up redundant teamspace doc shares ─────────────
// Remove document_shares where the target user is already a member of the
// team workspace that owns the document (share record is redundant).
db.exec(`
  DELETE FROM document_shares
  WHERE id IN (
    SELECT ds.id
    FROM document_shares ds
    JOIN documents d ON d.id = ds.document_id
    JOIN workspaces w ON w.id = d.workspace_id
    JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ds.user_id
    WHERE w.type = 'team' AND ds.user_id IS NOT NULL
  )
`);

// ─── Expiring and password-protected public shares ───────
try { db.exec("ALTER TABLE documents ADD COLUMN share_expires_at INTEGER"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("ALTER TABLE documents ADD COLUMN share_password_hash TEXT"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }

// ─── Per-invite tokens for external shares ───────────────
try { db.exec("ALTER TABLE document_shares ADD COLUMN token TEXT"); } catch (e) { if (!String(e).includes("already exists") && !String(e).includes("duplicate column")) console.error("[db migration]", e); }
try { db.exec("CREATE UNIQUE INDEX idx_doc_shares_token ON document_shares(token) WHERE token IS NOT NULL"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }


// ─── Yjs update log (Path B history) ────────────────────
try { db.exec(`CREATE TABLE IF NOT EXISTS document_updates (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     TEXT,
  user_name   TEXT,
  yjs_update  BLOB NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
)`); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
try { db.exec("CREATE INDEX IF NOT EXISTS idx_doc_updates ON document_updates(document_id, created_at DESC)"); } catch (e) { if (!String(e).includes("already exists")) console.error("[db migration]", e); }
