# Loica

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/critica-tech-lab/loica)](https://github.com/critica-tech-lab/loica/commits)

Loica is a self-hosted Markdown editor for writing together in real time.

Sign in, create a workspace, and edit documents with your team. Changes sync live between browsers using Yjs. Anything beyond the basics ships as an optional extension you turn on from the admin panel.

<!-- TODO: add screenshot at docs/public/screenshot.png — editor with live cursors + Markdown preview -->

Docs are at [critica-tech-lab.github.io/loica](https://critica-tech-lab.github.io/loica/). Found a bug or have a question? [Open an issue](https://github.com/critica-tech-lab/loica/issues).

## Features

- Real-time collaborative editing with live cursors and presence
- Personal and team workspaces with role-based permissions
- Folders, drag-and-drop, version history with diff view
- Public share links and per-document sharing with users or groups
- Markdown preview and download
- Extensible architecture for adding custom doc types, auth providers, and exporters

## Built with

Loica runs on [React Router 7](https://reactrouter.com/) with a [ProseMirror](https://prosemirror.net/) editor and [Yjs](https://yjs.dev/) for the real-time sync. The server is [Bun](https://bun.sh/) with SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) for storage, and passwords are hashed with Argon2.

## Quick start (development)

You'll need [Bun](https://bun.sh/) (≥ 1.0) and [Node.js](https://nodejs.org/) (≥ 24).

```sh
git clone https://github.com/critica-tech-lab/loica.git
cd loica
bun install
bun run dev:all
```

Open <http://localhost:4000>. The first account to sign up becomes the admin.

## Production

Copy the env template and fill in your values:

```sh
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | yes | Set to `production` |
| `PORT` | yes | HTTP port for the app server (default `3000`) |
| `SECURE_COOKIE` | yes | Set to `true` behind HTTPS |
| `WS_URL` | yes | WebSocket URL as seen by the browser, e.g. `wss://your-domain.com/ws` |
| `WS_PORT` | no | WebSocket server port (default `4001`) |
| `WS_HOST` | no | WebSocket bind address (default `127.0.0.1`) |
| `ALLOWED_ORIGINS` | no | Comma-separated allowed origins for the WS server |
| `SITE_URL` | no | Public base URL, used in email links |
| `DISABLE_LOCAL_LOGIN` | no | Set to `true` for an SSO-only install: hides the password login and signup |
| `REGISTRATION_OPEN` | no | Set to `false` to close signups while keeping password login |
| `MAILGUN_API_KEY` | no | Outbound email. Without it, mail is logged to the console |
| `MAILGUN_DOMAIN` | no | Mailgun sending domain |
| `MAILGUN_FROM` | no | From address |
| `MAILGUN_REGION` | no | `eu` or omit for US |

See the [deployment guide](https://critica-tech-lab.github.io/loica/deployment) for the full production setup (reverse proxy, systemd services, backups). Run `bash setup.sh` from the project directory for an interactive setup on Linux.

## Extensions

The public registry ships with no extensions enabled. To add your own, create a folder under [`app/extensions/`](app/extensions) and register it with two lines in `app/extensions/index.ts` (and `index.server.ts` for server-only code). See [`app/extensions/README.md`](app/extensions/README.md) for the full contract: `docType`, `template`, `EditorView`, `EditorBanner`, `getDocMenuItems`, `exporters.pdf` / `.docx`, `previewHtml`, `authProvider`.

## License

[AGPL-3.0](LICENSE). If you run a modified version on a server, you have to offer your users access to the source.

## Name

Named after the [Loica](https://en.wikipedia.org/wiki/Long-tailed_meadowlark), a Chilean meadowlark with a vivid scarlet breast.
