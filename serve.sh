#!/usr/bin/env bash

set -euo pipefail

# Product Showcase static server helper
#
# Usage:
#   ./serve.sh                 # Start server on PORT (default 5173)
#   PORT=8080 ./serve.sh       # Start on custom port
#   HOST=0.0.0.0 ./serve.sh    # Bind to all interfaces
#   OPEN_BROWSER=0 ./serve.sh  # Do not open browser
#   LOG_FILE=/path/log ./serve.sh
#   ./serve.sh stop            # Stop any server on PORT (default 5173)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-5173}"
HOST="${HOST:-127.0.0.1}"
LOG_FILE="${LOG_FILE:-/tmp/product-showcase-server.log}"
OPEN_BROWSER="${OPEN_BROWSER:-1}"
START_TIMEOUT_SECS="${START_TIMEOUT_SECS:-10}"

cd "$ROOT_DIR"

is_listening_on_port() {
  local port="$1"
  lsof -i TCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

find_free_port() {
  local candidate="$1"
  local max_tries=50
  local tries=0
  while is_listening_on_port "$candidate"; do
    candidate=$((candidate + 1))
    tries=$((tries + 1))
    if [ "$tries" -ge "$max_tries" ]; then
      echo "Error: Could not find a free port starting from $1 within $max_tries attempts." >&2
      exit 1
    fi
  done
  echo "$candidate"
}

stop_on_port() {
  local port="$1"
  local pids
  if pids="$(lsof -ti :"$port" || true)" && [ -n "$pids" ]; then
    echo "Stopping processes on port $port: $pids"
    # shellcheck disable=SC2086
    kill $pids || true
  else
    echo "No process found listening on port $port"
  fi
}

if [ "${1:-}" = "stop" ]; then
  stop_on_port "$PORT"
  exit 0
fi

# If PORT is busy, stop existing listeners first, then try again; else find next free
if is_listening_on_port "$PORT"; then
  echo "Port $PORT is busy. Attempting to stop existing server(s)..."
  stop_on_port "$PORT"
  sleep 0.3
fi
PORT="$(find_free_port "$PORT")"

start_with_python() {
  nohup python3 -m http.server "$PORT" --bind "$HOST" >"$LOG_FILE" 2>&1 &
  echo $!
}

start_with_http_server() {
  nohup npx --yes http-server -p "$PORT" -a "$HOST" -c-1 . >"$LOG_FILE" 2>&1 &
  echo $!
}

choose_and_start_server() {
  if command -v python3 >/dev/null 2>&1; then
    start_with_python
  elif command -v npx >/dev/null 2>&1; then
    start_with_http_server
  else
    echo "Error: Neither python3 nor npx is available. Install one of them." >&2
    echo "- Python: comes with 'http.server' module" >&2
    echo "- Node: npm i -g http-server (or use npx http-server)" >&2
    exit 127
  fi
}

PID="$(choose_and_start_server)"

echo "Log file: $LOG_FILE"
echo "PID: $PID"
echo "Waiting for server to become available on http://$HOST:$PORT ..."

# Wait for server readiness
start_epoch="$(date +%s)"
until curl -sS -I "http://$HOST:$PORT/" >/dev/null 2>&1; do
  sleep 0.2
  now="$(date +%s)"
  if [ $((now - start_epoch)) -ge "$START_TIMEOUT_SECS" ]; then
    echo "Server did not become ready within $START_TIMEOUT_SECS seconds."
    echo "You can inspect logs with: tail -n +1 -f '$LOG_FILE'"
    exit 1
  fi
done

URL="http://$HOST:$PORT"
echo "Serving Product Showcase at: $URL"
echo "To stop: ./serve.sh stop (or kill $PID)"

if [ "$OPEN_BROWSER" = "1" ]; then
  # macOS 'open' command. Fallback to xdg-open if available.
  if command -v open >/dev/null 2>&1; then
    open "$URL" || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" || true
  fi
fi

exit 0


