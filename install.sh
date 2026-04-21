#!/usr/bin/env bash
#
# docket — local install
#
# - Adds `127.0.0.1 docket` to /etc/hosts (requires sudo, idempotent)
# - Builds + starts the Docker Compose service
# - Access at http://docket (port 80) after completion
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. /etc/hosts entry
if grep -qE '^\s*127\.0\.0\.1\s+docket(\s|$)' /etc/hosts; then
  echo "[docket] /etc/hosts already has 'docket' — skipping"
else
  echo "[docket] adding '127.0.0.1 docket' to /etc/hosts (sudo required)"
  echo "127.0.0.1 docket" | sudo tee -a /etc/hosts >/dev/null
fi

# 2. ~/.docket/dashboards exists
mkdir -p "$HOME/.docket/dashboards"

# 3. Build + start
cd "$REPO_ROOT"
if docker compose version >/dev/null 2>&1; then
  docker compose up -d --build
else
  docker-compose up -d --build
fi

echo ""
echo "[docket] ready → http://docket"
