#!/bin/sh
set -eu
LINKSHOT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$LINKSHOT_ROOT/scripts/shell-common.sh"

linkshot_prepare
linkshot_configure "$@"
printf '%s\n' 'LAN·온라인 전투 서버 실행 · LAN은 ./fe.sh만 추가 실행 · 계정/랭크는 ./spring.sh 필요. 종료: Ctrl+C'
exec npm run online:engine
