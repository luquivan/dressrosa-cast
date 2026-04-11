#!/bin/bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: ./scripts/open-url.sh <url>"
  exit 1
fi

CONTROL_BASE="${DRESSROSA_CONTROL_BASE:-http://100.83.60.48:8010}"
REPLACE="${REPLACE:-1}"
NEW_WINDOW="${NEW_WINDOW:-1}"

curl -fsS -G "${CONTROL_BASE}/open" \
  --data-urlencode "url=$1" \
  --data "replace=${REPLACE}" \
  --data "newWindow=${NEW_WINDOW}"
echo
