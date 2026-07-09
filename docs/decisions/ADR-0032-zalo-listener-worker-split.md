# ADR-0032 — Zalo 리스너 전용 워커 서비스 분리 (배포 블랙아웃 제거)

- 상태: **구현 완료(플래그 기본-OFF·미배포·미커밋)** — 2026-07-09, TDA 설계 → BE 구현 → QA PASS. 코드 전량 기본-OFF 플래그 뒤라 프로덕션 무영향. 활성화 = §4 Railway 워커 서비스 생성 + §5 마이그레이션(OPS/테오). typecheck0·build0·테스트 2366(신규 12)·QA 4대 불변식 PASS(현행보존·밴방지·누수0·내부인증).
- 관련: ADR-0005(zca-js), ADR-0006(Zalo 런타임·인프로세스 리스너), ADR-0007(멀티관리자 개인 세션), ADR-0010(Nike↔villa 세션 허브·A안 ext API), ADR-0024(SSE 인박스)
- 메모리: [[deploy-restart-zalo-listener-blackout]], [[zalo-inbound-delay-diagnosis-and-watchdog]], IDEAS.md "Zalo 리스너 전용 서비스 분리"
- 코드 앵커: `instrumentation.ts`, `lib/zalo-runtime.ts`, `lib/realtime-bus.ts`, `lib/zalo-health.ts`, `lib/zalo-webhook.ts`, `lib/zalo-ext-auth.ts`, `app/api/zalo/stream/route.ts`, `app/api/zalo/ext/send/route.ts`, `app/api/zalo/messages/route.ts`, `app/api/cron/notifications/route.ts`, `lib/zalo.ts`(dispatchOne)

---

## 1. 맥락 / 문제

현재 zca-js Zalo 세션(시스템봇 + 관리자 개인계정, ADR-0007 풀)은 **웹 프로세스(`next start`)와 동일 컨테이너에서 in-process로** 구동된다.

- 부팅: `instrumentation.register()` → `connectAllActive()`(풀 로그인 + `listener.start`) + `startZaloHealthWatchdog()`.
- 인바운드: zca-js `listener.on("message")` → `handleInboundEvent`(lib/zalo-runtime) → `saveInboundMessage`/`saveOutboundEcho`(DB) → **① in-process `publish(ownerAdminId,…)`(lib/realtime-bus EventEmitter)** + **② `pushInboundToNike`(Nike webhook)**.
- SSE: `/api/zalo/stream`이 **같은 프로세스의** realtime-bus를 `subscribe` → 브라우저로 push.
- 아웃바운드: 웹 채팅(`/api/zalo/messages`→`sendChatMessageAsAdmin`→`getApiForAdmin`), 알림 cron(`/api/cron/notifications`→`dispatchOne`→`sendBotMessage`→`getSystemBotApi`), Nike 위임(`/api/zalo/ext/send`→`sendChat*AsAdmin`) — **모두 in-process zca-js API에 의존**.

**결함**: 웹은 머지·배포마다 재시작된다. 재시작 = 모든 zca-js 세션 드롭 → **~16분 인바운드 블랙아웃**(zca-js 재접속 시 일부만 백로그). 잦은 머지일에 체감 수신 지연(실측·워치독 도입의 원인, ADR 워치독 메모리).

**목표**: 리스너 세션을 **웹 배포 수명과 분리**해, 웹이 몇 번을 재배포해도 수신이 끊기지 않게 한다.

**결정적 제약(밴 위험)**: zca-js는 같은 계정을 **두 프로세스에서 동시 WebSocket 로그인하면 `code 3000`(DuplicateConnection)**으로 한쪽을 강제 종료한다(밴 위험 신호, ADR-0010 C1·`listener.on("closed")` code 3000 분기). 따라서 세션 보유 프로세스는 **정확히 1개**여야 하며, 분리 마이그레이션 전 구간에서 이 불변식을 깨면 안 된다.

이 분리는 신규 설계가 아니라 **ADR-0010이 이미 예약해 둔 진화 경로("ext API 계약을 그대로 두고 세션 소유 프로세스만 떼면 C안 별도 zalo-gw로 무중단 승격")의 실행**이다.

---

## 2. 결정 (요약)

1. **토폴로지 — 같은 레포, 서비스 2개(둘 다 replica=1)**
   - **web** (Next.js, `next start`): 모든 HTTP 라우트·SSE 엔드포인트·DB·API·cron 진입점. **zca-js 세션을 절대 보유하지 않는다**(로그인 안 함).
   - **zalo-worker** (long-running Node 프로세스, 신규): **모든 zca-js 세션의 유일 보유자** — 시스템봇 + 관리자 개인계정 풀(ADR-0007), 리스너, 워치독, QR 로그인, 실제 발송. Railway 사설망 내부 HTTP만 노출(공개 HTTPS 없음).

2. **인바운드 신호 전달 = PostgreSQL LISTEN/NOTIFY** (in-process 버스 대체, 권장)
   - 워커: 메시지 저장 직후 `NOTIFY zalo_realtime, '<json 신호>'` (payload = `{ ownerAdminId, type, conversationId }` — **식별 신호만, 본문·마진·판매가·원가 0**, realtime-bus 불변식 그대로).
   - 웹: SSE 프로세스가 **전용 pg LISTEN 커넥션 1개**를 상주시켜 NOTIFY 수신 → 기존 `lib/realtime-bus.publish()`로 **재-emit** → `/api/zalo/stream` 구독 로직·브라우저 EventSource **무변경**.
   - 근거: 이미 Postgres 사용 → **Redis 불필요**. 지연 <100ms. 신호 페이로드가 작아 NOTIFY 8KB 한도 무해. 웹 재시작 중 놓친 NOTIFY는 무해(브라우저가 재연결 후 기존 fetch로 재조회 — 신호는 "갱신하라"일 뿐 데이터가 아님). Prisma는 LISTEN 미지원 → 웹에 `pg` Client 직접 사용(1개 상주 커넥션).
   - **대안 비교**: (a) DB 폴링 — 신규 인프라 0이지만 지연·부하 재도입(폴백). (b) 워커→웹 내부 HTTP push(Nike webhook 패턴 재사용) — 동작하지만 웹 URL·가용성에 결합(폴백). LISTEN/NOTIFY는 양쪽이 항상 공유하는 자원(DB)으로 디커플 + 스키마 무변경이라 채택.

3. **아웃바운드 위임 = 워커 내부 발송 API** (ext/send 패턴 재사용)
   - 워커가 **내부 발송 엔드포인트**(`POST /internal/send`, Railway 사설망 `zalo-worker.railway.internal`, 공유 시크릿 인증)를 노출. 발송 계약은 **기존 `/api/zalo/ext/send`의 discriminated union(TEXT/IMAGE/REPLY/REACTION/FORWARD)을 그대로 재사용**.
   - 웹의 아웃바운드 함수(`dispatchOne`의 `sendBotMessage`, `/api/zalo/messages`의 `sendChat*AsAdmin`)는 **얇은 HTTP 클라이언트**로 바뀌어 워커 내부 엔드포인트를 호출한다(시그니처 유지 → 호출부 무변경).
   - **Nike 공개 계약 유지**: Nike는 계속 **웹의 공개 `/api/zalo/ext/send`**를 호출(TLS·도메인·HMAC 불변, ADR-0010 A5). 웹 핸들러가 세션 발송분만 워커 내부 엔드포인트로 **포워딩**한다. (워커를 공개 HTTPS로 노출하지 않아 공격면 증가 0.)

4. **Nike webhook push(villa→Nike) = 워커가 담당**
   - `handleInboundEvent`가 워커로 이동하므로 `pushInboundToNike`도 워커에서 발화(워커→Nike 아웃바운드 POST). 워커 env에 `NIKE_WEBHOOK_URL`·`ZALO_WEBHOOK_HMAC_SECRET` 필요.

5. **ext 읽기 API 분담**
   - **웹 유지(세션 불필요, DB 읽기)**: `ext/threads`, `ext/messages`.
   - **세션을 쓰는 라우트는 워커 위임**: `ext/nickname`·`ext/group-members`·`ext/mark-read` 중 zca-js API(`getGroupInfo`·`markRead` 등)를 호출하는 것은 웹 핸들러가 워커 내부 엔드포인트로 포워딩(구현 시 각 라우트 zca-js 호출 여부 개별 감사 — S2 태스크).

6. **QR 로그인 = 워커로 이동(세션이 거기서 태어나야 함)**
   - 세션은 반드시 보유자(워커)에서 생성돼야 하므로 `startQRLoginForAdmin`은 워커에서 실행. UI는 웹이 서빙 → 웹 `/api/zalo/qr`가 워커 내부 `POST /internal/qr`(및 상태 폴링)로 위임, 워커가 QR base64 반환·credential 저장·세션 상주. `disconnectForAdmin`도 동일 위임.

7. **워치독·멀티관리자 세션 = 워커로 이동**
   - `lib/zalo-health` 인프로세스 setInterval은 풀을 직접 읽으므로 **워커에서** 상주(웹은 워치독 미기동). ADR-0007 관리자 개인계정 풀 전부 워커 소유.

8. **상태 조회(`/api/zalo/status`) = 웹→워커 내부 HTTP**
   - 풀 상태(`getSystemBotStatus`/`getStatusForAdmin`)가 워커에 있으므로 웹 status 라우트는 워커 내부 `/internal/status`를 조회(워커 불통 시 disconnected 표기 — 실패가 안전값).

**스키마 변경: 없음.** LISTEN/NOTIFY·내부 HTTP·상태 조회 모두 스키마 무관(ADR-0010 "villa 스키마 무변경" 유지). 금액/날짜 타입 규칙 무영향.

---

## 3. 무엇을 옮기고 무엇을 남기나 (범위)

| 관심사 | 이동(worker) | 유지(web) |
|---|---|---|
| zca-js 풀·리스너(`connectAllActive`, `handleInboundEvent`, `handleReactionEvent`) | ✅ | — |
| QR 로그인·해제(`startQRLoginForAdmin`, `disconnectForAdmin`) | ✅ | UI만 |
| 실제 발송(`sendVia`, `sendBotMessage`, `sendChat*AsAdmin`, `addReactionAsAdmin`) | ✅ 실행 | 얇은 위임 클라이언트 |
| 워치독(`startZaloHealthWatchdog`) | ✅ | — |
| Nike webhook push(`pushInboundToNike`) | ✅ 발화 | — |
| 인바운드 신호 발행 | ✅ `NOTIFY` | ✅ `LISTEN`→realtime-bus 재emit |
| SSE 엔드포인트(`/api/zalo/stream`) | — | ✅ 무변경 |
| DB(ZaloMessage/Conversation/Account, credential AES-GCM) | 공유 | 공유 |
| ext 읽기(threads/messages) | — | ✅ |
| ext 발송(`/api/zalo/ext/send`) 공개 계약 | 실행 위임 | ✅ 공개 핸들러(→워커 포워딩) |
| 알림 cron 진입점(`/api/cron/notifications`) | — | ✅ (dispatch는 워커 발송 위임) |
| `instrumentation.register()`의 Zalo 기동 | 워커로 | ❌ 웹은 세션 미기동 |

---

## 4. Railway 워커 서비스 런북 (테오 대시보드 작업 — cron 등록 패턴과 동일)

- **서비스 생성**: 같은 레포·같은 배포에서 새 서비스 `zalo-worker` 추가.
- **Start command**: 경량 standalone Node 엔트리(신규 `worker/index.ts` — Next.js 미기동). `lib/zalo-runtime`·`lib/zalo-health`·`lib/zalo-webhook`를 그대로 import + `node:http`로 내부 라우터(`/internal/send`·`/internal/qr`·`/internal/status`·`/healthz`) 구동 + 부팅 시 `connectAllActive()`. 실행 예: `node worker/dist/index.js`(빌드본) 또는 `tsx worker/index.ts`.
- **replica=1 고정**(세션 단일성 불변식 — 절대).
- **env(웹과 공유)**: `DATABASE_URL`, `ZALO_CREDS_KEY`, `NIKE_WEBHOOK_URL`, `ZALO_WEBHOOK_HMAC_SECRET`, `ZALO_EXT_SHARED_SECRET`(내부 발송 시크릿 겸용 또는 별도 `ZALO_WORKER_SECRET`), `ZALO_SYSTEM_OWNER_ID`(폴백), `RAILWAY_ENVIRONMENT_NAME`(워치독 활성 가드). **웹은 워커 내부 URL** `ZALO_WORKER_URL=http://zalo-worker.railway.internal:PORT` 필요.
- **헬스체크**: `/healthz`(200 + 세션 status 요약). Railway health check 경로 설정.
- **로그**: credential·시크릿·전화·본문 절대 미출력 규칙 승계(D6.2).

---

## 5. 밴 위험 없는 마이그레이션 순서 (절대 순서)

> 불변식: **어느 순간에도 {웹 세션, 워커 세션} 중 실제 로그인은 최대 1개.** 둘 다 로그인 = code 3000 = 밴 위험. 양쪽이 **동일 credential(DB)·동일 `ZALO_CREDS_KEY`**를 읽으므로 순서를 어기면 즉시 충돌.

플래그(기본값이 현행 동작 보존): 웹 `ZALO_SESSION_LOCAL`(기본 `true`=현행 웹 기동), 워커 `ZALO_WORKER_CONNECT`(기본 `false`).

1. **양쪽 지원 코드 배포(no-op)** — 웹은 여전히 세션 보유(`ZALO_SESSION_LOCAL=true`), 워커 미생성. 동작 불변 확인.
2. **워커 서비스 생성·기동, 세션 미접속**(`ZALO_WORKER_CONNECT=false`) — 내부 HTTP만 뜨고 로그인 안 함(충돌 0).
3. **핸드오프(무겹침):**
   a. 웹 `ZALO_SESSION_LOCAL=false` → 웹 재시작. 웹 기존 세션 드롭. **이 순간 세션 보유자 0**(마지막 짧은 블랙아웃 — 이후 영구 제거).
   b. **웹이 세션 미보유 상태로 완전히 떴는지 확인**(로그: 리스너 없음, `getSystemBotApi` null).
   c. 워커 `ZALO_WORKER_CONNECT=true` → 워커 기동/재시작 → `connectAllActive()`가 DB credential로 **유일 보유자**로 접속. `/internal/status` connected 확인(credential 유효 시 QR 불필요, 무효 시 워커에서 QR 재로그인).
4. **검증**: 인바운드 저장(워커) → SSE 갱신(NOTIFY→웹) → 웹 채팅 발송(웹→워커) → Nike ext 발송(Nike→웹→워커) → Nike webhook push(워커→Nike) → 워치독(워커). 전부 실측.
5. (후속) 듀얼모드 스캐폴딩 제거.

**핵심 20줄 요약**: ①양쪽지원 코드배포(웹 세션 유지·no-op) ②워커 생성·미접속 ③웹 세션 내림(`ZALO_SESSION_LOCAL=false` 재시작) ④웹 세션 0 확인 ⑤워커 접속(`ZALO_WORKER_CONNECT=true`) ⑥인바운드/SSE/발송/webhook/워치독 실측. **불변식=세션 보유자 항상 ≤1, 새 보유자 올리기 전 옛 보유자 내림 확인.**

**롤백(역순, ADR-0010 "villa 先 내림" 규칙과 동형)**: 워커 `ZALO_WORKER_CONNECT=false`+중지 → **워커 세션 0 확인** → 웹 `ZALO_SESSION_LOCAL=true`+재시작(웹 재접속). 절대 동시 접속 금지.

---

## 6. 구현 태스크 분해 (BE / OPS)

**BE**
- **BE-1** `worker/index.ts` 경량 엔트리: `node:http` 내부 라우터 + 부팅 `connectAllActive()`(플래그 가드) + 워치독 기동 + `/healthz`.
- **BE-2** 내부 발송 API `POST /internal/send`: ext/send의 union 스키마·핸들러 로직 추출·공용화(중복 구현 금지 — `lib/zalo-runtime` 발송 함수 직접 호출). 공유 시크릿 인증(timingSafeEqual).
- **BE-3** 웹 아웃바운드 위임 클라이언트: `sendBotMessage`/`sendChat*AsAdmin` 시그니처 유지, 내부적으로 `ZALO_WORKER_URL`로 POST. `dispatchOne`·`/api/zalo/messages`·`ext/send` 핸들러가 이걸 타게.
- **BE-4** 인바운드 신호: 워커 저장부에서 `NOTIFY zalo_realtime`; 웹 부팅 시 `pg` LISTEN 상주 리스너 → `realtime-bus.publish` 재emit. (`lib/realtime-notify.ts` 신규, 단일 소스.)
- **BE-5** QR/해제 위임: 웹 `/api/zalo/qr`·disconnect → 워커 `/internal/qr`·`/internal/disconnect`. 상태 폴링 경로 포함.
- **BE-6** 상태 위임: 웹 `/api/zalo/status`·`getSystemBotStatus` 호출부 → 워커 `/internal/status`(불통=disconnected).
- **BE-7** ext 세션 라우트 감사: nickname/group-members/mark-read 중 zca-js 호출분 워커 위임.
- **BE-8** `instrumentation.register()` 플래그 가드(`ZALO_SESSION_LOCAL`) — 웹에서 세션 미기동 경로.
- **BE-9** 테스트: 발송 위임 계약·NOTIFY→SSE 신호·듀얼모드 플래그(단위/통합).

**OPS**
- **OPS-1** Railway `zalo-worker` 서비스 생성(같은 레포·start command·replica=1·env 공유·`ZALO_WORKER_URL` 웹 주입·헬스체크). 런북 §4.
- **OPS-2** 마이그레이션 §5 실행(플래그 순서·세션 0 확인 게이트). 롤백 리허설.
- **OPS-3** 알림 cron·워치독 소유 이전 확인(웹 워치독 비활성, 워커 활성).

---

## 7. 리스크

| # | 리스크 | 영향 | 완화 |
|---|---|---|---|
| R1 | 핸드오프 중 웹·워커 동시 접속 | code 3000·밴 | §5 절대 순서(옛 보유자 내림 **확인** 후 새 보유자 접속). 플래그 기본값이 현행 보존 |
| R2 | 웹↔워커 사설망 발송 실패 | 발송 누락 | 워커 불통 시 알림은 PENDING 유지(재시도), 채팅은 502 명시. `ERROR_BOT_NOT_CONNECTED` 계승 |
| R3 | `pg` LISTEN 커넥션 끊김 | SSE 신호 유실 | 재연결 루프 + 폴백: 브라우저 주기적 재fetch(신호 유실=지연일 뿐 데이터 무손실) |
| R4 | 워커 자체 배포 시 블랙아웃 | 짧은 수신 끊김 | 워커는 UI·비즈 변경과 무관 → 재배포 드묾. 잦은 웹 배포 블랙아웃은 제거(핵심 목표 달성) |
| R5 | 시크릿/URL 미설정으로 조용한 no-op | 발송 실패 무감지 | 워커 부팅 시 필수 env 검증·명시 로그. 워치독이 미연결 경보 |
| R6 | 로컬 개발 편의 저하(2서비스) | DX | 로컬은 `ZALO_SESSION_LOCAL=true` 단일 프로세스 유지(워커 미기동 시 웹이 예전처럼 동작 — 듀얼모드가 로컬도 보존) |

---

## 8. 대안 (기각)

- **Redis pub/sub**: 신규 인프라·비용. Postgres LISTEN/NOTIFY로 동일 목적 달성 → 기각(보안 핸드오프 백로그의 Redis 도입 시 재고 가능).
- **웹 replica≥2 + sticky**: 세션 단일성(C1) 위반 → 밴 위험. 불가.
- **세션을 웹에 두고 graceful 재접속만 개선**: 배포 재시작 자체가 원인이라 근본 해결 아님(현행 워치독이 이미 증상 대응). 기각.
- **Nike를 워커 공개 HTTPS로 직결**: 워커 공개 노출 = 공격면↑. 웹을 공개 표면으로 유지하고 내부 포워딩 → 기각.
```
