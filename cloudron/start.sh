#!/bin/bash
#
# Cloudron runs this as root. It maps the platform's addon environment onto the
# variable names Loica reads, fixes ownership on the persistent volume, and
# hands off to supervisor.
#
# Addon values can change on every restart, so nothing here is cached to disk.
# In particular no .env file is written into /app/data: it would go stale, and
# an OIDC client secret has no business sitting in a backed-up volume. Loica's
# own loader gives real environment variables precedence over .env anyway
# (app/lib/paths.server.ts).

set -eu

# ── Persistent data ──────────────────────────────────────────────────────────
# Only /app/data survives a restart or an update. File ownership is not
# preserved across restarts, so it is restored here every time.
mkdir -p /app/data/uploads /app/data/plugins
chown -R node:node /app/data

# nginx writes its temp files under /run (the root filesystem is read-only).
mkdir -p /run/nginx/body /run/nginx/proxy /run/nginx/fastcgi /run/nginx/scgi /run/nginx/uwsgi
chown -R www-data:www-data /run/nginx

# ── Core configuration ───────────────────────────────────────────────────────
export NODE_ENV=production
export DATA_DIR=/app/data

# Both servers bind loopback only; nginx on :8000 is the way in.
export PORT=3000
export HOST=127.0.0.1
export WS_PORT=4001
export WS_HOST=127.0.0.1

export SECURE_COOKIE=true
export SITE_URL="${CLOUDRON_APP_ORIGIN}"

# As the browser sees it: the platform terminates TLS, and nginx routes /ws to
# the WebSocket server.
export WS_URL="wss://${CLOUDRON_APP_DOMAIN}/ws"
export ALLOWED_ORIGINS="${CLOUDRON_APP_ORIGIN}"

# ── Mail (sendmail addon, optional) ──────────────────────────────────────────
# Without it Loica logs outbound mail instead of sending it, which is a working
# install — invites and password resets just have to be relayed by hand.
if [[ -n "${CLOUDRON_MAIL_SMTP_SERVER:-}" ]]; then
    export SMTP_HOST="${CLOUDRON_MAIL_SMTP_SERVER}"
    export SMTP_PORT="${CLOUDRON_MAIL_SMTP_PORT}"
    export SMTP_USER="${CLOUDRON_MAIL_SMTP_USERNAME:-}"
    export SMTP_PASS="${CLOUDRON_MAIL_SMTP_PASSWORD:-}"
    # The relay is inside Cloudron's own network, reached over plain SMTP.
    export SMTP_SECURE=false
    export EMAIL_FROM="${CLOUDRON_MAIL_FROM:-no-reply@${CLOUDRON_APP_DOMAIN}}"
fi

# ── Single sign-on (oidc addon, optional) ────────────────────────────────────
# app/extensions/oidc/oidc.server.ts already reads CLOUDRON_OIDC_ISSUER,
# _CLIENT_ID and _CLIENT_SECRET directly, so only the button label needs
# mapping. An admin still has to enable the extension — see POSTINSTALL.md.
if [[ -n "${CLOUDRON_OIDC_PROVIDER_NAME:-}" ]]; then
    export OIDC_LABEL="Sign in with ${CLOUDRON_OIDC_PROVIDER_NAME}"
fi

echo "==> Loica starting on ${CLOUDRON_APP_ORIGIN}"

# exec, so supervisor inherits PID 1 and Cloudron's SIGTERM reaches it. Bash
# does not forward signals to children, and the WS server needs that signal to
# flush open documents to SQLite before exiting.
exec /usr/bin/supervisord --configuration /etc/supervisor/supervisord.conf --nodaemon
