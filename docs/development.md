---
title: Development
---

# Development Guide

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0 (runtime + package manager)
- [Node.js](https://nodejs.org/) >= 22 (WebSocket server uses `--experimental-strip-types`)

## Quick Start

```bash
git clone https://github.com/critica-tech-lab/loica.git
cd loica
bun install
bun run dev:all
```

This starts both the Vite dev server (port 4000) and the WebSocket server (port 4001). Open `http://localhost:4000`. The first user to sign up becomes admin.

No `.env` file is needed for local development — sensible defaults apply.

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev:all` | Start both dev server + WebSocket server (recommended) |
| `bun run dev` | Vite dev server only (port 4000) |
| `bun run ws` | WebSocket server only (port 4001) |
| `bun run build` | Production build (client + SSR) |
| `bun run start` | Serve production build (port 3000) |
| `bun run typecheck` | React Router typegen + tsc |

Both `dev` and `ws` must be running for real-time collaboration to work.

## Dev vs Production

| Aspect | Development | Production |
|--------|------------|------------|
| App server port | 4000 (Vite dev server) | 3000 (react-router-serve) |
| WebSocket port | 4001 | 4001 (behind reverse proxy at `/ws`) |
| Start command | `bun run dev:all` | `bun run start` + `node --experimental-strip-types ws-server.ts` |
| Hot reload | Yes (Vite HMR) | No (restart required) |
| Cookie `Secure` flag | Off | On (`NODE_ENV=production`) |
| WebSocket URL | Auto-detected (`ws://hostname:4001`) | `WS_URL` env var (`wss://domain/ws`) |
| TLS | None | Via reverse proxy (Caddy recommended) |

## Architecture

Two processes sharing one SQLite database (`app.db`):

1. **Web server** (React Router 7, SSR) — handles all HTTP requests, renders pages, processes form actions
2. **WebSocket server** (`ws-server.ts`) — Yjs CRDT sync protocol + awareness/presence

### Real-time collaboration flow

- Client connects to `ws://host:4001/{docId}`
- Auth: session cookie (checks workspace membership, shared folder access, or document share) or share token (`?token=` query param)
- Yjs CRDT sync protocol (MESSAGE_SYNC=0) + awareness/presence (MESSAGE_AWARENESS=1)
- Server loads `yjs_state` BLOB from SQLite on first connection to a room
- Debounced persistence (2s) writes `content` + `yjs_state` back to DB
- Auto-versioning every 30 minutes during active editing
- Rooms cleaned up 30s after last client disconnects (with final save + auto-version)

### Version history

- Manual saves and auto-versions (30-min intervals, room teardown)
- Preview with word-level diff (using `diff` package)
- Restore: updates DB content, clears `yjs_state`, resets ws-server room, remounts Editor via key prop

### Offline support

- `y-indexeddb` persists Yjs CRDT state to browser IndexedDB per document
- Edits while offline are buffered locally and sync on reconnect
- Connection status indicator shows connected/reconnecting/offline state

## Database

SQLite with WAL mode and foreign keys enabled. Schema is auto-created and migrated on startup in `app/lib/db.server.ts`.

### Key tables

- `users` — accounts with Argon2 password hashes
- `sessions` — server-side sessions (30-day TTL)
- `workspaces` — personal and team workspaces
- `workspace_members` — role-based membership (owner/editor/viewer)
- `documents` — Markdown content + Yjs CRDT state (BLOB)
- `folders` — nested folder tree within workspaces
- `folder_shares` / `document_shares` — sharing with users and groups
- `document_versions` — version history snapshots
- `groups` / `group_members` — user groups
- `app_settings` — instance configuration (registration open/closed, etc.)

### Schema changes

1. Add migration to the bottom of `app/lib/db.server.ts`
2. Update the `CREATE TABLE` statement for fresh installs
3. Test migration on a copy of the production database before deploying

## Extensions

Loica ships without bundled extensions. The extension system lives under `app/extensions/` so you can add your own — custom doc types (mindmaps, kanban, ...), auth providers (OIDC, SAML, OAuth), exporters (DOCX, EPUB, PDF), or capability hooks (banners, menu items).

Each extension is a TypeScript module exporting a `LoicaExtension` object that declares what it contributes (a `docType`, a `template`, an `EditorView`, `exporters`, an `authProvider`, etc). The host iterates the registry in `app/extensions/index.ts` and wires them in. Admins toggle extensions on/off from `/admin` → Extensions.

Extensions must import only from `~/extensions/sdk` (client) and `~/extensions/sdk.server` (server) — that's the stable public surface. See `app/extensions/README.md` for the full contract, when to write an extension vs editing core, and a step-by-step guide.

## Conventions

- Route actions use `intent` field for multiplexing (`create`, `delete`, `move-doc`, etc.)
- Server modules use `.server.ts` suffix (excluded from client bundle)
- Shared action handlers live in `app/lib/actions/` and receive an `ActionContext` object
- Shared view components (`TrashView`, `FavoritesView`, `RecentView`) are parameterized via callbacks
- Type-safe route params via React Router's generated `./+types/` files
- Tailwind classes for page content; inline styles for navbar elements
- Guest editors on share pages get random names: English adjective + Chilean bird in Spanish
