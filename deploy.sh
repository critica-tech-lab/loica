#!/bin/bash
set -e

echo "=== Loica Production Deployment ==="
echo ""
echo "This script will set up Loica for production on this Linux machine."
echo "It handles: .env config, Caddy reverse proxy, systemd services, firewall, and backups."
echo ""

# ─── Check we're in the project directory ───────────────────────────────
if [[ ! -f "package.json" ]] || ! grep -q "loica" package.json 2>/dev/null; then
  echo "[error] Run this script from the Loica project directory (e.g. /srv/loica)"
  exit 1
fi

PROJECT_DIR="$(pwd)"
echo "[ok] Project directory: $PROJECT_DIR"
echo ""

# ─── Question 1: Domain ────────────────────────────────────────────────
read -rp "1. What is your domain? (e.g. docs.example.com): " DOMAIN
if [[ -z "$DOMAIN" ]]; then
  echo "[error] Domain is required."
  exit 1
fi
echo ""

# ─── Question 2: WebSocket URL ─────────────────────────────────────────
WS_URL_DEFAULT="wss://${DOMAIN}/ws"
read -rp "2. WebSocket URL? [${WS_URL_DEFAULT}]: " WS_URL
WS_URL="${WS_URL:-$WS_URL_DEFAULT}"
echo ""

# ─── Question 3: Caddy ─────────────────────────────────────────────────
read -rp "3. Install and configure Caddy as reverse proxy? (y/n) [y]: " INSTALL_CADDY
INSTALL_CADDY="${INSTALL_CADDY:-y}"
echo ""

# ─── Question 4: systemd ───────────────────────────────────────────────
read -rp "4. Create and enable systemd services? (y/n) [y]: " INSTALL_SYSTEMD
INSTALL_SYSTEMD="${INSTALL_SYSTEMD:-y}"
echo ""

# ─── Question 5: Firewall ──────────────────────────────────────────────
read -rp "5. Open firewall ports 80 and 443 (ufw)? (y/n) [y]: " OPEN_FIREWALL
OPEN_FIREWALL="${OPEN_FIREWALL:-y}"
echo ""

# ─── Question 6: Backup cron ───────────────────────────────────────────
read -rp "6. Set up automatic database backups (cron, every 6 hours)? (y/n) [y]: " SETUP_BACKUPS
SETUP_BACKUPS="${SETUP_BACKUPS:-y}"
echo ""

# ─── Summary ────────────────────────────────────────────────────────────
echo "=== Summary ==="
echo "  Domain:          $DOMAIN"
echo "  WebSocket URL:   $WS_URL"
echo "  Install Caddy:   $INSTALL_CADDY"
echo "  systemd services: $INSTALL_SYSTEMD"
echo "  Open firewall:   $OPEN_FIREWALL"
echo "  Backup cron:     $SETUP_BACKUPS"
echo ""
read -rp "Proceed? (y/n) [y]: " CONFIRM
CONFIRM="${CONFIRM:-y}"
if [[ "${CONFIRM,,}" != "y" ]]; then
  echo "Aborted."
  exit 0
fi
echo ""

# ─── Step 1: Create .env ───────────────────────────────────────────────
echo "[1/7] Configuring .env..."
cat > .env << EOF
NODE_ENV=production
WS_URL=${WS_URL}
EOF
echo "  Written: $PROJECT_DIR/.env"

# ─── Step 2: Install dependencies ──────────────────────────────────────
echo "[2/7] Installing dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install

# ─── Step 3: Build ──────────────────────────────────────────────────────
echo "[3/7] Building production bundle..."
bun run build

# ─── Step 4: Caddy ──────────────────────────────────────────────────────
if [[ "$INSTALL_CADDY" == "y" ]]; then
  echo "[4/7] Setting up Caddy..."
  if ! command -v caddy &>/dev/null; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
      sudo apt-get update && sudo apt-get install -y caddy
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y 'dnf-command(copr)'
      sudo dnf copr enable -y @caddy/caddy
      sudo dnf install -y caddy
    elif command -v pacman &>/dev/null; then
      sudo pacman -S --noconfirm caddy
    else
      echo "  [warn] Could not install Caddy automatically. Install it manually."
    fi
  else
    echo "  Caddy already installed."
  fi

  sudo tee /etc/caddy/Caddyfile > /dev/null << EOF
${DOMAIN} {
    handle_path /ws/* {
        reverse_proxy localhost:4001
    }
    handle {
        reverse_proxy localhost:3000
    }
}
EOF
  sudo systemctl enable --now caddy
  sudo systemctl restart caddy
  echo "  Caddyfile written. Caddy will auto-obtain a TLS certificate."
else
  echo "[4/7] Skipping Caddy setup."
fi

# ─── Step 5: systemd services ──────────────────────────────────────────
if [[ "$INSTALL_SYSTEMD" == "y" ]]; then
  echo "[5/7] Creating systemd services..."

  BUN_PATH="$(which bun)"
  NODE_PATH="$(which node)"

  sudo tee /etc/systemd/system/loica.service > /dev/null << EOF
[Unit]
Description=Loica App Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=$BUN_PATH run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  sudo tee /etc/systemd/system/loica-ws.service > /dev/null << EOF
[Unit]
Description=Loica WebSocket Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=$NODE_PATH ws-server.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable --now loica loica-ws
  echo "  Services created and started."
else
  echo "[5/7] Skipping systemd setup."
fi

# ─── Step 6: Firewall ──────────────────────────────────────────────────
if [[ "$OPEN_FIREWALL" == "y" ]]; then
  echo "[6/7] Configuring firewall..."
  if command -v ufw &>/dev/null; then
    sudo ufw allow 80 >/dev/null 2>&1
    sudo ufw allow 443 >/dev/null 2>&1
    echo "  Ports 80 and 443 opened."
  else
    echo "  [warn] ufw not found. Open ports 80 and 443 manually in your firewall."
  fi
else
  echo "[6/7] Skipping firewall setup."
fi

# ─── Step 7: Backup cron ───────────────────────────────────────────────
if [[ "$SETUP_BACKUPS" == "y" ]]; then
  echo "[7/7] Setting up backup cron job..."
  BACKUP_DIR="$PROJECT_DIR/backups"
  mkdir -p "$BACKUP_DIR"

  # Build cron entries
  BACKUP_LINE="0 */6 * * * sqlite3 $PROJECT_DIR/app.db \"VACUUM INTO '$BACKUP_DIR/app-\$(date +\\%Y\\%m\\%d-\\%H\\%M).db'\""
  PRUNE_LINE="30 3 * * * find $BACKUP_DIR -name 'app-*.db' -mtime +30 -delete"

  # Add to crontab if not already present
  (crontab -l 2>/dev/null || true) | grep -qF "VACUUM INTO" || {
    (crontab -l 2>/dev/null || true; echo "$BACKUP_LINE"; echo "$PRUNE_LINE") | crontab -
    echo "  Cron job added: backup every 6 hours, prune after 30 days."
    echo "  Backup directory: $BACKUP_DIR"
  }
else
  echo "[7/7] Skipping backup setup."
fi

# ─── Done ───────────────────────────────────────────────────────────────
echo ""
echo "=== Deployment complete ==="
echo ""
echo "  App:       https://$DOMAIN"
echo "  WebSocket: $WS_URL"
echo ""
if [[ "$INSTALL_SYSTEMD" == "y" ]]; then
  echo "  Check status:  sudo systemctl status loica loica-ws"
  echo "  View app logs: journalctl -u loica -f"
  echo "  View ws logs:  journalctl -u loica-ws -f"
  echo ""
fi
echo "  Next step: open https://$DOMAIN/signup to create the first user (auto-admin)."
echo ""
