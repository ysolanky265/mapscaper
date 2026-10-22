#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
URL="http://localhost:3000"
fail() { echo; echo "Matala Review Signals could not start: $1"; read -r -p 'Press Return to close...'; exit 1; }
command -v docker >/dev/null 2>&1 || fail 'Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ and run it first.'
docker info >/dev/null 2>&1 || fail 'Docker Desktop is installed but not running. Open Docker Desktop, wait until it is ready, then launch again.'
if [ ! -f .env ]; then
  DB="$(openssl rand -hex 32)"
  SESSION="$(openssl rand -hex 32)"
  ENC="$(openssl rand -base64 32 | tr -d '\n')"
  PASSWORD="$(openssl rand -base64 18 | tr -d '=+/\n' | cut -c1-20)"
  umask 077
  printf 'POSTGRES_PASSWORD=%s\nAPP_PASSWORD=%s\nSESSION_SECRET=%s\nKEY_ENCRYPTION_SECRET=%s\n' "$DB" "$PASSWORD" "$SESSION" "$ENC" > .env
  chmod 600 .env
  echo "First-run workspace password: $PASSWORD"
  echo 'Save this password somewhere private. It is also stored in the local .env file.'
fi
echo 'Starting Matala Review Signals. First run may take a few minutes...'
docker compose up -d --build || fail 'Docker Compose failed. Check Docker Desktop and your internet connection.'
echo 'Waiting for the app to become ready...'
for i in $(seq 1 60); do
  if curl -fsS "$URL/health" >/dev/null 2>&1; then
    open "$URL"
    echo 'Matala Review Signals is ready in your browser.'
    echo 'To stop it, double-click launchers/stop-matala.command. Your database remains saved.'
    exit 0
  fi
  sleep 2
done
docker compose logs --tail 40 app
fail 'The server did not become ready within two minutes. See the logs above.'
