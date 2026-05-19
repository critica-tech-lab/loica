# Loica

A self-hosted, real-time collaborative Markdown editor.

Sign in, create workspaces, write together, and share documents. Edits sync live across browsers via Yjs. Optional features ship as extensions you can toggle from the admin panel.

📖 **Documentation:** [critica-tech-lab.github.io/loica](https://critica-tech-lab.github.io/loica/)

## Features

- Real-time collaborative editing with live cursors and presence
- Personal and team workspaces with role-based permissions
- Folders, drag-and-drop, version history with diff view
- Public share links and per-document sharing with users or groups
- Markdown preview and download
- Extensible architecture for adding custom doc types, auth providers, and exporters

## Quick start (development)

You'll need [Bun](https://bun.sh/) (≥ 1.0) and [Node.js](https://nodejs.org/) (≥ 24).

```sh
git clone https://github.com/critica-tech-lab/loica.git
cd loica
bun install
bun run dev:all
```

Open <http://localhost:4000> — the first user to sign up becomes the admin.

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
| `MAILGUN_API_KEY` | no | Outbound email — falls back to console logs without it |
| `MAILGUN_DOMAIN` | no | Mailgun sending domain |
| `MAILGUN_FROM` | no | From address |
| `MAILGUN_REGION` | no | `eu` or omit for US |

See the [deployment guide](https://critica-tech-lab.github.io/loica/deployment) for the full production setup (reverse proxy, systemd services, backups). Run `bash deploy.sh` from the project directory for an interactive setup on Linux.

## Extensions

The public registry ships with no extensions enabled. To add your own, create a folder under [`app/extensions/`](app/extensions) and register it with two lines in `app/extensions/index.ts` (and `index.server.ts` for server-only code). See [`app/extensions/README.md`](app/extensions/README.md) for the full contract — `docType`, `template`, `EditorView`, `EditorBanner`, `getDocMenuItems`, `exporters.pdf` / `.docx`, `previewHtml`, `authProvider`.

## License

[AGPL-3.0](LICENSE) — if you run a modified version on a server, you must offer your users access to the source.

## Name

Named after the [Loica](https://en.wikipedia.org/wiki/Long-tailed_meadowlark), a Chilean meadowlark with a vivid scarlet breast.
