#!/usr/bin/env bash
# cleanup-host.sh — Stops Docker simulation containers and cleans up resources on macOS and Linux

echo ""
echo "===================================================================="
echo " [Metasploit 2/e Ch.3 Simulation] macOS & Linux Cleanup"
echo "===================================================================="
echo ""

REMOVE_VOLUMES=""
for arg in "$@"; do
  if [[ "$arg" == "-v" || "$arg" == "--volumes" ]]; then
    REMOVE_VOLUMES="-v"
  fi
done

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "[*] Stopping and removing Docker simulation containers..."
  if [[ -f "docker-compose.sim.yaml" && -f "lab/lab/compose.yaml" ]]; then
    docker compose -f lab/lab/compose.yaml -f docker-compose.sim.yaml down --remove-orphans $REMOVE_VOLUMES || true
  elif [[ -f "docker-compose.sim.yaml" ]]; then
    docker compose -f docker-compose.sim.yaml down --remove-orphans $REMOVE_VOLUMES || true
  fi
  echo "  ✓ Docker containers stopped."
else
  echo "  [*] Docker is not running or not installed. Nothing to clean."
fi

echo "✓ Cleanup complete."
