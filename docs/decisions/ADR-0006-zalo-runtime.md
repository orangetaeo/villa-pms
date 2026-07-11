# ADR-0006: Zalo zca-js 실행 모델 — Railway 장기 세션·credential 영속·전송 계층 교체

> ⚠ 번호 중복: ADR-0006이 두 건 존재한다(본 문서 + `ADR-0006-initial-inspection-gate.md`). 링크 파손 방지를 위해 리네임하지 않고 유지한다. 인용 시 파일명 전체로 구분할 것. 차기 ADR은 0036부터.

날짜: 2026-06-16
상태: 제안 (TDA 설계 — 테오/QA 검토 후 승인 시 INTEG/BE 구현 착수)
관련: ADR-0005(OA→zca-js 채택), 계약 T3.5-zalo-zca-js.md(1단계 설계 산출물), T3.6(tamtru), T3.7(온보딩), T6.6(채팅), reference/nike/src/lib/zalo*.ts, lib/zalo.ts·lib/zalo-chat.ts, prisma/schema.prisma, railway.toml/nixpacks.toml

---

## 결론 요약 (보고용 4문)

**① Railway에서 가능한가 / 대안은?**
가능. `next start` 단일 컨테이너(항상 켜진 Node) 안에서 zca-js WebSocket 리스너를 상주시킨다. Next 15 `instrumentation.ts`의 `register()` 훅에서 부팅 시 1회 자동 재로그인(`connectBot()`)을 호출하는 것이 정석 경로다. 별도 long-running worker(Railway 2번째 서비스)는 **불필요** — Phase 1은 봇 계정 1개뿐이라 메인 컨테이너에 얹는 것이 가장 단순하고, 오히려 별도 서비스로 분리하면 "어느 컨테이너가 세션을 잡는가"라는 단일 인스턴스 문제가 새로 생긴다. **단, Railway replica=1 강제와 헬스체크/재시작 시 세션 끊김 후 자동 재로그인이 전제** (아래 5절). instrumentation에서 외부 호출 없이 zca-js 부팅이 `next start` 프로세스에서 실제로 산다는 점은 프로덕션 1회 실측으로 **검증 필요**(근거는 충분 — Nike가 같은 구조로 운영 중).

**② 스키마 변경 규모**
작다. 신규 모델 **`ZaloAccount` 1개 추가**(봇 계정 credential 암호화 저장). 기존 `ZaloConversation`/`ZaloMessage`/`Notification`/`User.zaloUserId`는 **구조 변경 없음** — 전부 additive. `prisma db push` 안전(현재 프로젝트 방침과 동일, 기존 데이터 파괴 없음). Nike의 멀티유저 풀 모델(userId별 N개 계정)은 **이식하지 않는다** — villa-pms는 봇 1개뿐이라 `ZaloAccount`는 사실상 단일 행(singleton).

**③ 가장 큰 리스크**
**Railway 재배포/크래시/OOM 시 메모리상 WebSocket 세션이 전부 사라진다.** credential은 DB에 있으므로 재부팅 후 instrumentation이 자동 재로그인하면 복구되지만, (a) 재로그인이 실패하면(쿠키 만료·Zalo 정책) 모든 알림이 조용히 큐에 쌓이기만 하고, (b) `next start`가 빌드/배포 중에는 잠깐 죽으며, (c) **같은 봇 계정이 두 컨테이너에서 동시 로그인하면 밴 위험**(Zalo는 동시 세션을 적대시 — Nike 코드의 `closed code 3000` = "다른 곳에서 열림"이 그 증거). → replica=1 강제 + 끊김 감지 시 ADMIN Web Push 경보가 필수 완화책.

**④ 권장 1차 구현 범위 (MVP)**
`ZaloAccount` 모델 + credential 암호화 + **QR 로그인 → 연결 상태 표시**까지만. 즉 "테오가 `/settings/zalo`에서 QR 스캔 → connected → DB에 credential 저장 → 재시작 후 자동 재로그인" 루프를 먼저 닫는다. 수신 리스너 저장과 발송 전환(dispatchPendingNotifications 내부 교체)은 그 다음 단계. 발송은 **기존 `enqueueNotification`/`dispatchPendingNotifications` 시그니처를 100% 유지**하고 내부 전송 함수만 `sendZaloText(OA)` → zca-js로 갈아끼운다(호출부 무변경).

---

## 맥락

ADR-0005에서 Zalo OA를 폐기하고 zca-js(개인 계정 QR 로그인)를 채택했다. 그러나 ADR-0005는 "전송 계층 정본은 Nike 코드"라고만 했고 **실행 모델(누가 WebSocket을 상주시키는가)·스키마·교체 경로**는 T3.5 실연동 시 TDA가 결정하기로 미뤘다. 본 ADR이 그 결정이다.

현재 상태:
- `lib/zalo.ts`: OA REST 전송(`sendZaloText` → `openapi.zalo.me`). 큐(`enqueueNotification`)·배치(`dispatchPendingNotifications`)·재시도(payload._attempt, 3회)·본문 빌더(`buildNotificationText`, 8종 vi 알림 + tamtru)·미러 기록까지 구현됨. **전송 함수만 실동작 불가**(OA 토큰 없음).
- `lib/zalo-chat.ts`: 48h 응답 창 판정(`isReplyWindowOpen`). ADR-0005에서 개인계정은 48h 제약 없음 → **이 로직은 사용 중단**(파일 즉시 삭제는 안 함, 5절 참조).
- 스키마: `ZaloConversation`(zaloUserId @unique, userId? @unique, lastInboundAt)·`ZaloMessage`(direction/source/msgType/zaloMsgId @unique)·`Notification`(channel/payload Json/status)·`User.zaloUserId @unique`. **credential 저장소 없음**.
- 인프라: Railway nixpacks, Node 20, `npm start`(=`next start`), 헬스체크 `/api/health`, `restartPolicyType=on_failure`. **`instrumentation.ts` 없음**. cron 4종은 `Bearer CRON_SECRET` 인증의 HTTP 라우트(외부 스케줄러가 호출하는 구조).

핵심 차이 (Nike vs villa-pms):
| | Nike | villa-pms |
|---|---|---|
| 계정 모델 | **멀티유저 풀** — 직원마다 자기 Zalo 로그인 | **봇 1개** — 테오 개인 Zalo만 |
| 대화 상대 | 각자 친구/그룹 | 봇 ↔ 공급자 N명(친구) |
| 풀 키 | `userId`(앱 사용자)별 인스턴스 | 봇 계정 1개(고정 키) |

→ **Nike의 `zalo-pool.ts`(멀티유저 Map)를 그대로 이식하지 않는다.** villa-pms는 "봇 1개"가 본질이므로, 풀 추상화를 제거한 단일 인스턴스 매니저(`lib/zalo-runtime.ts`, 가칭)로 단순화한다. Nike 코드는 메시지 파싱(`parseMessageContent`)·에코 dedup·리스너 셋업·credential 암복호화처럼 **계정 수와 무관한 부분만 발췌 이식**한다.

---

## 결정

### D1. 실행 모델 — instrumentation.ts 부팅 + 메인 컨테이너 상주 (worker 분리 안 함)

1. **`instrumentation.ts`(프로젝트 루트) 신설**, `register()`에서 `process.env.NEXT_RUNTIME === "nodejs"`일 때만 `connectBot()`를 fire-and-forget 호출. Edge/빌드 런타임에서는 실행 금지.
2. `connectBot()`은 DB에서 활성 `ZaloAccount`(봇) credential을 로드 → `zalo.login(credentials)` → 성공 시 WebSocket 리스너 `listener.start({ retryOnClose: true })`. credential 없으면 조용히 종료(QR 로그인 대기 상태).
3. WebSocket 리스너는 `next start` Node 프로세스 안에서 산다 — Next.js route handler·instrumentation은 같은 프로세스를 공유하므로 `globalThis`에 보관한 API 인스턴스를 라우트(발송·상태조회)에서 접근 가능.
4. **globalThis 보관 패턴 유지**(Nike `globalForPool` 차용) — 개발 모드 HMR/핫리로드와 instrumentation 중복 호출에도 인스턴스가 1개만 살아남도록. 단 Map이 아닌 단일 슬롯(`globalThis.zaloBot`)으로 단순화.
5. **worker 분리 기각**: Railway 2번째 서비스로 빼면 (a) 컨테이너가 2개가 되어 단일 로그인 보장이 더 어려워지고, (b) 발송 라우트(컨테이너 A)와 세션(컨테이너 B)이 분리돼 IPC가 필요해진다. 봇 1개·발송량 적은 Phase 1에선 과설계. **재검토 트리거**: 컨테이너 메모리가 zca-js 상주로 OOM 재시작을 반복하거나, Zalo 세션이 HTTP 트래픽 부하로 끊기는 패턴이 관측되면 그때 분리(IDEAS.md 등록).

> **검증 필요(프로덕션 1회 실측)**: ① instrumentation `register()`가 `next start`에서 실제 1회 실행되는지 ② WebSocket이 헬스체크/유휴 트래픽 중에도 끊기지 않고 유지되는지 ③ Railway가 컨테이너를 슬립시키지 않는지(Railway는 기본적으로 슬립 없음 — 단 플랜 확인). 근거: Nike가 동일 `next start`+globalThis 구조로 운영 중이므로 위험은 낮음.

### D2. 단일 인스턴스 보장 — Railway replica=1 강제 + 동시 로그인 가드

1. **Railway 서비스 replica=1 고정**(수평 스케일 금지). railway.toml/대시보드에 명시, OPS 배포 체크리스트에 추가. 같은 봇 계정이 2 컨테이너에서 로그인하면 밴 위험(ADR-0005 리스크 ②).
2. 앱 내 가드: `connectBot()`은 `connectPromise` mutex(Nike `connectAllUsers` 패턴)로 동시 호출 시 1회만 로그인. instrumentation·라우트 자동재연결이 겹쳐도 이중 로그인 방지.
3. `listener.on("closed", code => code === 3000)` 감지 시 status=`error` + "다른 곳에서 로그인됨" 기록 → ADMIN 경보. (재배포 순간의 일시적 2-컨테이너 중첩은 Railway가 구컨테이너를 곧 종료하므로 허용 범위로 보되, code 3000 빈발 시 조사.)

### D3. 스키마 — `ZaloAccount` 1개 추가 (additive)

```
model ZaloAccount {
  id            String    @id @default(cuid())
  zaloUserId    String    @unique   // 봇 계정의 Zalo own id (login 성공 후 getOwnId)
  userId        String?   @unique   // 봇을 소유한 ADMIN(테오) User.id — 소유권 검증용
  user          User?     @relation(fields: [userId], references: [id], onDelete: SetNull)
  credentials   String?              // AES-256-GCM 암호문 (imei+cookie+userAgent) — 절대 평문/응답/로그 금지
  displayName   String?
  isActive      Boolean   @default(true)
  lastConnected DateTime?
  createdAt     DateTime  @default(now())

  @@index([isActive])
}
```
- `User`에 `zaloAccount ZaloAccount?` 역관계 1줄 추가.
- Nike 모델과 동일 형태로 두어 `zalo-credentials.ts` 이식 시 쿼리 무수정 재사용(`upsert where zaloUserId` 등). 단 villa-pms는 사실상 **단일 행**(봇 1개) — `loadAllActiveCredentials`는 0~1건만 반환.
- **기존 모델 무변경**: `User.zaloUserId`(공급자=봇의 친구 id), `ZaloConversation.zaloUserId`(대화 상대=공급자), `ZaloMessage`, `Notification` 전부 그대로. → `ZaloAccount.zaloUserId`(봇 자신) vs `User.zaloUserId`(공급자)·`ZaloConversation.zaloUserId`(공급자)는 **의미가 다르다**(봇 vs 상대). 컬럼명이 겹쳐 혼동되므로 코드 주석·필드 설명에 명시.
- **마이그레이션**: 신규 테이블 1개 + FK 1개 → 순수 additive. `prisma db push` 안전(현 프로젝트 방침). 기존 행 영향 0. **`prisma migrate dev`로 전환 시점이면 본 모델을 첫 마이그레이션에 포함** — TDA 검토 후 BE 실행.

### D4. 봇 ↔ 대화 상대 구분 (1:N)

- **봇 = `ZaloAccount` 단일 행**(테오 개인 Zalo). credential·세션·리스너의 주체.
- **대화 상대 = `ZaloConversation` N행**(공급자별, `zaloUserId`=공급자의 Zalo id). 봇이 수신/발신하는 상대.
- **발송 대상 해석**: `Notification.userId`(공급자 User) → `User.zaloUserId`(그 공급자의 Zalo id) → zca-js `api.sendMessage(text, zaloUserId, ThreadType.User)`. 즉 발송 시 봇 계정으로 로그인한 1개 API가 N명에게 보낸다. 기존 `dispatchOne`의 "`notification.user.zaloUserId`로 발송" 흐름과 **완전히 동일** — OA `sendZaloText(zaloUserId, …)`를 zca-js `api.sendMessage(…, zaloUserId, …)`로 바꾸기만 하면 됨.
- 온보딩(T3.7): 공급자가 봇을 **친구추가** → 봇이 첫 수신 메시지에서 전화번호 매칭 → `User.zaloUserId` 채움(ADR-0005 결정 4). webhook 대신 zca-js `listener.on("message")` 이벤트로 처리.

### D5. 기존 코드 교체 — 시그니처 유지, 전송 계층만 교체

1. **`lib/zalo.ts`의 큐·배치·재시도·본문 빌더·미러 기록은 보존**. `enqueueNotification`·`dispatchPendingNotifications`·`buildNotificationText`·`getAttemptCount`/`isRetryableFailure` 등 **export 시그니처 무변경** → T3.5(8종)·T3.6(tamtru)·cron/notifications·호출부 전부 무수정.
2. **교체 대상은 단 한 곳**: `dispatchOne` 내부의 `sendZaloText(zaloUserId, text, token)` 호출 → 신규 `sendBotMessage(zaloUserId, text)`(zca-js 경유). 토큰 인자 제거.
3. **세션 계층은 신규 파일 `lib/zalo-runtime.ts`로 분리**(Nike `zalo-pool.ts`의 단일 인스턴스 축약판): `connectBot`/`startBotQRLogin`/`getBotStatus`/`getBotApi`/`disconnectBot`/`sendBotMessage`/`sendBotImage`. `lib/zalo-credentials.ts`는 Nike에서 거의 그대로 이식(쿼리 동일, `ZaloAccount` 사용).
4. **에러 상수 의미 갱신**: `ERROR_TOKEN_NOT_SET`(OA 토큰 미설정) → `ERROR_BOT_NOT_CONNECTED`(봇 미연결/세션 만료)로 의미 전환. 단 **attempt 미증가·자동 회복 동작은 동일**(봇 재로그인 후 다음 cron에서 자동 발송). `ERROR_NO_ZALO_LINK`(공급자 zaloUserId 없음, 영구 실패)는 그대로 유지.
5. **`lib/zalo-chat.ts`(48h 창)**: ADR-0005대로 개인계정은 제약 없음 → b14 입력창은 항상 활성. `isReplyWindowOpen`은 **호출부에서 분리**(항상 true 취급)하되 파일·`ZaloConversation.lastInboundAt` 컬럼은 즉시 삭제하지 않음(불필요한 스키마 변경 회피, 추후 정리). T6.6 채팅 발송도 `sendBotMessage` 경유로 통일.
6. **미러 기록 보강**: 현재 `dispatchOne`은 텍스트만 발송. zca-js는 이미지 실발송 가능 → T3.6 여권 사진을 `sendBotImage`로 **실제 전송**(현재는 URL 증빙만). 이는 단계 4(발송 전환) 이후 단계로 분리.

### D6. credential 암호화·보안

1. **`ZALO_CREDS_KEY` 환경변수**(Railway)에서 scrypt 파생 → AES-256-GCM(`iv:authTag:ciphertext` 형식). Nike `zalo-credentials.ts` 그대로. `.env.example`·CLAUDE.md 환경변수 목록에 추가(ADR-0005에서 이미 선언).
2. **노출 차단 규칙(절대)**:
   - credential 평문/암호문을 **API 응답에 절대 미포함**. `/api/zalo/status`는 `{ connected, status, displayName }`만 반환.
   - **AuditLog·로그·SSE에 credential 절대 미기록**. QR 로그인 성공 시 AuditLog는 `{ action: CONNECT, entity: ZaloAccount, entityId, changes: { displayName } }`만(credentials 필드 절대 금지). zalo-credentials의 decrypt 실패 로그도 userId/accountId만 출력(현 Nike 코드 준수).
   - `ZaloAccount.credentials`는 **select에서 기본 제외**(명시적으로만 로드). Prisma findUnique 시 `select`로 필요한 필드만.
   - git: credential은 DB에만. `qr.png`(zca-js loginQR이 임시 생성) **.gitignore 추가**.
3. **QR 로그인 라우트 권한**: ADMIN(테오)만. 세션 role 검사 + `ZaloAccount.userId == session.userId` 소유권 검증(Nike route.ts 패턴). SUPPLIER/CLEANER 접근 차단.

---

## 단계 분해 (구현 순서 + 검증)

| 단계 | 범위 | 산출 | 검증 방법 |
|---|---|---|---|
| **S0** | 스키마 | `ZaloAccount` 모델 + `prisma db push` | studio에서 테이블 확인, 기존 데이터 무손상 |
| **S1 (MVP)** | QR 로그인 + credential 영속 | `lib/zalo-runtime.ts`(connect/QR/status)·`lib/zalo-credentials.ts` 이식, `/settings/zalo` QR 화면, `/api/zalo/status`·`/api/zalo/qr` | 로컬에서 테오 폰으로 QR 스캔 → connected → `ZaloAccount`에 암호문 저장 확인(평문 아님) |
| **S2** | 재시작 자동 재로그인 | `instrumentation.ts` `register()`→`connectBot()`, globalThis 가드, replica=1 | 로컬 재시작 후 자동 connected. **프로덕션 1회 실측**(D1 검증 항목) |
| **S3** | 수신 리스너 | `listener.on("message")`→ `ZaloConversation`/`ZaloMessage` 저장(파싱·에코 dedup Nike 발췌), 전화번호 매칭(T3.7) | 테스트 계정→봇 메시지 발송 → b14 `/messages`에 실시간 표시, `zaloMsgId` 멱등성(중복 저장 0) |
| **S4** | 발송 전환 | `dispatchOne` 내부 `sendZaloText`→`sendBotMessage`, 에러 상수 의미 전환, cron 무변경 | enqueue 8종 + tamtru → cron 호출 → 테스트 계정이 실수신, Notification SENT 전환, 호출부 무변경(vitest 회귀 0) |
| **S5** | 이미지·번역 | 여권 사진 `sendBotImage` 실발송(T3.6), 수신 vi→ko Gemini 번역(b14) | 여권 이미지 실수신, 번역 캐시(`translatedText`) 저장 |
| **S6** | 끊김 경보 | `closed`/`error` 감지 → ADMIN Web Push, `/settings/zalo` 상태 배지 | 봇 강제 로그아웃 → 경보 도달 + 재QR 안내 |

각 단계는 QA 독립 검증(작업자 자기평가 무효, CLAUDE.md 작업 사이클). credential 누수 검사(.claude/skills/qa/leak-checklist)는 S1·S4에서 필수.

---

## 리스크와 완화책

| # | 리스크 | 완화책 | 단계 |
|---|---|---|---|
| ① | 재배포/크래시/OOM 시 WebSocket 세션 소실 | instrumentation 자동 재로그인(credential은 DB 영속) + `restartPolicyType=on_failure` 유지 | S2 |
| ② | 자동 재로그인 실패(쿠키 만료·정책) → 알림 조용히 큐 적체 | `ERROR_BOT_NOT_CONNECTED`로 큐 보존(소실 없음) + S6 끊김 경보 + 재QR 운영 문서화(ops) | S4·S6 |
| ③ | **동시 2-컨테이너 로그인 밴** | replica=1 강제 + connectPromise mutex + code 3000 감지 | S2 |
| ④ | 개인 계정 발송 스로틀·밴(ADR-0005 ②) | 기존 재시도 백오프(3회)·발송량 적음·일일 상한(추후). 본 ADR 범위 밖 — 기존 큐 구조가 흡수 | S4 |
| ⑤ | instrumentation이 `next start`에서 미실행/세션 미유지 | 프로덕션 1회 실측(D1). 실패 시 폴백: cron이 매 호출 시 `ensureBotConnection()` 호출(연결 보장을 발송 시점으로 이동) — worker 분리보다 단순 | S2 |
| ⑥ | credential 노출 | D6 다층 차단(응답·로그·AuditLog·select 제외·.gitignore qr.png) + QA leak 검사 | S1·S4 |
| ⑦ | zca-js 비공식 라이브러리 중단(ADR-0005 ①) | 버전 고정, 큐 잔존으로 수동 처리 가능 | — |

---

## 영향 범위

- **스키마**: `ZaloAccount` 모델 추가 + `User.zaloAccount` 역관계 1줄. additive, `db push` 안전.
- **신규 파일**: `instrumentation.ts`, `lib/zalo-runtime.ts`, `lib/zalo-credentials.ts`(이식), `app/api/zalo/qr/route.ts`·`status/route.ts`, `app/(admin)/settings/zalo/` 화면.
- **수정 파일**: `lib/zalo.ts`(`dispatchOne` 전송 함수 1줄 교체 + 에러 상수 의미 전환 — 시그니처 무변경), `lib/zalo-chat.ts`(호출부에서 분리), `railway.toml`/OPS 체크리스트(replica=1), `.gitignore`(qr.png), `.env.example`/CLAUDE.md(`ZALO_CREDS_KEY`).
- **무변경 보장**: `enqueueNotification`/`dispatchPendingNotifications`/`buildNotificationText` 시그니처, T3.5 8종·T3.6 tamtru·T6.6 채팅 호출부, cron/notifications 라우트, `Notification`/`ZaloConversation`/`ZaloMessage`/`User.zaloUserId` 스키마.
- **환경변수**: `ZALO_CREDS_KEY` 추가(ADR-0005에서 선언). `ZALO_OA_ACCESS_TOKEN`/`ZALO_APP_ID`/`ZALO_APP_SECRET` 제거(ADR-0005). `CRON_SECRET` 유지.
- **태스크**: T3.5(전송 zca-js 전환), T3.6(여권 이미지 실발송), T3.7(친구추가 이벤트 온보딩), T6.6(48h 제거).

## 미결(구현 단계에서 확정)

- instrumentation `register()`의 `next start` 실제 실행·세션 유지 — **프로덕션 1회 실측**(폴백: ensureBotConnection 발송 시점 보장).
- Railway 컨테이너 슬립 정책(플랜 확인) — 슬립 발생 시 외부 핑/cron으로 보온.
- zca-js 버전 핀(reference/nike의 package.json 버전과 일치).
- `prisma migrate dev` 전환 시 `ZaloAccount`를 첫 마이그레이션에 포함할지(현 `db push` 방침).

---

## 결과

- ADR-0005의 "스키마 변경 없음(TDA 검토 보류)"이 본 ADR로 확정: **`ZaloAccount` 1개 additive 추가**.
- 실행 모델 확정: **instrumentation 부팅 + 메인 컨테이너 상주 + replica=1**, worker 분리 안 함(트리거 시 IDEAS.md 재검토).
- 1차 구현 범위: **S0~S2(QR 로그인 + credential 영속 + 자동 재로그인)**. 발송 전환(S4)은 호출부 무변경으로 후속.
- 승인 시 PM 보고 → BE/INTEG에 S0(스키마 마이그레이션) 지시.
