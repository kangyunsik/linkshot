# Shared by the three root launchers. Never source the private .env as shell code.
linkshot_error() { printf '오류: %s\n' "$*" >&2; exit 1; }

linkshot_prepare() {
  cd "$LINKSHOT_ROOT"
  command -v node >/dev/null 2>&1 || linkshot_error 'Node.js 22 이상을 설치해 주세요.'
  command -v npm >/dev/null 2>&1 || linkshot_error 'npm을 설치해 주세요.'
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || linkshot_error 'Node.js 22 이상이 필요합니다.'
  [ -f node_modules/three/package.json ] && [ -f node_modules/ws/package.json ] || linkshot_error '프로젝트 루트에서 npm install을 먼저 실행해 주세요.'
}

linkshot_java_version() {
  "$1" -XshowSettings:properties -version 2>&1 | sed -n 's/^[[:space:]]*java.specification.version = //p'
}

linkshot_java_21() {
  command -v mvn >/dev/null 2>&1 || linkshot_error 'Maven 3.6.3 이상을 설치해 주세요.'
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ] && [ "$(linkshot_java_version "$JAVA_HOME/bin/java")" = 21 ]; then
    : # Keep an explicitly configured Java 21, including paths with spaces.
  elif [ -x /usr/libexec/java_home ]; then
    JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null) || linkshot_error 'Java 21을 설치해 주세요.'
  elif [ -n "${JAVA_HOME:-}" ]; then
    linkshot_error 'JAVA_HOME을 Java 21 설치 경로로 지정해 주세요.'
  fi
  if [ -n "${JAVA_HOME:-}" ]; then
    export JAVA_HOME
    PATH="$JAVA_HOME/bin:$PATH"
    export PATH
  fi
  command -v java >/dev/null 2>&1 || linkshot_error 'Java 21을 설치해 주세요.'
  [ "$(linkshot_java_version java)" = 21 ] || linkshot_error 'Java 21이 필요합니다. JAVA_HOME을 확인해 주세요.'
}
