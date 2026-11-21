#!/usr/bin/env bash
# Starts the Storage Gateway, the API, and the Portal when the repo has one. Postgres and
# Mailpit must already be running (docker compose up -d). Output is prefixed with each
# service's name, and Ctrl-C stops everything. Any setting below can be overridden from the
# environment or from a .env file at the repo root. The secrets are development values only.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Ports.
: "${GATEWAY_PORT:=8080}"
: "${PORT:=4000}"
: "${PORTAL_PORT:=3000}"

# Postgres from docker-compose.yml, with the same default credentials.
: "${POSTGRES_USER:=lumavault}"
: "${POSTGRES_PASSWORD:=lumavault}"
: "${POSTGRES_DB:=lumavault}"
: "${DATABASE_URL:=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}}"

# The Gateway and the API must share the ticket secret and service key. The API wants each
# secret to be at least 32 bytes.
: "${LUMAVAULT_TICKET_SECRET:=dev-only-ticket-secret-0123456789abcdef}"
: "${LUMAVAULT_SERVICE_KEY:=dev-only-service-key-0123456789abcdef}"
: "${BETTER_AUTH_SECRET:=dev-only-better-auth-secret-0123456789abcdef}"

: "${LUMAVAULT_GATEWAY_URL:=http://localhost:${GATEWAY_PORT}}"
: "${LUMAVAULT_PORTAL_URL:=http://localhost:${PORTAL_PORT}}"
: "${LUMAVAULT_WEB_ORIGINS:=http://localhost:${PORTAL_PORT},http://localhost:3001,http://localhost:3002,http://localhost:3003}"
# Mailpit catches every email; read them at http://localhost:8025.
: "${SMTP_URL:=smtp://localhost:1025}"

export DATABASE_URL PORT LUMAVAULT_TICKET_SECRET LUMAVAULT_SERVICE_KEY BETTER_AUTH_SECRET \
  LUMAVAULT_GATEWAY_URL LUMAVAULT_PORTAL_URL LUMAVAULT_WEB_ORIGINS SMTP_URL

# Generated stubs, dependencies, and the web SDK build, each only if out of date.
make gen/.proto-stamp node_modules/.modules.yaml sdk/web/dist/index.js

# Each service runs in its own process group, so stopping it also stops what it started
# (go run's binary, tsx watch, vite).
set -m
pids=()

start() {
  local name=$1
  shift
  ("$@" 2>&1 | awk -v prefix="[$name] " '{ print prefix $0; fflush() }') &
  pids+=($!)
}

stop_all() {
  trap - EXIT
  for pid in "${pids[@]}"; do
    kill -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "Stopped"
}
trap stop_all EXIT
trap "exit 130" INT TERM

start gateway go run ./cmd/lumavault -addr ":${GATEWAY_PORT}"
start api pnpm --dir apps/api dev
if [[ -f apps/portal/package.json ]]; then
  start portal env VITE_API_URL="http://localhost:${PORT}" VITE_PORTAL_URL="${LUMAVAULT_PORTAL_URL}" \
    pnpm --dir apps/portal exec vite --port "${PORTAL_PORT}" --strictPort
fi

echo "Gateway  http://localhost:${GATEWAY_PORT}"
echo "API      http://localhost:${PORT}"
[[ -f apps/portal/package.json ]] && echo "Portal   ${LUMAVAULT_PORTAL_URL}"
echo "Mailpit  http://localhost:8025"

# Stop everything as soon as any one service exits, so a crash is not hidden in the output.
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A service exited; stopping the rest"
      exit 1
    fi
  done
  sleep 1
done
