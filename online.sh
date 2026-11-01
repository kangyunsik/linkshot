#!/bin/sh
set -eu
LINKSHOT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$LINKSHOT_ROOT/scripts/shell-common.sh"

linkshot_prepare
npm run online:config
printf '%s\n' '온라인 전투 서버 실행 · Spring은 ./spring.sh로 실행하세요. 종료: Ctrl+C'
exec npm run online:engine
