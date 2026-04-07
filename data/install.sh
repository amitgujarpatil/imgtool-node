#!/usr/bin/env bash
# ============================================================
#  install.sh
#
#  One-shot setup script — installs EVERYTHING needed to run:
#    • imgtool-node  (Node.js signing tool)
#    • imgtool.py    (Python verification tool)
#
#  Run once from any directory:
#    bash install.sh
#
#  Tested on: Ubuntu 20.04 / 22.04 / 24.04, Debian, macOS
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMGTOOL_NODE_DIR="$SCRIPT_DIR/.."          # scripts/imgtool-node/
SCRIPTS_DIR="$IMGTOOL_NODE_DIR/.."         # scripts/

echo
echo "============================================================"
echo "  imgtool Setup — Installing all dependencies"
echo "============================================================"
echo

# ── OS detection ──────────────────────────────────────────────────────────────
OS="unknown"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  if command -v apt-get &>/dev/null; then OS="debian"
  elif command -v dnf &>/dev/null;     then OS="fedora"
  elif command -v yum &>/dev/null;     then OS="centos"
  else OS="linux"
  fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
  OS="macos"
fi
info "Detected OS: $OS"
echo

# ── PART 1: System packages ───────────────────────────────────────────────────
info "PART 1 — Installing system packages..."

install_system_deps() {
  case "$OS" in
    debian)
      info "  Using apt-get..."
      sudo apt-get update -qq
      sudo apt-get install -y \
        python3 python3-pip python3-venv \
        nodejs npm \
        openssl curl git
      ;;
    fedora)
      info "  Using dnf..."
      sudo dnf install -y \
        python3 python3-pip \
        nodejs npm \
        openssl curl git
      ;;
    centos)
      info "  Using yum..."
      sudo yum install -y \
        python3 python3-pip \
        nodejs npm \
        openssl curl git
      ;;
    macos)
      if ! command -v brew &>/dev/null; then
        warn "  Homebrew not found. Installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      fi
      info "  Using brew..."
      brew install python3 node openssl
      ;;
    *)
      warn "  Unknown OS — skipping system package install."
      warn "  Please ensure python3, pip3, node, npm, openssl are installed manually."
      ;;
  esac
}

# Only install system packages if something is missing
NEED_SYS=0
command -v python3  &>/dev/null || NEED_SYS=1
command -v pip3     &>/dev/null || NEED_SYS=1
command -v node     &>/dev/null || NEED_SYS=1
command -v npm      &>/dev/null || NEED_SYS=1
command -v openssl  &>/dev/null || NEED_SYS=1

if [[ $NEED_SYS -eq 1 ]]; then
  install_system_deps
else
  ok "  System packages already present — skipping"
fi
echo

# ── Version checks ────────────────────────────────────────────────────────────
info "  Checking versions..."
python3 --version
node    --version
npm     --version
openssl version
echo

# ── PART 2: Python dependencies for imgtool.py ───────────────────────────────
info "PART 2 — Installing Python dependencies for imgtool.py..."

PYTHON_DEPS="click cryptography cbor2 intelhex"

# Try normal pip first, fall back to --break-system-packages (PEP 668 systems)
install_pip() {
  local pkg="$1"
  pip3 install --quiet "$pkg" 2>/dev/null \
    || pip3 install --quiet --break-system-packages "$pkg" 2>/dev/null \
    || pip3 install --quiet --user "$pkg" 2>/dev/null \
    || { fail "Failed to install Python package: $pkg"; }
}

for pkg in $PYTHON_DEPS; do
  # Check if already importable
  PKG_IMPORT="${pkg//-/_}"   # cbor2 → cbor2, intelhex → intelhex
  if python3 -c "import $PKG_IMPORT" 2>/dev/null; then
    ok "  $pkg  (already installed)"
  else
    info "  Installing $pkg ..."
    install_pip "$pkg"
    ok "  $pkg  installed"
  fi
done
echo

# ── Verify all Python imports ─────────────────────────────────────────────────
info "  Verifying Python imports..."
python3 -c "
import click, cryptography, cbor2, intelhex
print('    click        OK', click.__version__)
print('    cryptography OK', cryptography.__version__)
print('    cbor2        OK', getattr(cbor2, '__version__', 'installed'))
print('    intelhex     OK', getattr(intelhex, '__version__', 'installed'))
"
echo

# ── PART 3: Node.js dependencies for imgtool-node ────────────────────────────
info "PART 3 — Installing Node.js dependencies for imgtool-node..."
cd "$IMGTOOL_NODE_DIR"
npm install --silent
ok "  npm packages installed  (commander, cbor-x)"
echo

# ── PART 4: Smoke test — Python imgtool.py ───────────────────────────────────
info "PART 4 — Smoke testing imgtool.py..."
OUT=$(python3 "$SCRIPTS_DIR/imgtool.py" --help 2>&1)
if echo "$OUT" | grep -q "sign\|verify"; then
  ok "  python3 imgtool.py  — OK"
else
  fail "  imgtool.py failed: $OUT"
fi
echo

# ── PART 5: Smoke test — imgtool-node ────────────────────────────────────────
info "PART 5 — Smoke testing imgtool-node..."
OUT=$(node "$IMGTOOL_NODE_DIR/imgtool.js" --help 2>&1)
if echo "$OUT" | grep -q "sign\|verify"; then
  ok "  node imgtool.js  — OK"
else
  fail "  imgtool.js failed: $OUT"
fi
echo

# ── PART 6: Generate data files ──────────────────────────────────────────────
info "PART 6 — Generating keys + firmware binary in data/ ..."
python3 "$SCRIPT_DIR/setup.py"
echo

# ── Done ──────────────────────────────────────────────────────────────────────
echo "============================================================"
ok "Setup complete! Everything is ready."
echo "============================================================"
echo
echo "  Run from:  scripts/imgtool-node/"
echo
echo "  1) Sign:"
echo "     node ./imgtool.js sign \\"
echo "         --key         ./data/server-private-key.pem \\"
echo "         --version     1.0.1        \\"
echo "         --header-size 0x200        \\"
echo "         --align       128          \\"
echo "         --max-align   128          \\"
echo "         --slot-size   0x30000      \\"
echo "         --max-sectors 6            \\"
echo "         --pad --confirm            \\"
echo "         --boot-record obdApp       \\"
echo "         --pad-header               \\"
echo "         ./data/firmware.bin        \\"
echo "         ./data/my_L2up.bin"
echo
echo "  2) Verify with public key:"
echo "     python3 ../imgtool.py verify \\"
echo "         --key ./data/server-public-key.pem \\"
echo "         ./data/my_L2up.bin"
echo
