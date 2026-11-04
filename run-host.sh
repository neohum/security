#!/usr/bin/env bash
# run-host.sh — Host Launcher for macOS and Linux
# Automatically detects Wi-Fi/Ethernet IP, starts Docker simulation overlay (optional),
# and launches the LAN Gateway server with interactive CTF Arena and tutorial.

set -e

PORT="${PORT:-3000}"
SSH_PORT="${SSH_PORT:-2222}"
SKIP_DOCKER="${SKIP_DOCKER:-false}"

echo ""
echo "===================================================================="
echo " [Metasploit 2/e Ch.3 Simulation] macOS & Linux Host Launcher"
echo "===================================================================="
echo ""

# 1. Detect IPv4 Address
echo "[1/4] Detecting local IPv4 network address..."
HOST_IP=""

if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS: Detect default route interface, fallback to en0, en1
  DEFAULT_IFACE=$(route get default 2>/dev/null | awk '/interface:/ {print $2}')
  if [[ -n "$DEFAULT_IFACE" ]]; then
    HOST_IP=$(ipconfig getifaddr "$DEFAULT_IFACE" 2>/dev/null || echo "")
  fi
  if [[ -z "$HOST_IP" ]]; then
    HOST_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
  fi
else
  # Linux: hostname -I with ip route fallback
  HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  if [[ -z "$HOST_IP" ]]; then
    HOST_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7}')
  fi
  if [[ -z "$HOST_IP" ]]; then
    HOST_IP=$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n 1)
  fi
fi

if [[ -z "$HOST_IP" ]]; then
  HOST_IP="127.0.0.1"
fi

echo "  ✓ Detected Host LAN IP: $HOST_IP"

# 2. Check Node.js and dependencies
echo "[2/4] Checking Node.js environment..."
if ! command -v node >/dev/null 2>&1; then
  echo "  ❌ Node.js is not installed. Please install Node.js 18+ to continue."
  exit 1
fi

if [[ ! -d "node_modules" ]]; then
  echo "  [*] Installing dependencies (npm install)..."
  npm install
fi

# 3. Optional Docker Compose startup
if [[ "$SKIP_DOCKER" != "true" ]]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "[3/4] Launching Docker simulation containers (fake-recon, fake-s3)..."
    if [[ -f "docker-compose.sim.yaml" && -f "lab/lab/compose.yaml" ]]; then
      docker compose -f lab/lab/compose.yaml -f docker-compose.sim.yaml up -d || true
      echo "  ✓ Docker containers started."
    fi
  else
    echo "[3/4] Docker is not running or not installed. Running in standalone mock mode."
  fi
else
  echo "[3/4] Docker startup skipped (standalone mode)."
fi

# 4. Launch Gateway Server
echo "[4/4] Starting LAN Gateway Server on port $PORT..."
echo ""
echo "===================================================================="
echo "  🌐 CTF Arena URL  : http://${HOST_IP}:${PORT}/arena"
echo "  🔴 Attacker View  : http://${HOST_IP}:${PORT}/?role=attacker"
echo "  🛡️ Defender View  : http://${HOST_IP}:${PORT}/?role=defender"
echo "  👁️ Observer View  : http://${HOST_IP}:${PORT}/?role=observer"
echo "  💻 Direct SSH     : ssh -p ${SSH_PORT} {username}@${HOST_IP}"
echo "===================================================================="
echo ""

PORT=$PORT SSH_PORT=$SSH_PORT HOST_IP=$HOST_IP npx tsx server/index.ts
