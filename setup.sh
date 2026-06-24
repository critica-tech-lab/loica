#!/bin/bash
set -e

echo "=== Loica Setup Script ==="
echo ""

# Detect OS
OS="$(uname -s)"
echo "[info] Detected OS: $OS"
echo ""

# 1. Install system dependencies
if [[ "$OS" == "Linux" ]]; then
  # Linux: use system package manager
  if command -v apt-get &>/dev/null; then
    PKG_MGR="apt"
  elif command -v dnf &>/dev/null; then
    PKG_MGR="dnf"
  elif command -v pacman &>/dev/null; then
    PKG_MGR="pacman"
  else
    echo "[!!] Unsupported package manager. Install git, curl, and unzip manually."
    PKG_MGR=""
  fi

  # Git
  if command -v git &>/dev/null; then
    echo "[ok] Git already installed"
  else
    echo "[..] Installing Git..."
    case "$PKG_MGR" in
      apt)    sudo apt-get update && sudo apt-get install -y git ;;
      dnf)    sudo dnf install -y git ;;
      pacman) sudo pacman -S --noconfirm git ;;
    esac
  fi

  # PDF/DOCX export needs no system binaries — the core renders both with
  # pure-JS (pdfmake + docx, image handling via sharp), all installed by
  # `bun install`. Opinionated export pipelines (e.g. pandoc/LaTeX house
  # styles) are drop-in plugins that bring their own dependencies.

  # curl + unzip (needed for Bun installer)
  for tool in curl unzip; do
    if command -v "$tool" &>/dev/null; then
      echo "[ok] $tool already installed"
    else
      echo "[..] Installing $tool..."
      case "$PKG_MGR" in
        apt)    sudo apt-get install -y "$tool" ;;
        dnf)    sudo dnf install -y "$tool" ;;
        pacman) sudo pacman -S --noconfirm "$tool" ;;
      esac
    fi
  done

  # Node.js
  if command -v node &>/dev/null && [[ "$(node --version | cut -d. -f1 | tr -d v)" -ge 20 ]]; then
    echo "[ok] Node.js $(node --version) already installed"
  else
    echo "[..] Installing Node.js via NodeSource..."
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      sudo dnf install -y nodejs
    elif command -v pacman &>/dev/null; then
      sudo pacman -S --noconfirm nodejs npm
    else
      echo "[!!] Please install Node.js 20+ manually: https://nodejs.org"
      exit 1
    fi
  fi

  # Bun
  if command -v bun &>/dev/null; then
    echo "[ok] Bun $(bun --version) already installed"
  else
    echo "[..] Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    # Add to current session
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
  fi

elif [[ "$OS" == "Darwin" ]]; then
  # macOS: use Homebrew
  if command -v brew &>/dev/null; then
    echo "[ok] Homebrew already installed"
  else
    echo "[..] Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ -f /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
  fi

  if command -v node &>/dev/null && [[ "$(node --version | cut -d. -f1 | tr -d v)" -ge 20 ]]; then
    echo "[ok] Node.js $(node --version) already installed"
  else
    echo "[..] Installing Node.js..."
    brew install node
  fi

  if command -v git &>/dev/null; then
    echo "[ok] Git already installed"
  else
    echo "[..] Installing Git..."
    brew install git
  fi

  if command -v bun &>/dev/null; then
    echo "[ok] Bun $(bun --version) already installed"
  else
    echo "[..] Installing Bun..."
    brew install oven-sh/bun/bun
  fi

else
  echo "[!!] Unsupported OS: $OS"
  exit 1
fi

echo ""

# 2. Determine project directory
INSTALL_DIR="/srv/loica"
if [[ "$OS" == "Darwin" ]]; then
  INSTALL_DIR="/opt/loica"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$SCRIPT_DIR/package.json" ]] && grep -q "loica" "$SCRIPT_DIR/package.json" 2>/dev/null; then
  echo "[ok] Already in project directory: $SCRIPT_DIR"
  cd "$SCRIPT_DIR"
elif [[ -f "$INSTALL_DIR/package.json" ]]; then
  echo "[ok] Project already cloned at $INSTALL_DIR"
  cd "$INSTALL_DIR"
else
  echo "[..] Cloning repository to $INSTALL_DIR..."
  if [[ "$OS" == "Linux" ]]; then
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$USER":"$USER" "$INSTALL_DIR"
  else
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$USER" "$INSTALL_DIR"
  fi
  git clone git@github.com:critica-tech-lab/loica.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 3. Install dependencies
echo "[..] Installing dependencies..."
bun install

# 4. Create .env if missing
if [[ -f .env ]]; then
  echo "[ok] .env already exists"
else
  echo "[..] Creating .env with defaults..."
  cat > .env << 'EOF'
NODE_ENV=production
WS_URL=wss://localhost/ws
EOF
  echo "     Edit .env to set your actual domain and WS_URL"
fi

# 5. Build
echo "[..] Building production bundle..."
bun run build

echo ""
echo "=== Setup complete ==="
echo ""
echo "To start in production:"
echo "  NODE_ENV=production bun run start &"
echo "  NODE_ENV=production node --experimental-strip-types ws-server.ts &"
echo ""
echo "To start in development:"
echo "  bun run dev:all"
echo ""
echo "Then open http://localhost:3000/signup to create the first user (auto-admin)."
