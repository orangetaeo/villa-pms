# ADR-0007: 멀티 관리자 개인 Zalo 채팅 — 시스템 봇 1개 + 관리자별 개인 계정 풀

날짜: 2026-06-16
상태: 제안 (TDA 설계 — 테오/QA 검토 후 승인 시 INTEG/BE 구현 착수)
관련: ADR-0006(단일 봇 런타임 — 본 ADR이 멀티로 확장), ADR-0005(zca-js 채택), ADR-0003(ZaloConversation/ZaloMessage·SYSTEM 미러), SPEC F5(시스템 알림 8종+tamtru)·F7(관리자), reference/nike/src/lib/zalo-pool.ts(원본 멀티유저 풀), lib/zalo-runtime.ts·lib/zalo-credentials.ts·lib/zalo-inbound.ts·lib/zalo.ts, app/(admin)/messages/·settings/zalo/·api/zalo/, prisma/schema.prisma, CLAUDE.md 사업원칙 1·2(재고·마진 비공개)

---

## 결론 요약 (보고용)

**① 스키마 변경 규모 — 중간(additive 1줄 + unique 제약 1건 변경 + 컬럼 2~3개 추가).**
신규 모델은 **없다**. 핵심은 세 가지: (a) `ZaloAccount`에 `kind`(SYSTEM_BOT|ADMIN_PERSONAL) 구분 + `userId`를 nullable→**필수**로(관리자별 1계정), (b) `ZaloConversation`에 `ownerAdminId`(FK User) 추가 + **`zaloUserId @unique` 제약을 `@@unique([ownerAdminId, zaloUserId])` 복합키로 교체**(같은 공급자가 관리자 A·B와 각각 별도 대화), (c) `User.zaloAccount` 1:1 역관계를 1:N 또는 명명 분리. (b)의 unique 제약 교체가 **유일한 비-additive 변경**이며 기존 데이터 백필이 필요하다(아래 ⑥·D6). 시스템 봇 발송 경로(`Notification`/`dispatchOne`)·`User.zaloUserId`(공급자 id, 전역)는 **구조 무변경**.

**② 런타임 멀티 전환 난이도 — 낮음~중간. Railway 한계는 Phase 1에서 비제약.**
난이도는 낮다 — Nike `zalo-pool.ts`가 이미 `Map<userId, instance>` 풀의 정본이고, ADR-0006이 그것을 단일 슬롯으로 *축약*한 것을 **되살리면** 된다(getOrCreateInstance·connectAllUsers·connectUser·ensureConnectionForUser 패턴 그대로). `getBotApi()` → `getApiForAdmin(adminUserId)`, 시스템 발송은 `getSystemBotApi()`로 분기. **Railway 단일 컨테이너에 N개 WebSocket 상주**: Phase 1 관리자는 **2~4명**으로 예상(테오 + 직원 소수) — 계정당 zca-js 세션 1개 ≈ 수십 MB 수준, 4세션은 메모리·CPU 모두 여유. replica=1은 그대로 유지(각 개인 계정도 단일 세션이어야 밴 방지). **N이 10을 넘기면**(관리자 급증) 그때 worker 분리/계정 샤딩을 재검토(IDEAS.md). 즉 Phase 1은 "풀 부활 + replica=1"로 충분.

**③ 가장 큰 리스크 — `ZaloConversation` unique 제약 교체와 수신 귀속의 정합성.**
현재 `zaloUserId @unique`는 "공급자 1명 = 대화 1개(전역)"를 강제한다. 멀티에선 "관리자 A의 대화"와 "관리자 B의 대화"가 **물리적으로 다른 행**이어야 하므로 이 제약을 깨야 하는데, (a) 깨는 순간 `saveInboundMessage`의 `upsert({ where: { zaloUserId } })`·`dispatchOne`의 미러 `findUnique({ where: { zaloUserId } })`가 **전부 깨진다**(복합키로 동시 수정 필수 — 누락 시 런타임 오류 또는 잘못된 관리자에게 귀속). (b) **수신 메시지가 어느 관리자 계정으로 들어왔는지**를 리스너 인스턴스의 소유 adminUserId로 정확히 태깅해야 한다 — 여기서 실수하면 관리자 A의 공급자 메시지가 B 대화에 저장되어 **사업원칙 위반(타 관리자 대화 누수)**. 누수 차단(`where ownerAdminId = session.user.id`)은 단순하나, 데이터 *생성* 시점의 귀속 오류는 조용히 누적되므로 더 위험하다. → S1에서 복합키 마이그레이션과 수신 귀속을 한 묶음으로 검증해야 한다.

**④ 권장 단계 + 디자인 필요 화면.**
점진 경로: **S0**(스키마: kind·ownerAdminId·복합 unique + 기존 데이터를 테오 시스템봇으로 백필) → **S1**(풀 부활 `lib/zalo-pool.ts`, 시스템/개인 분리 라우팅 — *시스템 발송은 무변경 보장*) → **S2**(개인 계정 QR 로그인 화면 분리 + connectAllUsers 부팅) → **S3**(/messages 개인 스코프 + 수신 귀속) → **S4**(시스템 미러 귀속 정리 + 끊김 경보). **기존 단일봇(시스템 알림 8종+tamtru)은 S0~S4 내내 한 번도 깨지지 않는다** — 시스템 발송은 `getSystemBotApi()`로 전용 분기되며 그 인스턴스는 현재 테오 봇과 동일.
디자인 필요 화면(DESIGN 인계): (1) **`/settings/zalo` 분리** — "시스템 봇 연결"(테오 전용, 기존 화면 거의 재사용) + "내 Zalo 연결"(관리자 본인 개인 계정, **신규 카드/상태 배지**), (2) **`/messages` 빈 상태** — "내 Zalo가 연결되지 않음 → 연결하기" 안내(신규), (3) `/messages` 본문은 b14 재사용(데이터만 개인 스코프, 디자인 무변경). 상세는 9절.

---

## 맥락

ADR-0006은 "봇 1개·`globalThis.zaloBot` 단일 슬롯·instrumentation 부팅"으로 확정했고 그 위에 S0~S6(스키마·QR·자동재로그인·수신·발송)이 구현되어 운영 중이다(`lib/zalo-runtime.ts`, `lib/zalo-credentials.ts`, `lib/zalo-inbound.ts`, `lib/zalo.ts`, `instrumentation.ts`, `app/(admin)/messages/`, `app/(admin)/settings/zalo/`).

본 ADR의 과제는 테오가 확정한 두 요구를 만족시키는 것이다:
1. **시스템 알림(F5 8종 + tamtru)은 테오 봇 1개 계정으로만 발송** — ADR-0006의 발송 경로(`enqueueNotification`→cron→`dispatchPendingNotifications`→`dispatchOne`→`sendBotMessage`) **무변경 유지**.
2. **관리자 채팅(/messages, b14)은 완전 개인** — 각 ADMIN이 자기 개인 Zalo를 QR 로그인하고 **자기 Zalo로 받은 대화만** 본다(카카오톡 모델). 관리자 A의 대화를 관리자 B는 못 본다.

핵심 통찰: villa-pms는 ADR-0006에서 "봇 1개가 본질"이라며 Nike 풀을 단일로 축약했다. 그러나 테오 요구 2는 **Nike의 원래 멀티유저 풀 모델 그 자체**다(직원마다 자기 Zalo, 각자 친구/대화). 따라서 본 ADR은 ADR-0006의 축약을 *부분적으로 되돌려* **두 모델을 공존**시킨다:

| | 시스템 봇 (요구 1) | 관리자 개인 채팅 (요구 2) |
|---|---|---|
| 계정 수 | 1 (테오 시스템봇) | N (관리자마다 1개) |
| 인스턴스 | 풀 내 고정 키 1개 | 풀 내 adminUserId별 1개 |
| 용도 | F5 알림 단방향 발송 | b14 양방향 채팅 |
| 대화 상대 | 공급자(친구추가) | 각 관리자의 Zalo 친구(공급자·기타) |
| ADR-0006 대비 | 그대로 | 신규(축약 복원) |

→ **풀은 다시 `Map<adminUserId, instance>`가 되고, 시스템 봇은 그 풀의 특별한 한 항목**이다(테오 = 시스템봇 소유자이자 자기 개인 채팅 계정이기도 함, 아래 D1 참조).

현재 구현의 멀티 전환 영향점(코드 정독 결과):
- `lib/zalo-runtime.ts`: `globalThis.zaloBot`(단일), `connectBot()`(0~1건 `loadCredentials`), `getBotApi()`(단일), `startBotQRLogin(ownerUserId)`(이미 ownerUserId 인자 받음 — 멀티 친화적), `handleInboundEvent`(inst.ownId로 에코 판정 — 인스턴스별로 분리됨), `sendBotMessage`(`getBotApi()` 단일 사용).
- `lib/zalo-credentials.ts`: `loadCredentials()`가 `findFirst({ where: { isActive } })`로 **1건만** 반환 — 멀티에선 `loadAllActiveCredentials()`(N건) + `loadCredentialsForAdmin(adminUserId)`로 분기 필요. `saveCredentials`는 `upsert({ where: { zaloUserId } })` — 봇 자신의 Zalo id 기준이므로 멀티에서도 유효(각 관리자 봇 id가 다름).
- `lib/zalo-inbound.ts`: `saveInboundMessage`가 `upsert({ where: { zaloUserId: senderZaloUserId } })` — **여기가 핵심 변경점**(복합키 + ownerAdminId 인자). 전화번호 매칭(`tryMatchSupplierByPhone`)은 `User.zaloUserId` 전역 점유 — **개인 채팅 매칭과 시스템 온보딩 매칭의 의미 충돌**(D4 참조).
- `lib/zalo.ts` `dispatchOne`: `sendBotMessage(zaloUserId, text)` 호출 + 미러 `findUnique({ where: { zaloUserId } })` — **시스템 봇 전용 분기 + 미러 대상 대화 복합키 처리** 필요.
- `app/(admin)/messages/page.tsx`: `zaloConversation.findMany`가 **전역 조회**(스코프 없음) — `where: { ownerAdminId: session.user.id }` 필수.
- `app/api/zalo/messages/route.ts`: `sendBotMessage` 단일 사용 — `getApiForAdmin(session.user.id)` 경유로 본인 계정 발송.
- `app/api/zalo/qr/route.ts`·`status/route.ts`: 단일 봇 대상 — 시스템봇용/개인용 분리 또는 파라미터화.

---

## 결정

### D1. 봇 계정 구분 — `ZaloAccount.kind` (시스템봇 vs 관리자 개인)

**테오는 시스템봇과 자기 개인 채팅 계정을 분리한다(권고).** 즉 ZaloAccount 행이 둘이 될 수 있다:
- `kind = SYSTEM_BOT`: F5 알림 발송 전용 계정. `userId`는 소유 ADMIN(테오). **풀 내 고정 키 = `"__system__"`**(adminUserId가 아닌 예약 키)로 상주.
- `kind = ADMIN_PERSONAL`: 각 관리자(테오 포함)의 개인 채팅 계정. **풀 내 키 = adminUserId**.

근거(분리 권고):
1. **밴 격리** — 시스템 봇은 대량 단방향 발송(밴 위험 高, ADR-0005 ②), 개인 채팅은 소량 양방향. 한 계정이 둘 다 하면 발송 패턴이 섞여 밴 시 알림+채팅이 동시 마비. 분리하면 개인 채팅 계정이 죽어도 시스템 알림은 산다.
2. **세션 충돌** — 같은 Zalo 계정을 같은 컨테이너에서 두 인스턴스(시스템 발송용 + 채팅용)로 로그인하면 code 3000(DuplicateConnection) 밴. 분리하면 각각 단일 세션.
3. **번호 매칭 의미 분리**(D4) — 시스템봇이 받는 친구추가(→ `User.zaloUserId` 전역 채움, 온보딩)와 개인 계정 대화는 목적이 다르다.

**테오 결정 (2026-06-16): Phase 1은 "통합" — 테오 개인 Zalo 1개를 시스템봇 겸 본인 채팅 계정으로 사용. 나중에 분리.**
- Phase 1: 테오 계정은 `kind = SYSTEM_BOT` 단일 행. 풀의 `"__system__"` 인스턴스를 **테오의 개인 채팅 스코프로도 노출**(단일 계정 모드). 같은 계정을 두 인스턴스로 로그인하지 않으므로 code 3000 회피(인스턴스 1개를 시스템 발송+테오 채팅이 공유).
- 다른 관리자(나중에 추가 시)는 `kind = ADMIN_PERSONAL` 개인 계정으로 각자 로그인 — 멀티풀·개인 스코프는 이들을 위해 그대로 구현한다(테오만 통합 예외).
- **나중에 분리 시**: 테오용 `ADMIN_PERSONAL` 계정을 추가 로그인하면 자동으로 분리 모드 전환(시스템봇은 발송 전용, 개인 계정은 채팅 전용). 스키마·라우팅이 이미 분리를 지원하므로 코드 변경 없이 계정 추가만으로 가능 — `kind` 플래그를 미리 두는 이유.
- 위 1·2 리스크(밴 격리·세션 충돌)는 분리 전까지 수용. Phase 1 발송량이 적어 실위험 낮음(ADR-0005 ②).

**라우팅 분리(확정):**
- 시스템 발송(`dispatchOne`): 항상 `getSystemBotApi()` → 풀의 `"__system__"` 인스턴스. 개인 계정 풀과 무관.
- 채팅 발송(`/api/zalo/messages`): `getApiForAdmin(session.user.id)` → 로그인한 관리자 본인 인스턴스.

### D2. 런타임 — 단일 슬롯 → `Map<adminUserId, instance>` 풀 부활

1. **`lib/zalo-pool.ts` 신설**(Nike 정본의 villa-pms 적응판) — `globalThis.zaloPool: Map<string, ZaloInstance>`. 키는 adminUserId(개인) 또는 `"__system__"`(시스템봇). `lib/zalo-runtime.ts`의 단일 슬롯 함수들은 이 풀 위 얇은 래퍼로 재구성하거나 풀로 흡수.
2. **공개 API 재구성:**
   - `getApiForAdmin(adminUserId): API | null` — 개인 계정(채팅 발송·조회).
   - `getSystemBotApi(): API | null` — 시스템봇(알림 발송). 내부적으로 `getInstance("__system__")`.
   - `getStatusForAdmin(adminUserId)` / `getSystemBotStatus()` — credential 미포함 상태(D7 보안 유지).
   - `startQRLoginForAdmin(adminUserId)` — 개인 계정 QR(키=adminUserId). `startSystemBotQRLogin(ownerAdminId)` — 시스템봇 QR(키=`"__system__"`, 소유자만).
   - `connectAllAccounts()` — 부팅 시 활성 계정 전부 순차 로그인(Nike `connectAllUsers`). instrumentation에서 `connectBot()` → `connectAllAccounts()`로 교체.
   - `ensureConnectionForAdmin(adminUserId)` — 발송/조회 직전 지연 연결(세션 끊김 자가 복구).
3. **인스턴스별 격리 유지** — 에코 dedup(`inst.ownId`), `connectPromise` mutex, 리스너 핸들러는 Nike처럼 인스턴스 클로저로 분리(현재 `lib/zalo-runtime.ts`의 `handleInboundEvent(inst, …)`는 이미 inst를 받으므로 이식 용이).
4. **Railway replica=1 유지** — 각 계정이 단일 세션이어야 code 3000 밴 방지(ADR-0006 D2 그대로). 멀티 계정 ≠ 멀티 컨테이너. **각 개인 계정도 동시 2-세션 금지.**
5. **부팅 부하** — `connectAllAccounts`는 Nike처럼 **순차**(병렬 금지 — Zalo API 과부하·동시 로그인 트리거 회피). 계정 4개 × 로그인 1~2초 = 부팅 시 ~8초 추가(fire-and-forget이므로 서버 기동은 블로킹 안 함).

> **검증 필요(프로덕션 실측):** ① N개 WebSocket 동시 상주 시 메모리(계정당 증가분) ② `connectAllAccounts` 순차 로그인이 Zalo 측 rate limit에 안 걸리는지 ③ 개인 계정 세션이 시스템봇 트래픽과 무관하게 유지되는지. 근거: Nike가 동일 풀 구조로 N계정 운영 중이므로 위험 낮음.

### D3. 대화 스코프 — `ownerAdminId` + 복합 unique (완전 개인)

**핵심 변경.** `ZaloConversation`을 "어느 관리자가 받은 대화인지"로 귀속한다.

1. **스키마(D6):** `ownerAdminId String`(FK User) 추가. **`zaloUserId @unique` → `@@unique([ownerAdminId, zaloUserId])`** 복합키로 교체. 의미: "관리자 X의 봇 계정 ↔ 공급자 Y 대화"가 단위. 같은 공급자 Y가 관리자 A·B 모두와 대화하면 **대화 행 2개**(ownerAdminId만 다름) — 테오 요구대로 카카오톡 모델.
2. **수신 귀속(`saveInboundMessage`):** 인자에 `ownerAdminId` 추가(어느 관리자 인스턴스가 받았는지 — 리스너가 `inst.userId`로 전달). upsert를 `where: { ownerAdminId_zaloUserId: { ownerAdminId, zaloUserId: senderZaloUserId } }`로 교체. 미러(`dispatchOne`)도 동일 복합키.
3. **조회 스코프(`/messages`):** `findMany({ where: { ownerAdminId: session.user.id } })`. 관리자 A는 자기 ownerAdminId 대화만. 누수 차단은 **단일 where 절**로 단순.
4. **발신 권한 검증(`/api/zalo/messages`):** 대상 conversation의 `ownerAdminId === session.user.id` 검증 추가(타 관리자 대화에 발신 금지). 발송은 `getApiForAdmin(session.user.id)`.
5. **시스템봇 대화의 ownerAdminId:** 시스템 미러(D5)가 만드는 대화는 `ownerAdminId = 시스템봇 소유자(테오 ADMIN userId)`. 즉 시스템 알림 미러는 **테오의 대화 공간**에만 나타난다(다른 관리자는 안 봄, 테오 요구 4 만족).

### D4. 전화번호 매칭 — 시스템 온보딩(전역) vs 개인 채팅(스코프) 분리

**현재 `tryMatchSupplierByPhone`은 `User.zaloUserId`(전역 @unique)를 채운다.** 이건 "이 공급자의 Zalo id는 X"라는 **전역 사실**이며 시스템봇 발송 대상 해석(`Notification.userId → User.zaloUserId → 발송`)에 쓰인다. 멀티에서 이 의미를 보존한다:

1. **시스템봇이 받은 친구추가/메시지 → `User.zaloUserId` 채움(전역, 온보딩).** 이건 "공급자가 시스템봇을 친구추가했다 = 알림 받을 준비됨"이고 발송 대상 id다. **시스템봇 인스턴스의 수신만 이 매칭을 수행.**
2. **개인 채팅 계정이 받은 메시지 → `User.zaloUserId`를 건드리지 않는다.** 관리자 A의 친구가 그 공급자라는 보장이 없고, A의 Zalo에서 본 상대 id는 A의 컨텍스트 id다. 개인 대화는 `ZaloConversation.ownerAdminId + displayName`으로 표시하되, **User 연결(`userId`)은 시스템봇이 이미 매칭한 전역 `User.zaloUserId`와 일치할 때만** 부가적으로 연결(읽기 전용 조인). 즉 개인 채팅은 User 매칭을 *시도*하지 않고 전역 결과를 *참조*만.
3. 구현: `saveInboundMessage`에 `isSystemBot: boolean` 플래그 → true일 때만 `tryMatchSupplierByPhone` 호출. false면 매칭 스킵(전역 `User.zaloUserId`로 userId 역참조만).

> **검증 필요:** zca-js에서 관리자 A가 본 공급자 Y의 userId와 시스템봇이 본 Y의 userId가 **동일한 전역 Zalo id인지**(Zalo userId는 계정 무관 전역 id로 알려져 있으나 실측 필요). 동일하다면 개인 채팅에서도 전역 `User.zaloUserId` 조인이 정확. 다르면(컨텍스트별 id) 조인 불가 → 개인 대화는 displayName만으로 표시.

### D5. 시스템 봇 ↔ 채팅 공존 — 미러 귀속

1. **시스템 알림 미러(`ZaloMessage` SYSTEM·OUTBOUND)는 테오(시스템봇 소유자)의 대화에만.** `dispatchOne`의 미러 `findUnique`/`upsert` 대상 ZaloConversation을 `{ ownerAdminId: 시스템봇소유자, zaloUserId: 공급자 }` 복합키로. 다른 관리자의 `/messages`엔 안 보임(D3.5).
2. **`ZaloMessageSource` enum 유지** — USER(개인 수신)·CHAT(개인 발신)·SYSTEM(시스템 알림 미러). 같은 ZaloConversation에 SYSTEM 미러와 CHAT이 공존 가능(테오가 시스템봇=개인 계정 단일 모드일 때). 분리 모드면 SYSTEM은 시스템봇 대화, CHAT은 개인 대화로 자연 분리.
3. **시스템봇 소유자 식별:** `ZaloAccount.findFirst({ where: { kind: SYSTEM_BOT, isActive } })`의 `userId`. 부팅·발송 시 캐싱.

### D6. 스키마 변경안

```prisma
enum ZaloAccountKind {
  SYSTEM_BOT       // F5 알림 발송 전용 (테오 소유, 풀 키 "__system__")
  ADMIN_PERSONAL   // 관리자 개인 채팅 계정 (풀 키 = adminUserId)
}

model ZaloAccount {
  id            String          @id @default(cuid())
  zaloUserId    String          @unique           // 봇 계정 자신의 Zalo own id (getOwnId)
  kind          ZaloAccountKind @default(SYSTEM_BOT) // 신규 — 기존 행은 SYSTEM_BOT으로 백필
  userId        String          // 신규: nullable→필수. 소유 ADMIN (개인계정=본인, 시스템봇=테오)
  user          User            @relation("AdminZaloAccounts", fields: [userId], references: [id], onDelete: Cascade)
  credentials   String?         // AES-256-GCM 암호문 — 절대 평문/응답/로그 금지 (D7)
  displayName   String?
  isActive      Boolean         @default(true)
  lastConnected DateTime?
  createdAt     DateTime        @default(now())

  @@unique([userId, kind])      // 신규: 관리자 1명당 kind별 1계정 (개인 1 + (테오만)시스템 1)
  @@index([isActive])
  @@index([kind, isActive])
}

model ZaloConversation {
  id            String    @id @default(cuid())
  ownerAdminId  String    // 신규: 이 대화를 소유한 ADMIN (수신/발신 주체 계정의 소유자)
  ownerAdmin    User      @relation("AdminConversations", fields: [ownerAdminId], references: [id], onDelete: Cascade)
  zaloUserId    String    // 대화 상대(공급자)의 Zalo id — @unique 제거
  userId        String?   // 매칭된 공급자 User (전역 User.zaloUserId 기준) — @unique 제거(D6 주석)
  user          User?     @relation("SupplierConversations", fields: [userId], references: [id], onDelete: SetNull)
  displayName   String?
  lastMessageAt DateTime?
  lastInboundAt DateTime?
  unreadCount   Int       @default(0)
  createdAt     DateTime  @default(now())

  messages ZaloMessage[]

  @@unique([ownerAdminId, zaloUserId])  // 신규: 관리자×상대 단위 (기존 zaloUserId @unique 대체)
  @@index([ownerAdminId, lastMessageAt])
}

// User: 역관계 명명 정리
model User {
  // ...
  zaloAccounts      ZaloAccount[]      @relation("AdminZaloAccounts")        // 1:N (개인 + 시스템)
  ownedConversations ZaloConversation[] @relation("AdminConversations")      // 관리자가 소유한 대화
  supplierConversations ZaloConversation[] @relation("SupplierConversations") // 공급자로서 매칭된 대화
  // 기존 zaloConversation ZaloConversation? (1:1)은 제거 — 복합키로 1:N
}
```

**변경 분류:**
- **Additive(안전):** `ZaloAccountKind` enum, `ZaloAccount.kind`, `ZaloConversation.ownerAdminId`(+FK·인덱스).
- **제약 변경(백필 필요):**
  - `ZaloConversation.zaloUserId @unique` 제거 → `@@unique([ownerAdminId, zaloUserId])`. **기존 행은 ownerAdminId가 없어 NULL → 백필 후 제약 추가**(2단계 마이그레이션, D7 경로).
  - `ZaloConversation.userId @unique` 제거(같은 공급자가 여러 관리자 대화에 userId로 연결될 수 있음 — 1:N).
  - `ZaloAccount.userId` nullable→필수: 기존 행은 테오 userId로 백필 후 NOT NULL.
  - `User.zaloAccount ZaloAccount?`(1:1) → `zaloAccounts ZaloAccount[]`(1:N): `User.zaloAccount` `@unique` 제거.
- **무변경:** `Notification`·`ZaloMessage`(direction/source/status/sentBy 그대로)·`User.zaloUserId`(공급자 전역 id)·`User.phone`. 시스템 발송 경로의 스키마는 일절 안 건드림.

`prisma migrate dev`로 진행(제약 변경 포함 — `db push`는 unique 교체 시 데이터 손실 경고를 우회할 수 있어 위험). **TDA 검토 후 BE가 2단계 마이그레이션 실행**(D7).

### D7. 마이그레이션 경로 (현재 단일봇 → 멀티) + 보안

**2단계 마이그레이션(데이터 무손상):**

1. **마이그레이션 A (additive + 백필):**
   - `ZaloAccountKind` enum 추가, `ZaloAccount.kind`(default SYSTEM_BOT), `ZaloConversation.ownerAdminId`(우선 nullable로 추가).
   - **데이터 백필:**
     - 기존 `ZaloAccount`(현 단일봇) → `kind = SYSTEM_BOT`, `userId`는 이미 테오로 채워져 있음(없으면 테오 ADMIN으로 set).
     - 기존 모든 `ZaloConversation.ownerAdminId` = **시스템봇 소유자(테오 ADMIN userId)**. 현재 모든 대화는 단일봇이 받은 것이므로 테오 소유가 맞다.
2. **마이그레이션 B (제약 전환):**
   - `ZaloConversation.ownerAdminId` NOT NULL + FK + `@@unique([ownerAdminId, zaloUserId])` 추가, `zaloUserId @unique`·`userId @unique` 제거.
   - `ZaloAccount.userId` NOT NULL + `@@unique([userId, kind])` 추가, `User.zaloAccount @unique` 제거.

→ **기존 단일봇 운영 데이터(테오 ZaloAccount·기존 대화)는 전부 테오 소유로 귀속**되어 깨지지 않는다. 마이그레이션 A·B는 한 PR에서 순차 적용(빈 DB가 아니면 A의 백필이 B의 NOT NULL 전제).

**보안(ADR-0006 D6 전면 유지):**
- credential은 계정 수가 늘어도 AES-256-GCM 암호문 그대로. **응답·로그·AuditLog·SSE 절대 미포함.** `getStatusForAdmin`/`getSystemBotStatus`는 `{ connected, status, displayName }`만.
- **개인 계정 QR/상태 라우트는 본인(adminUserId == session.user.id)만.** 시스템봇 QR은 시스템봇 소유자(테오)만. 타 관리자가 남의 개인 계정 QR/상태 조회 금지(401/403).
- **누수 검사 항목 추가**(`.claude/skills/qa/leak-checklist`): (a) `/messages` 조회에 `ownerAdminId = session` 누락 여부, (b) `/api/zalo/messages` 발신 시 conversation 소유 검증 누락 여부, (c) `getApiForAdmin`이 타 관리자 api를 반환하지 않는지, (d) 마진·판매가·KRW가 수신/발신 본문에 없는지(기존 규칙).

---

## 단계 분해 (구현 순서 + 검증)

| 단계 | 범위 | 산출 | 검증 방법 |
|---|---|---|---|
| **S0** | 스키마 마이그레이션 A·B + 백필 | `ZaloAccountKind`·`kind`·`ownerAdminId`·복합 unique, 기존 데이터 테오 귀속 | studio에서 기존 ZaloAccount=SYSTEM_BOT, 기존 대화 ownerAdminId=테오 확인. 기존 데이터 손실 0 |
| **S1** | 풀 부활 + 시스템/개인 라우팅 분리 (**시스템 발송 무변경**) | `lib/zalo-pool.ts`(Map), `getSystemBotApi`/`getApiForAdmin`, `dispatchOne`은 `getSystemBotApi` 경유 | 시스템 알림 8종+tamtru 발송 회귀 0(테오 봇으로 그대로 발송), vitest 회귀 0 |
| **S2** | 개인 계정 QR + connectAllAccounts 부팅 | `startQRLoginForAdmin`, `/settings/zalo` 분리 화면, `instrumentation`→`connectAllAccounts`, replica=1 | 관리자 2명이 각자 개인 Zalo QR 로그인 → 풀에 2 인스턴스, 재시작 후 둘 다 자동 재로그인 |
| **S3** | 수신 귀속 + /messages 개인 스코프 | `saveInboundMessage(ownerAdminId, isSystemBot)`, 리스너가 `inst.userId` 전달, `/messages where ownerAdminId`, 발신 소유 검증 | 관리자 A 봇에 메시지 → A의 /messages에만 표시, **B는 안 보임**(누수 0). 발신 시 본인 계정으로 전송 |
| **S4** | 시스템 미러 귀속 + 끊김 경보(계정별) | 미러 대상 대화 복합키(테오 소유), 계정별 closed/error 경보 | 시스템 알림 미러가 테오 대화에만, 개인 계정 끊김 시 해당 관리자에게만 경보 |

각 단계 QA 독립 검증(작업자 자기평가 무효). S0·S3에서 누수 검사(D7) + 마이그레이션 백필 검증 필수.

---

## 리스크와 완화책

| # | 리스크 | 완화책 | 단계 |
|---|---|---|---|
| ① | **복합 unique 교체 시 upsert/findUnique 깨짐** (saveInboundMessage·dispatchOne 미러) | S0·S1을 한 묶음으로 — 제약 변경과 모든 호출부 복합키 전환을 동시에. vitest로 upsert/미러 회귀 0 확인 | S0·S1·S3 |
| ② | **수신 귀속 오류 → 타 관리자 대화 누수**(사업원칙 위반) | 리스너 인스턴스 `inst.userId`를 ownerAdminId로 강제 전달(전역 변수 금지), 저장 시 복합키. QA가 A/B 교차 수신 테스트 | S3 |
| ③ | 시스템 봇과 개인 계정 **같은 Zalo면 code 3000 밴**(이중 세션) | D1 분리 권고(계정 2개). 단일 계정 모드 시 풀에서 1 인스턴스만(시스템=개인 공유, 이중 로그인 금지) | S1·S2 |
| ④ | N개 WebSocket 메모리·부하(Railway 단일 컨테이너) | Phase 1 N≤4 — 여유. 순차 부팅. N>10 시 worker 분리 재검토(IDEAS.md) | S2 |
| ⑤ | 개인 계정 끊김 → 그 관리자 채팅만 마비(시스템 알림은 무관) | 계정별 끊김 경보(Web Push), `/settings/zalo` 본인 상태 배지, 재QR 안내 | S4 |
| ⑥ | 전화번호 매칭이 개인 계정 수신으로 잘못 트리거 → `User.zaloUserId` 오염 | `isSystemBot` 플래그로 매칭은 시스템봇 수신만(D4). 개인 채팅은 매칭 스킵 | S3 |
| ⑦ | 기존 단일봇 데이터 백필 누락 → ownerAdminId NULL로 제약 추가 실패 | 마이그레이션 A(백필) → B(NOT NULL) 2단계 순서 강제(D7) | S0 |
| ⑧ | 개인 계정 밴(소량이라 위험 낮으나 존재) | 발송량 적음, 재시도 백오프(기존), 시스템 알림과 격리되어 영향 국소 | — |

---

## 영향 범위

- **스키마:** `ZaloAccountKind` enum 추가, `ZaloAccount`(kind·userId 필수·@@unique[userId,kind]), `ZaloConversation`(ownerAdminId·복합 unique·userId @unique 제거), `User`(역관계 1:N화). 마이그레이션 A·B 2단계(`migrate dev`).
- **신규 파일:** `lib/zalo-pool.ts`(Nike 적응 — Map 풀). `/settings/zalo` 개인 계정 카드 컴포넌트, `/messages` 빈 상태 컴포넌트(9절).
- **수정 파일:**
  - `lib/zalo-runtime.ts` → 풀 래퍼로 재구성(또는 pool로 흡수). `getBotApi`→`getApiForAdmin`/`getSystemBotApi`, `connectBot`→`connectAllAccounts`, `startBotQRLogin`→`startQRLoginForAdmin`/`startSystemBotQRLogin`.
  - `lib/zalo-credentials.ts`: `loadCredentials`(1건)→`loadAllActiveCredentials`(N) + `loadCredentialsForAdmin`/`loadSystemBotCredentials`. `saveCredentials`에 kind 인자.
  - `lib/zalo-inbound.ts`: `saveInboundMessage`에 `ownerAdminId`·`isSystemBot` 인자, upsert 복합키, 매칭 분기(D4).
  - `lib/zalo.ts` `dispatchOne`: `sendBotMessage`→`getSystemBotApi` 경유 발송, 미러 대화 복합키(테오 소유). **시그니처·enqueue·buildNotificationText·cron 무변경.**
  - `app/(admin)/messages/page.tsx`: `where: { ownerAdminId: session.user.id }` + 본인 계정 미연결 시 빈 상태.
  - `app/api/zalo/messages/route.ts`: conversation 소유 검증 + `getApiForAdmin(session.user.id)`.
  - `app/api/zalo/qr/route.ts`·`status/route.ts`: 시스템봇용/개인용 분리(쿼리 파라미터 `?kind=` 또는 라우트 분리), 소유 검증.
  - `instrumentation.ts`: `connectBot`→`connectAllAccounts`.
- **무변경 보장(시스템 알림이 안 깨지는 근거):** `enqueueNotification`/`dispatchPendingNotifications`/`buildNotificationText` 시그니처, F5 8종·tamtru 본문, cron/notifications 라우트, `Notification`/`ZaloMessage` 스키마, `User.zaloUserId` 의미·전역 매칭 결과(시스템봇 발송 대상 해석). 시스템 발송은 `getSystemBotApi()` 전용 분기로 현재 테오 봇과 동일하게 동작.
- **환경변수:** `ZALO_CREDS_KEY` 유지(계정 수 무관 동일 키). 추가 없음.
- **권한/누수:** D7 누수 검사 4항목 추가.

## 미결 (구현 단계에서 확정)

- **테오 계정 운용 의사**(D1): 시스템 전용 + 개인 분리(권고) vs 단일 계정 모드 — 테오 확인 필요.
- **Zalo userId 전역성**(D4 검증): 관리자 A가 본 공급자 id == 시스템봇이 본 id == 전역 id인지 실측. 다르면 개인 채팅 User 조인 불가(displayName만).
- Phase 1 실제 관리자 수(메모리 산정 — 현재 2~4 가정).
- `/settings/zalo` 단일 화면에 두 섹션 vs 라우트 분리(`/settings/zalo`=개인, `/settings/zalo/system`=시스템봇) — DESIGN과 협의.

---

## 디자인 인계 (DESIGN)

| # | 화면 | 변경 | 비고 |
|---|---|---|---|
| 1 | `/settings/zalo` — **내 Zalo 연결**(개인) | **신규 카드/섹션** | 관리자 본인 개인 계정 QR + 연결 상태 배지(connected/qr_pending/error). 모든 ADMIN이 본다. 기존 다크 톤·`zalo-connect-client.tsx` 패턴 재사용 |
| 2 | `/settings/zalo` — **시스템 봇 연결**(테오 전용) | 기존 화면 거의 재사용 + **"시스템 알림 발송 계정" 라벨** | 시스템봇 소유자(테오)에게만 노출. 비소유 관리자에겐 숨김 또는 "테오 관리 계정" 읽기 표시 |
| 3 | `/messages` — **빈 상태(미연결)** | **신규** | "내 Zalo가 연결되지 않았습니다 → 연결하기(/settings/zalo)". 본인 개인 계정 미연결 시 인박스 대신 표시 |
| 4 | `/messages` — 인박스·스레드(b14) | **디자인 무변경**, 데이터만 개인 스코프 | b14 그대로 재사용. ownerAdminId 스코프는 서버 RSC 처리 — UI 구조 동일 |
| 5 | `/settings/zalo` 상태 배지 | 끊김 경보 표시(S4) | 개인 계정 error 시 "다시 연결" CTA |

→ 1·3이 **신규 디자인**(Stitch 생성 대상), 2는 기존 화면 라벨/조건부 노출 수정, 4는 무변경. DESIGN은 1(개인 연결 카드)·3(메시지 빈 상태)을 다크 운영자 톤으로 작업.

---

## 결과

- ADR-0006의 "봇 1개·단일 슬롯"을 **시스템 봇 1개(고정 키) + 관리자 개인 계정 풀(adminUserId 키)** 공존 모델로 확장. Nike `zalo-pool.ts`의 멀티유저 풀을 되살리되 시스템 봇을 풀의 특별 항목으로 둠.
- **시스템 알림(F5 8종+tamtru)은 전 단계 무변경** — `getSystemBotApi()` 전용 분기, 발송 시그니처·cron·본문 그대로.
- **관리자 채팅은 완전 개인** — `ZaloConversation.ownerAdminId` + `@@unique([ownerAdminId, zaloUserId])`로 관리자별 대화 격리, `/messages`는 `where ownerAdminId = session`으로 누수 차단.
- 1차 구현: **S0(스키마 2단계 마이그레이션 + 테오 귀속 백필) → S1(풀 부활·라우팅 분리)** 부터. 점진 경로로 기존 단일봇이 한 번도 안 깨짐.
- 승인 시 PM 보고 → BE/INTEG에 S0(마이그레이션 A·B) 지시. 단, **D1(테오 계정 분리 의사)·D4(Zalo userId 전역성) 검증 결과를 S0 착수 전 확인.**
