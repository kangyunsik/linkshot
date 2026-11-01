#!/bin/sh
set -eu
LINKSHOT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$LINKSHOT_ROOT/scripts/shell-common.sh"

linkshot_prepare
linkshot_java_21
linkshot_configure "$@"
printf '%s\n' 'Spring + 개발용 PostgreSQL 실행 · 종료: Ctrl+C'
exec npm run online:dev
