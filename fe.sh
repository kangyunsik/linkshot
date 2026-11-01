#!/bin/sh
set -eu
LINKSHOT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$LINKSHOT_ROOT/scripts/shell-common.sh"

linkshot_prepare
if [ -z "${ONLINE_SERVER_URL:-}" ]; then
  if [ -f online-server/.env ]; then
    ONLINE_SERVER_URL=$(node --env-file=online-server/.env -p 'process.env.ONLINE_API_URL || "http://127.0.0.1:8080"')
  else
    ONLINE_SERVER_URL=${ONLINE_API_URL:-http://127.0.0.1:8080}
  fi
fi
export ONLINE_SERVER_URL
npm run build
printf 'FE: http://127.0.0.1:%s · 종료: Ctrl+C\n' "${PREVIEW_PORT:-4173}"
exec npm run preview
