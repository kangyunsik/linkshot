#!/bin/sh
set -eu
LINKSHOT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$LINKSHOT_ROOT/scripts/shell-common.sh"

linkshot_prepare
if [ "$#" -gt 0 ]; then linkshot_configure "$@"; fi
if [ -z "${ONLINE_SERVER_URL:-}" ]; then
  if [ -f online-server/.env ]; then
    ONLINE_SERVER_URL=$(node --env-file=online-server/.env -p 'process.env.ONLINE_SERVER_URL || process.env.ONLINE_API_URL || "http://127.0.0.1:8080"')
  else
    ONLINE_SERVER_URL=${ONLINE_API_URL:-http://127.0.0.1:8080}
  fi
fi
if [ -z "${FRONTEND_URL:-}" ] && [ -f online-server/.env ]; then
  FRONTEND_URL=$(node --env-file=online-server/.env -p 'process.env.FRONTEND_URL || ""')
fi
export ONLINE_SERVER_URL FRONTEND_URL
npm run build
exec npm run preview
