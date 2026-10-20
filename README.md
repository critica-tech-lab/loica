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

Loica runs on [React Router 8](https://reactrouter.com/) with a [ProseMirror](https://prosemirror.net/) editor and [Yjs](https://yjs.dev/) for the real-time sync. It runs as two [Node.js](https://nodejs.org/) processes, the web app and a WebSocket server, sharing one SQLite database ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)). Passwords are hashed with Argon2. [Bun](https://bun.sh/) is the package manager and test runner.

## Quick start (development)

You'll need [Bun](https://bun.sh/) (≥ 1.0) and [Node.js](https://nodejs.org/) (≥ 24).

```sh
git clone https://github.com/critica-tech-lab/loica.git
cd loica
bun install
bun run dev:all
```

Open <http://localhost:4000>. The first account to sign up becomes the admin.

The optional LanguageTool, AI proofreader and translation extensions are git submodules under `app/extensions/`; Loica builds and runs without them. Their URLs use SSH, so fetching them needs a GitHub SSH key. Without one, have git use HTTPS for GitHub instead:

```sh
git config --global url."https://github.com/".insteadOf git@github.com:
git submodule update --init
```

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
| `SITE_URL` | no | Public base URL, used in email links and to detect a reverse proxy |
| `WS_URL` | no | WebSocket URL as seen by the browser, e.g. `wss://your-domain.com/ws`. When unset it is derived: `wss://<host><WS_PATH>` behind a proxy, `ws://<host>:<WS_PORT>` otherwise |
| `WS_PATH` | no | Path the reverse proxy routes to the WS server (default `/ws`) |
| `WS_PORT` | no | WebSocket server port (default `4001`) |
| `WS_HOST` | no | WebSocket bind address (default `127.0.0.1` in production, `0.0.0.0` in dev) |
| `WS_ADMIN_PORT` | no | Loopback-only port the app uses to notify the WS server (default `WS_PORT + 1`) |
| `ALLOWED_ORIGINS` | no | Comma-separated allowed origins for the WS server (default: derived from `WS_URL`) |
| `TRUST_PROXY_HOPS` | no | Reverse proxies in front of Loica whose `X-Forwarded-For` is trusted for rate limiting (default `0`). Set it behind a proxy, or all clients share one IP-based limit |
| `DATA_DIR` | no | Where the database, uploads and plugins live (default: the working directory) |
| `WORKSPACE_STORAGE_QUOTA_BYTES` | no | Upload and import quota per workspace (default 5 GB) |
| `DISABLE_LOCAL_LOGIN` | no | Set to `true` for an SSO-only install: hides the password login and signup |
| `REGISTRATION_OPEN` | no | Set to `false` to close signups while keeping password login |
| `EMAIL_FROM` | no | From address for outbound email, whichever transport sends it |
| `SMTP_HOST` | no | Send email over SMTP. Takes priority over Mailgun |
| `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | no | SMTP port (default `587`) and credentials |
| `SMTP_SECURE` | no | `true` for implicit TLS (automatic on port 465) |
| `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` | no | Send email through the Mailgun API instead. With neither SMTP nor Mailgun set, mail is logged to the console |
| `MAILGUN_REGION` | no | `eu` or omit for US |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | no | Single sign-on through any OpenID Connect provider. Also enable the `oidc` extension in the admin panel |
| `OIDC_SCOPES` / `OIDC_LABEL` | no | Requested scopes (default `openid email profile`) and login button label |

Extensions read their own variables (`LANGUAGETOOL_URL`, `OLLAMA_*`); see each extension's README. [`.env.example`](.env.example) has every variable with comments.

See the [deployment guide](https://critica-tech-lab.github.io/loica/deployment) for the full production setup (reverse proxy, systemd services, backups). Run `bash setup.sh` from the project directory for an interactive setup on Linux.

## Extensions

Presentations are built in. Everything else is an extension that ships turned off, and an admin enables it under **Admin → Extensions**:

| Extension | What it does | Needs |
| --- | --- | --- |
| `oidc` | Single sign-on through any OpenID Connect provider | `OIDC_*` variables |
| [`languagetool`](https://github.com/critica-tech-lab/loica-extension-languagetool) | Grammar and spelling underlines as you type | A LanguageTool server |
| [`ai-proofreader`](https://github.com/critica-tech-lab/loica-extension-ai-proofreader) | Rewrites a selected passage, with each change shown as a suggestion | Ollama |
| [`translation`](https://github.com/critica-tech-lab/loica-extension-translation) | Translates a selected passage in a popover | Ollama |

To write your own, create `app/extensions/<name>/index.ts` with an `export default` of a `LoicaExtension`. It is discovered at build time, with no registry edit. Drop-in plugins can also be added at runtime under [`plugins/`](plugins/README.md). See [`app/extensions/README.md`](app/extensions/README.md) for the full contract: `docType`, `template`, `EditorView`, `EditorBanner`, `getDocMenuItems`, `editorPlugins`, `selectionMenuItems`, `exporters.pdf` / `.docx`, `previewHtml`, `authProvider`.

## Security audits

Dependencies are checked with `bun audit` (`bun.lock` is the source of truth — `package-lock.json`, if present, is gitignored and not used for installs).

```sh
bun audit               # list vulnerabilities
bun update               # apply compatible-range fixes
bun update --latest       # apply all fixes, including breaking major bumps
```

Run `bun audit` before releases and periodically in between. After `bun update --latest`, re-test the app before shipping — major bumps can break behavior. [Dependabot](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/dependabot-quickstart) is configured in [`.github/dependabot.yml`](.github/dependabot.yml) to open weekly PRs for outdated npm and GitHub Actions dependencies.

## License

[AGPL-3.0](LICENSE). If you run a modified version on a server, you have to offer your users access to the source.

## Name

Named after the [Loica](https://en.wikipedia.org/wiki/Long-tailed_meadowlark), a Chilean meadowlark with a vivid scarlet breast.
