# Spring 온라인 서비스 — 로컬 개발 기반

**Java 21 · Spring Boot 4.1.2 · PostgreSQL 18.3**. 기존 Node LAN 서버와 브라우저 워커는 유지하고, 온라인 전투도 `shared/`의 같은 JS 규칙을 별도 실행 노드에서 사용합니다.

## 현재 구현 범위

- 아이디/비밀번호 회원가입·로그인·로그아웃, BCrypt 12, 로그인 시 세션 ID 교체.
- PostgreSQL에 계정·서버 소유 전적/LP/해금/숙련도와 JDBC 세션 저장. 기기 프로필을 업로드/이전하는 API는 없습니다.
- HttpOnly·`/api` 경로 전용 쿠키, CSRF, 명시적 CORS 목록, 요청 크기/인증 시도 제한.
- 서버 배정 경기 계약, 엔진 점유/하트비트, 60초·일회용·해시 저장 접속권.
- 원래 JS 엔진에서 판정한 경기 결과만 엔진 전용 인증으로 정산. 참가자·AI 수·킬/데스·무기 장부를 확인하고 같은 경기를 중복 지급하지 않습니다.
- JS 게이트웨이에서 생존/사망 장비 규칙과 재접속 생명·탄약을 유지합니다. 랭크 슬롯에 AI를 넣는 경로는 없으며 Java와 JS 양쪽에서 AI 배정을 거부합니다.
- 비정상 종료/만료된 엔진 점유는 계정을 해제하고 보상을 지급하지 않습니다.

**일반·랭크 대기열, 레이팅 갱신, 배치/승급/강등은 아직 활성화하지 않았습니다.** `/api/health`의 `matchmaking`도 `false`입니다. 현재 로비에서는 온라인 계정만 사용할 수 있고 매칭 버튼은 준비 중으로 표시합니다. 경기 생성은 후속 Spring 매칭 서비스만 호출할 메서드이며 브라우저에 임의 생성 API를 열지 않습니다. 새 온라인 계정은 로컬 LP와 관계없이 0 LP·기본 4종으로 시작합니다.

## Docker 없이 개발

Node 22 이상, `npm install`, Java 21, Maven 3.6.3 이상이 필요합니다. 개발용 PostgreSQL 바이너리는 Maven의 테스트 의존성으로 내려받으며 시스템 DB를 설치하거나 기존 DB를 변경하지 않습니다. 일반 사용자로 실행하세요.

```sh
npm run online:config
npm run online:dev
```

다른 터미널에서:

```sh
npm run online:engine
```

프런트엔드는 다음과 같이 선택적으로 API 주소를 넣어 빌드합니다. 튜토리얼·혼자 연습은 여전히 서버 없이 동작합니다.

```sh
ONLINE_SERVER_URL=http://127.0.0.1:8080 npm run build
npm run preview
```

`http://127.0.0.1:4173`에서 일반/랭크 탭의 온라인 계정 패널을 이용합니다. 개발에서는 FE/API 호스트를 모두 `127.0.0.1`로 맞추세요. 다른 포트를 쓰면 `.env`의 `FRONTEND_ORIGINS`를 해당 origin으로 바꿉니다. Java 선택이 필요하면 `JAVA_HOME`을 설치된 Java 21에 맞춥니다.

`online:config`는 무작위 비밀값을 `online-server/.env`에 0600 권한으로 생성하고 값은 출력하지 않습니다. 기존 파일은 덮어쓰지 않습니다. 개발 DB는 `data/online-dev/`에 남아 재시작 후에도 계정을 유지하며, 테스트 DB는 `online-server/target/` 아래에 격리합니다. 두 경로와 `.env`는 Git/배포 대상이 아닙니다. **테스트용 DB는 로컬 전용이며 인터넷에 노출하면 안 됩니다.**

## Docker Compose 대안

```sh
npm run online:config
docker compose --env-file online-server/.env -f compose.online.yml up --build
```

API 8080, 전투 노드 8090, DB 5432는 모두 호스트 루프백에만 바인딩합니다. Compose는 별도의 `online-db` 볼륨을 사용하며 Docker 없는 개발 DB와 섞이지 않습니다. 실제 운영 배포·TLS·도메인·백업·비밀번호 복구/계정 운영 정책은 별도 설정이 필요합니다. 현재 개발 환경에는 Docker가 없어 Compose 실행 자체는 검증하지 않았습니다.

## 경계와 연결 계약

```text
정적 FE ── /api/auth/*, /api/account ── Spring + PostgreSQL
       └─ 일회용 접속권 ── WebSocket 전투 노드 ── shared JS Room
                                └─ 엔진 전용 /internal/* 정산 ── Spring
```

브라우저는 세션 쿠키/CSRF를 사용하고 엔진 비밀키를 받지 않습니다. `ENGINE_SECRET`은 Spring과 전투 노드 사이에서만 공유합니다. 접속권은 WebSocket 첫 인증 메시지로 보내며 URL이나 로그에 남기지 않습니다. 클라이언트가 제출한 사용자 ID·보유 무기·점수·결과는 신뢰하지 않습니다. 접속 복구 유예의 개발 기본값은 30초이고, 최종 탈주/보상 정책은 매칭 단계에서 확정합니다.

외부 HTTPS FE를 쓸 때 API/WS에도 HTTPS/WSS가 필요합니다. 쿠키는 기본 `SameSite=Lax`; 서로 다른 사이트 배포가 필요하면 TLS 뒤에서 `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none`과 정확한 `FRONTEND_ORIGINS`를 설정합니다. `none`과 비보안 쿠키 조합은 서버가 거부합니다. 개발 구성을 그대로 포트포워딩해 공개하지 마세요.

## 검증

```sh
npm test
npm run test:online
ONLINE_BROWSER_TEST=1 npm run test:e2e -- tests/browser/online.spec.js
```

마지막 명령은 Playwright 브라우저가 설치된 환경에서 실제 브라우저 회원가입/로그인과 로컬 LP 보존까지 검사합니다. 통합 테스트는 **실제 PostgreSQL과 실제 Spring HTTP 서버**를 사용하고 Node 전투 노드의 두 WebSocket 접속·처치·정산도 검증합니다. 개인 프로필이나 실제 운영 DB를 테스트 데이터로 사용하지 않습니다.

의존성 라이선스: Spring/대부분의 빌드 라이브러리는 Apache-2.0, PostgreSQL은 PostgreSQL License, 테스트용 `io.zonky.test:embedded-postgres`는 Apache-2.0입니다. 모델·이미지·기존 엔진 원본이나 Windows 패키지를 온라인 서버 소스에 포함하지 않습니다.
