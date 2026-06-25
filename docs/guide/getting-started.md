---
title: Getting Started
---

# Getting Started

## Prerequisites

| Dependency | Version | Notes |
|-----------|---------|-------|
| [Bun](https://bun.sh/) | >= 1.0 | Runtime + package manager |
| [Node.js](https://nodejs.org/) | >= 24 | Runs the WebSocket server (executes `ws-server.ts` directly via native TypeScript support) |

SQLite3, PM2, and Litestream are only needed for production — see the [Deployment guide](/deployment).

## Clone and Install

```bash
git clone https://github.com/critica-tech-lab/loica.git
cd loica
bun install
```

## Start Development

```bash
bun run dev:all
```

This starts both the Vite dev server (port 4000) and the WebSocket server (port 4001). Open `http://localhost:4000`.

No `.env` file is needed for local development — sensible defaults apply (no HTTPS cookies, WebSocket binds to `0.0.0.0`, no backups).

## First User

The first person to sign up is automatically promoted to **admin** and gets a personal workspace. Open `http://localhost:4000/signup` to create your account.

## What's Running

| Process | Port | Description |
|---------|------|-------------|
| Vite dev server | 4000 | React Router SSR with HMR |
| WebSocket server | 4001 | Yjs real-time sync + presence |

Both must be running for real-time collaboration to work.

## Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev:all` | Start both dev server + WebSocket server (recommended) |
| `bun run dev` | Vite dev server only (port 4000) |
| `bun run ws` | WebSocket server only (port 4001) |
| `bun run build` | Production build (client + SSR) |
| `bun run start` | Serve production build (port 3000) |
| `bun run typecheck` | React Router typegen + tsc |

## Environment Variables

For local development, you generally don't need a `.env` file. If you're running the production build locally, create one:

```bash
cp .env.example .env
```

Key overrides for local production mode:

| Variable | Value | Why |
|----------|-------|-----|
| `SECURE_COOKIE` | `false` | Required for HTTP (no HTTPS locally) |
| `WS_HOST` | `0.0.0.0` | macOS resolves `localhost` to IPv6 (`::1`), but production binds to `127.0.0.1` |

See the [Deployment guide](/deployment#environment-variables) for the full variable reference.

## Project Structure

```
app/
├── root.tsx              # Root layout, session loader, error boundary
├── routes/               # Route modules (auth, workspace, teamspace, sharing, admin, API)
├── lib/                  # Server modules (.server.ts): DB, auth, CRUD, sharing
│   └── actions/          # Shared route action handlers
├── components/           # React components, hooks, drag & drop system
└── extensions/           # Extension system — empty by default; add your own
    └── README.md         # Extension contract — read this to add new extensions
ws-server.ts              # Standalone Yjs WebSocket server
ecosystem.config.cjs      # PM2 process configuration
```

Backups, replication, monitoring, and other operational tooling are
deliberately out of scope — wire them up the way your platform expects.

## Next Steps

- Read the [Features guide](/guide/features) for a complete walkthrough of what Loica can do
- See [Deployment](/deployment) when you're ready to put it in production
- Check [Development](/development) for architecture details and conventions
