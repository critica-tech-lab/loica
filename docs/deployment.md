---
title: Deployment
---

## Overview

Loica runs two processes:

1. **Web server** — React Router SSR app (port 3000)
2. **WebSocket server** — Yjs real-time collaboration (port 4001)

Both share the same SQLite database (`app.db`). Both must be running for the app to function fully.

## Prerequisites

- **Node.js 24+**
- **Bun** (package manager and script runner)
- A **reverse proxy** (Caddy recommended, or nginx) for TLS termination
- A **domain name** pointed at your server's public IP

## Automated Setup

Use the setup script — it handles both Linux and macOS:

```bash
git clone https://github.com/critica-tech-lab/loica.git /srv/loica
cd /srv/loica
chmod +x setup.sh
./setup.sh
```

The script is interactive and walks you through the setup. Afterwards, edit `.env` with your domain:

```env
NODE_ENV=production
WS_URL=wss://your-domain.com/ws
```

## Step-by-Step Deployment (Linux)

### 1. DNS

Create an A record pointing your domain to your server's public IP.

### 2. Install Caddy (reverse proxy with auto-SSL)

```bash
# Debian/Ubuntu
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 3. Configure Caddy

```bash
sudo tee /etc/caddy/Caddyfile << 'EOF'
your-domain.com {
    handle_path /ws/* {
        reverse_proxy localhost:4001
    }
    handle {
        reverse_proxy localhost:3000
    }
}
EOF

sudo systemctl restart caddy
```

Caddy automatically obtains a Let's Encrypt TLS certificate.

### 4. Create systemd services

**App server** (`/etc/systemd/system/loica.service`):

```ini
[Unit]
Description=Loica App Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/srv/loica
EnvironmentFile=/srv/loica/.env
ExecStart=/path/to/bun run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**WebSocket server** (`/etc/systemd/system/loica-ws.service`):

```ini
[Unit]
Description=Loica WebSocket Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/srv/loica
EnvironmentFile=/srv/loica/.env
ExecStart=/usr/bin/node ws-server.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> **Note:** The WebSocket server must use `node`, not `bun` — `better-sqlite3` requires native Node.js bindings and is not supported in Bun's runtime.

### 5. Start everything

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now loica loica-ws
```

### 6. Open firewall ports

```bash
sudo ufw allow 80
sudo ufw allow 443
```

### 7. First user

Open `https://your-domain.com/signup` in your browser. The first user to sign up is automatically promoted to admin.

## Alternative: PM2 (local development)

For local development on macOS, you can use PM2 with the included `ecosystem.config.cjs`:

```bash
pm2 start ecosystem.config.cjs
```

This starts the web server and WebSocket server. PM2 is **not recommended for production** on Linux — use systemd instead.

## Environment Variables

Create `.env` from the example:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | Yes | — | Set to `production` for secure cookies |
| `PORT` | No | `3000` | Web server port |
| `WS_PORT` | No | `4001` | WebSocket server port |
| `WS_URL` | Production | Auto-detect | Public WebSocket URL (`wss://your-domain.com/ws`) |
| `WS_HOST` | No | `127.0.0.1` (prod) / `0.0.0.0` (dev) | WebSocket bind address |
| `SECURE_COOKIE` | No | `true` in prod | Set `false` for local HTTP |
| `ALLOWED_ORIGINS` | No | Derived from `WS_URL` | Comma-separated allowed origins |
| `SITE_URL` | No | Auto-detect | Public base URL, used to build links in outbound email |
| `DISABLE_LOCAL_LOGIN` | No | `false` | `true` for an SSO-only install: hides the password login form and signup |
| `REGISTRATION_OPEN` | No | `true` | `false` closes signups while keeping password login enabled |
| `MAILGUN_API_KEY` | No | — | Mailgun API key (emails are logged without this) |
| `MAILGUN_DOMAIN` | No | — | Mailgun sending domain |
| `MAILGUN_FROM` | No | — | From address for emails |
| `MAILGUN_REGION` | No | `eu` | `eu` or `us` |

## SSO / Auth providers

Loica ships with email + password auth only. To add OIDC, OAuth, SAML, or any other provider, write an extension under `app/extensions/<name>/` that declares an `authProvider`. See [`app/extensions/README.md`](https://github.com/critica-tech-lab/loica/blob/main/app/extensions/README.md) for the full contract.

Once an SSO provider is in place, set `DISABLE_LOCAL_LOGIN=true` to run an SSO-only install: the password login form and signup are hidden, leaving the provider as the only way in. To keep password login but stop new self-service signups, set `REGISTRATION_OPEN=false` instead.

## Reverse Proxy (nginx alternative)

If using nginx instead of Caddy, you need to handle WebSocket upgrades:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:4001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }
}
```

## Backups

Loica doesn't ship operational tooling — wire up backups the way your platform expects. SQLite hot-backup via cron is a good baseline:

```bash
# Every 6 hours
0 */6 * * * sqlite3 /path/to/app.db "VACUUM INTO '/path/to/backups/app-$(date +\%Y\%m\%d-\%H\%M).db'"

# Prune backups older than 30 days
30 3 * * * find /path/to/backups -name "app-*.db" -mtime +30 -delete
```

For continuous replication, [Litestream](https://litestream.io) streams WAL changes to an S3-compatible store. Install it separately and run as its own systemd service against your `app.db`.

## Security Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use HTTPS everywhere (Caddy handles this automatically)
- [ ] Set `WS_URL` to `wss://`
- [ ] Disable open registration if needed (toggle in admin panel)
- [ ] Set up database backups
- [ ] Restrict `app.db` file permissions to the service user
- [ ] Consider rate limiting via your reverse proxy

## Deploying Updates

```bash
git pull
bun install --frozen-lockfile
bun run build
sudo systemctl restart loica loica-ws
```

## Monitoring

- **Health checks**: `GET /api/health` returns 200
- **Logs**: `journalctl -u loica -f` / `journalctl -u loica-ws -f`
- **WebSocket health**: `curl -sf http://localhost:4001/` returns 200
