#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-6969}"
PID_FILE="/tmp/rnn-glider-devserver-${PORT}.pid"
LOG_FILE="/tmp/rnn-glider-devserver-${PORT}.log"

is_responding() {
  curl -I -s "http://127.0.0.1:${PORT}" >/dev/null 2>&1
}

if is_responding; then
  echo "already-running:${PORT}"
  exit 0
fi

if [[ -f "${PID_FILE}" ]]; then
  OLD_PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${OLD_PID}" ]] && kill -0 "${OLD_PID}" >/dev/null 2>&1; then
    echo "stale-process:${OLD_PID}"
  fi
  rm -f "${PID_FILE}"
fi

cd "${ROOT_DIR}"
if command -v setsid >/dev/null 2>&1; then
  setsid bash -lc "echo \$\$ > \"${PID_FILE}\"; exec python3 \"${ROOT_DIR}/scripts/dev_static_server.py\" --port \"${PORT}\" >>\"${LOG_FILE}\" 2>&1" >/dev/null 2>&1 < /dev/null &
  SERVER_PID=""
else
  nohup python3 scripts/dev_static_server.py --port "${PORT}" >"${LOG_FILE}" 2>&1 < /dev/null &
  SERVER_PID=$!
  echo "${SERVER_PID}" >"${PID_FILE}"
fi

for _ in $(seq 1 40); do
  if is_responding; then
    if [[ -z "${SERVER_PID}" ]] && [[ -f "${PID_FILE}" ]]; then
      SERVER_PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
    fi
    echo "started:${PORT}:${SERVER_PID}"
    exit 0
  fi
  sleep 0.2
done

echo "failed:${PORT}:${SERVER_PID}"
exit 1
