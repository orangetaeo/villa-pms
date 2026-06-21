# ADR-0010: Nike ↔ villa-pms Zalo 세션·채팅 공유 (테오 계정 한정)

날짜: 2026-06-18 (갱신: 풀스펙 확정 — 그룹채팅·첨부 재업로드·기능 동등 R10/R12/R13 해소)
상태: **채택(Accepted)** — A안 확정. SPOF 수용. C안은 미래 승격 경로로 보존, B안 탈락. **기능 범위 풀스펙 확정**(그룹 채팅 포함·과거 첨부 영구보존·forward/alias/음성STT 동등 구현). (본 ADR 갱신본은 **설계 + Nike 실사 결과**만 — 코드·스키마·마이그레이션 변경 없음. 스키마 확장은 본 ADR에 설계만 기록하고 실제 마이그레이션은 구현 스프린트 S4에서)
결정자: 테오(사업 결정) + TDA(기술 설계)
관련: ADR-0005(zca-js 채택), ADR-0006(zalo 런타임·단일봇), ADR-0007(멀티 관리자 풀·`__system__` 통합 모드), ADR-0009(첨부·번역·답글·리액션), lib/zalo-runtime.ts·lib/zalo-credentials.ts·lib/zalo-inbound.ts, prisma/schema.prisma(ZaloAccount/ZaloConversation/ZaloMessage), Nike C:\Projects\Nike\src\lib\(zalo-pool·zalo-credentials·zalo-db-store·zalo-message-store·zalo)·src\app\api\zalo\(route·events·qr)·src\hooks\use-zalo-sse·src\components\chat\zalo-notifier, CLAUDE.md 사업원칙 1·2(재고·마진 비공개), 보안규칙(credential AES-256-GCM·미노출)

---

## 결론 요약 (보고용)

**① A안 채택 확정 = villa-pms를 Zalo 허브로(세션·정본 DB 단독 보유), Nike는 villa의 ext API로 송수신.**
테오가 빠른 시작을 우선해 A안을 확정했다. "테오 Zalo 세션은 villa-pms만 WebSocket 로그인, Nike는 테오 계정으로 절대 로그인하지 않음"이라는 한 문장으로 code 3000(세션 충돌)을 원천 차단한다. 신규 인프라 0(villa에 ext API 라우트만 추가), villa 스키마 무변경. **A안의 ext API 계약(send/threads/messages/webhook)을 그대로 두고 세션 소유 프로세스만 떼면 C안(별도 zalo-gw)으로 무중단 승격** — A→C는 버리는 작업 없는 단방향 진화 경로로 보존한다.

**② SPOF(단일 장애점) 수용 — 테오 명시 결정.**
villa-pms(허브)가 다운되면 Nike의 테오 Zalo 송수신도 함께 멈춘다. 현 분리 운영 대비 가용성이 낮아지는 트레이드오프를 테오가 **수용함**. 완화책으로 끊김 경보(ADR-0007 S6 잔여)를 우선 구현하고, 부하·가용성이 문제되면 C안으로 승격한다.

**③ 테오 계정에만 적용 — 다른 관리자는 0 영향.**
통합 대상은 villa의 `__system__` 인스턴스(=테오 SYSTEM_BOT 계정) 하나뿐. 다른 ADMIN_PERSONAL 계정의 세션·대화는 본 ADR이 건드리지 않는다(`ownerAdminId=본인` 스코프 그대로). ext API는 `ownerAdminId=테오`로 하드 고정한다.

**④ 과거 대화 ETL 이관 — 설계에 포함(테오 결정).**
통합 시점 이전 Nike에 쌓인 테오 대화·메시지를 villa 정본(`ZaloConversation`/`ZaloMessage`)으로 일회성 이관해 한 곳에서 전체 조회한다. Nike(`ZaloThread`+`ZaloMessage`+`ZaloAttachment` 별 테이블, 첨부 바이너리 DB저장) ↔ villa(`ZaloConversation`+`ZaloMessage`, `attachmentUrls String[]`) 모델이 다르므로 매핑·멱등성 규칙을 아래 ETL 절에 명시한다.

**⑤ Nike 실사 완료 — 변경 지점이 좁고 명확하다.**
Nike의 Zalo 송수신은 ⓐ 세션 풀 `src/lib/zalo-pool.ts`(로그인·리스너·SSE emit), ⓑ 단일 채팅 API `src/app/api/zalo/route.ts`(GET 읽기 + POST 발송, action 디스패치), ⓒ 실시간 `src/hooks/use-zalo-sse.ts`+`src/app/api/zalo/events/route.ts`(SSE), ⓓ 영속 `zalo-db-store.ts`/`zalo-message-store.ts`로 깔끔히 분리돼 있다. 멀티유저 풀이라 **테오 userId만 풀에서 제외**하면 다른 Nike 계정은 무영향. 발송 경로는 `zalo.ts`의 `sendZaloMessage`/`sendZaloImage` 함수 2개에 집중 → villa HTTP 호출로 교체할 지점이 명확하다.

**⑥ 기능 범위 풀스펙 확정 — R10/R12/R13 모두 "구현"으로 확정(축소 트레이드오프 폐기).** (테오 결정 2026-06-18)
- **그룹 채팅 포함(R10 해소)**: Nike의 Zalo 그룹(단톡방) 대화도 통합·이관·표시 대상. villa는 현재 1:1 개인대화(ZaloConversation)만이라 **그룹 스레드 모델·표시 UI가 없다.** → villa `ZaloConversation`에 `threadType(USER|GROUP)`·그룹 멤버/발신자 표현을 **추가하는 스키마 확장 설계**를 본 ADR에 기록(마이그레이션은 S4). ETL은 그룹 제외 → **그룹 포함**으로 변경.
- **과거 첨부 영구 보존(R12 해소)**: Nike DB의 첨부 바이너리(`ZaloAttachment` Bytes)를 villa 저장소(R2/볼륨, `attachmentUrls` 체계)로 **재업로드해 영구 보존**. ETL C2를 "originalUrl만"이 아니라 "**바이너리→villa 스토리지 업로드→attachmentUrls 기록**"으로 확정(용량·실패 재시도·멱등 고려).
- **기능 동등 구현(R13 해소)**: Nike에만 있는 forward(메시지 전달)·alias(별칭)·음성 STT를 villa에도 **처음부터 동등 구현**. 음성 STT는 **villa `lib/gemini.ts`의 기존 REST `generateContent`(inline_data 멀티모달·`GEMINI_MODEL` 핀) 패턴을 그대로 재사용**해 `transcribeVoice(audioBase64, mimeType)`를 추가(gemini-2.5-flash는 오디오 입력 지원 — 신규 SDK·키 불필요).

---

## 맥락 / 요구사항 (확정)

테오의 요구(**본인 Zalo 계정에 한해서만**):
1. **QR 로그인 1번** — Nike·villa-pms에서 같은 세션 공유(두 번 스캔·두 세션 금지).
2. **채팅 데이터 공유** — 테오 계정 대화·메시지를 양쪽에서 본다(과거 이력 포함 — ETL).

### 확립된 기술 제약 (설계 불변식)
- **C1 — 세션 단일성**: zca-js는 같은 계정을 두 프로세스에서 동시 WebSocket 로그인하면 `code 3000`으로 한쪽을 강제 종료한다(밴 위험 신호). 수신 리스너를 가진 세션은 **정확히 1개 프로세스**에만. (근거: villa `lib/zalo-runtime.ts` + Nike `zalo-pool.ts` 둘 다 `listener.on("closed")`에서 code 3000 분기 — 아래 실사 참조)
- **C2 — 분리 인프라**: Nike·villa-pms는 별도 Railway 프로젝트 + 별도 PostgreSQL. **cross-DB 직접 쿼리 불가**.
- **C3 — replica=1**: 양쪽 모두 단일 컨테이너. 세션 보유 프로세스(villa)는 통합 후에도 replica=1.
- **C4 — 보안 절대 규칙**: Zalo credential(평문/암호문)은 API 응답·로그·AuditLog·SSE에 절대 노출 금지(AES-256-GCM, `ZALO_CREDS_KEY`). villa 마진·판매가·전체 재고 비공개 유지.

---

## Nike 레포 실사 결과 (2026-06-18, C:\Projects\Nike)

### 세션·로그인 (zalo-pool.ts)
- **멀티유저 풀**: `globalThis.zaloPool: Map<userId, ZaloUserInstance>`. 각 유저가 독립 `api`·`messageStore`·리스너 보유. **테오 세션도 이 풀의 한 항목**(테오 Nike userId 키).
- **부팅 자동 연결**: `connectAllUsers()`가 `loadAllActiveCredentials()`로 모든 활성 계정을 순차 로그인. → **통합 시 테오 userId를 이 루프에서 제외**해야 한다(핵심 떼는 지점).
- **로그인 경로 3개**: `connectAllUsers`(부팅), `connectUser`/`ensureConnectionForUser`(첫 API 접근 시 lazy), `startQRLoginForUser`(QR). 셋 다 테오 계정에 대해선 막아야 한다(세션 충돌).
- **호출처**: `connectAllUsers/connectUser/startQRLogin`은 `src/app/api/users/route.ts`, `src/app/api/zalo/qr/route.ts`, `zalo-pool.ts`, `zalo.ts`에서 호출. QR 진입은 `api/zalo/qr/route.ts`(`action=start`).
- **code 3000 처리**: `startListener`의 `listener.on("closed")`에서 `code===3000`이면 "다른 곳에서 열림" 에러 표시. → villa·Nike 동시 로그인 시 바로 이 경로로 한쪽 강제 종료.
- **credential 저장**: `zalo-credentials.ts`가 `ZaloAccount.credentials`에 **AES-256-GCM** 저장. 암호화 방식(algorithm=aes-256-gcm, scrypt salt="zalo-creds-salt", `iv:authTag:encrypted` 형식)이 **villa `lib/zalo-credentials.ts`와 1바이트도 다르지 않게 동일**. → 같은 `ZALO_CREDS_KEY`를 쓰면 양쪽이 서로의 암호문을 복호화 가능(단, 본 통합에선 credential을 옮기지 않는다 — villa가 단독 보유. 동일성은 ETL/롤백 시 참고만).

### 발송 (zalo.ts)
- 발송 함수는 `sendZaloMessage`(텍스트·답글·멘션), `sendZaloImage`(이미지·파일), `sendZaloReaction` 3개. 모두 `getZaloApiForUser(userId)`로 풀 인스턴스의 `api.sendMessage`/`addReaction` 호출 + 인메모리/DB 미러.
- **교체 지점**: 테오 발송 시 이 함수들이 풀 대신 **villa `POST /ext/send`로 HTTP 위임**해야 한다(테오 userId 분기). 다른 Nike 계정은 기존 경로 유지.

### 채팅 읽기 (api/zalo/route.ts — 단일 라우트)
- GET action: `status`·`recentchat`(스레드 목록)·`conversation`(대화 메시지)·`messages`(과거 페이지)·`poll`(신규)·`reactions`·`voiceTranslations`·`profile`·`groupMembers`.
- POST action: `send`·`sendImage`(multipart)·`react`·`saveTranslation`·`sendProduct`·`forward`·`setAlias`.
- 모두 `getUserId(session)` → 세션 userId로 풀 조회. **소유권 검증**: `ZaloAccount.userId === session.userId` 불일치 시 빈 데이터 반환(이미 격리 장치 존재).
- **교체 지점**: 테오 세션일 때 `recentchat`/`conversation`/`messages`/`poll`을 **villa `GET /ext/threads`·`/ext/messages`로** 위임. 응답을 Nike UI 형식(아래 toApiMessage 형태)으로 어댑팅.

### 실시간 (use-zalo-sse.ts + api/zalo/events/route.ts + sse-emitter)
- 풀 리스너가 `emitZaloMessage/Reaction/Undo/...`로 SSE 푸시 → `/api/zalo/events`(per-user 스트림, 30s heartbeat) → `useZaloSSE` 훅(45s heartbeat 타임아웃 재연결, `onReconnect` catch-up).
- **교체 지점**: 테오 세션은 풀 리스너가 사라지므로 SSE 소스가 없다. → villa 허브가 신규 수신 시 **Nike webhook으로 push**하고, Nike webhook 핸들러가 기존 `emitZaloMessage`를 호출해 동일 SSE 파이프로 흘려보낸다(프런트 `useZaloSSE` 무변경). 폴백은 `poll` 폴링.

### 데이터 모델 (Nike prisma/schema.prisma)
- `ZaloAccount`(zaloUserId @unique, credentials, userId @unique 1:1) / `ZaloThread`(@@unique [zaloThreadId, accountId]) / `ZaloMessage`(@@unique [zaloMsgId, accountId], globalMsgId·cliMsgId·senderUid·quote* 필드) / `ZaloAttachment`(thumbData **Bytes** 바이너리 DB저장) / `ZaloReaction`(@@unique [messageId, reactorId]) / `ZaloAlias`.
- villa와 **구조·첨부 저장·스코프 키가 모두 다름** → "같은 DB 가리키기" 불가. 정본 단일화(villa) + ETL 필수(④).

---

## Nike ↔ villa 모델 필드 대조표 (ETL 매핑 원천)

정본 = **villa**. ETL은 Nike(원천) → villa(정본) 단방향. 테오 계정 1개분만(`ZaloAccount.userId = 테오 Nike userId`).

### 계정 / 스코프
| 개념 | Nike | villa | ETL 매핑 |
|---|---|---|---|
| 계정 | `ZaloAccount.id`(accountId) | `ZaloAccount`(kind=SYSTEM_BOT, userId=테오) | Nike accountId는 ETL 필터에만 사용. villa는 테오 `__system__` 계정으로 고정 |
| 대화 스코프 키 | `(zaloThreadId, accountId)` | `(ownerAdminId, zaloUserId)` | ownerAdminId ← 테오 villa userId(고정), zaloUserId ← Nike `zaloThreadId`(개인=상대 Zalo id, 그룹=그룹 id) |
| 상대 식별 | `zaloThreadId` | `zaloUserId` | 동일 값. **그룹 스레드(threadType="group")도 이관(R10 해소)** — villa `zaloUserId`에 그룹 id 저장 + 신규 `threadType=GROUP` 표시 |

### 대화 (Thread → Conversation)
| Nike ZaloThread | villa ZaloConversation | 매핑 규칙 |
|---|---|---|
| zaloThreadId | zaloUserId | 그대로 |
| displayName | displayName | 그대로 |
| avatar | avatarUrl | 그대로(빈 문자열이면 null) |
| lastMessageTime | lastMessageAt | 그대로 |
| unreadCount | unreadCount | 그대로(또는 0으로 리셋 — 이관분은 과거이므로 0 권장) |
| threadType "user"/"group" | threadType USER/GROUP **(신규 컬럼, S4 마이그레이션)** | user→USER, group→GROUP. 그룹도 이관(R10 해소) |
| groupName/groupMembers(그룹) | displayName / groupMembers **(신규 Json, S4)** | 그룹명→displayName, 멤버 목록(zaloId·이름·아바타)을 `groupMembers Json`에 스냅샷 저장(표시·발신자 매핑용) |
| (없음) | ownerAdminId | 테오 villa userId 고정 |
| (없음) | counterpartyType | 기본 `UNKNOWN`(과거 대화는 분류 미상 — ADMIN 수동 분류 fallback). 누수 잠금 안전측 |
| (없음) | translateMode | 기본 `VI`(스키마 기본값) |
| (없음) | nickname | null |

### 메시지 (Message → Message)
| Nike ZaloMessage | villa ZaloMessage | 매핑 규칙 |
|---|---|---|
| zaloMsgId | zaloMsgId | **그대로(멱등 키)**. villa `zaloMsgId @unique`라 재실행 시 중복 0 |
| direction "sent"/"received" | direction OUTBOUND/INBOUND | sent→OUTBOUND, received→INBOUND |
| (파생) | source | OUTBOUND→`CHAT`, INBOUND→`USER` |
| msgType "text/image/file/sticker/voice" | msgType(String) | 그대로(villa는 String이라 값 자유) |
| text / translatedText | text / translatedText | 그대로 |
| timestamp | createdAt | 그대로(정렬 보존) |
| cliMsgId | cliMsgId | 그대로 |
| globalMsgId | (없음) | **villa 미보유** — 드롭. 단 quote 해석에 쓰이므로 ETL 단계에서 globalMsgId→zaloMsgId 사전 변환 후 quotedMsgId 채움(R11) |
| senderUid | senderUid **(신규 컬럼, S4)** | **그룹에서 필수** — 같은 스레드에 여러 발신자가 섞이므로 메시지별 발신자 식별 필요. 개인 대화는 null 허용(상대=고정). 그룹은 senderUid + groupMembers 스냅샷으로 발신자명·아바타 표시 |
| quoteText/quoteSender/quoteMsgId/quoteMsgType | quotedText/quotedSender/quotedMsgId/(없음) | quoteText→quotedText, quoteSender→quotedSender, quoteMsgId(globalMsgId)→quotedMsgId(zaloMsgId로 변환), quoteMsgType 드롭 |
| reactions(별 테이블 ZaloReaction[]) | reactions(Json 집계) | 아이콘별 카운트로 **집계**해 `{ "<icon>": count }` JSON 생성(villa는 카운트만 — ADR-0009) |
| attachments(별 테이블 ZaloAttachment[], **Bytes** 바이너리) | attachmentUrls(String[]) | **확정(R12 해소)**: `thumbData` 바이너리를 **villa 저장소(R2/볼륨)로 재업로드 후 그 URL을 attachmentUrls에 기록**(영구 보존). originalUrl은 만료 위험이 있어 보존 신뢰원으로 쓰지 않음. 멱등: 대상 키 = `nike-attach/{zaloMsgId}/{index}`(존재 시 skip). 실패는 재시도 큐(아래 ETL 절). 용량은 thumbData가 썸네일 위주라 부담 적음 — 원본 첨부가 큰 경우 별도 모니터링 |

### ETL 멱등성·중복방지·순서
- **멱등 키 = zaloMsgId**. villa `@unique`라 INSERT 충돌 시 skip(upsert update:{}). 재실행 안전.
- **대화 먼저, 메시지 나중**: Conversation upsert(ownerAdminId,zaloUserId) → 그 id로 메시지 INSERT.
- **quote 2-pass**: 1pass 전체 메시지 INSERT(globalMsgId→zaloMsgId 사전 구축) → 2pass에서 quotedMsgId를 zaloMsgId로 갱신(Nike `resolveQuoteMsgIds` 패턴 차용).
- **대화 메타 재계산**: 이관 후 각 대화의 lastMessageAt = max(message.createdAt), unreadCount=0으로 정정.
- **그룹 포함(R10 해소)**: threadType="group" 스레드도 이관. 그룹은 `threadType=GROUP`·`groupMembers`(멤버 스냅샷) 채우고, 각 메시지에 `senderUid` 저장. villa 그룹 표시 UI(S4)가 senderUid↔groupMembers로 발신자명·아바타 매핑.
- **첨부 재업로드 멱등·재시도(R12 해소)**: 각 ZaloAttachment의 thumbData를 villa 저장소에 `nike-attach/{zaloMsgId}/{index}` 키로 업로드(존재 시 skip → 멱등). 업로드 성공분만 attachmentUrls에 누적. 실패 첨부는 `(zaloMsgId,index)` 단위로 실패 목록에 기록하고 ETL 종료 후 재시도 패스(메시지 본문은 이미 이관됐으므로 첨부만 사후 보강). 대량 바이너리는 동시성 제한(예: 동시 4건)으로 저장소 부하 통제.

---

## 확정 작업 분해 (WBS)

### 그룹 D — villa 스키마 확장 (그룹 채팅 지원 — S4에서 마이그레이션. 본 ADR은 설계만)
> 그룹 채팅 포함(R10 해소)으로 villa에 새 컬럼이 필요하다. **모두 additive(기존 행 영향 없음)** — 기존 1:1 대화는 threadType 기본 USER로 백필. 실제 `prisma migrate`는 구현 스프린트 S4에서 TDA 검토 후 수행.

| # | 작업 | 난이도 | 규모 | 내용 |
|---|---|---|---|---|
| D1 | `ZaloConversation.threadType` 추가 | 소 | 소 | enum `ZaloThreadType { USER, GROUP }` 신설, `@default(USER)`. 기존 행 USER 백필. `@@unique([ownerAdminId, zaloUserId])`는 그대로(그룹 id도 zaloUserId 슬롯 사용) |
| D2 | `ZaloConversation.groupMembers` 추가 | 소 | 소 | `Json?` — 그룹 멤버 스냅샷 `[{zaloId,name,avatarUrl}]`. 발신자명·아바타 매핑 원천. 개인 대화는 null |
| D3 | `ZaloMessage.senderUid` 추가 | 소 | 소 | `String?` — 그룹 메시지의 발신자 Zalo id(누가 보냈는지). 개인 대화는 null(상대 고정). 수신 핸들러·ETL이 채움 |
| D4 | 그룹 표시 UI(b14 채팅 확장) | 중 | 중 | 스레드 목록에 그룹 아이콘·멤버수, 메시지 버블에 발신자명·아바타(senderUid→groupMembers). 발송은 그룹 thread로 전송(아래 A·B 발송 경로 공유) |

### 그룹 A — villa-pms (허브) : 신규 ext API + 수신 push. (스키마는 그룹 D 의존)
| # | 작업 | 난이도 | 규모 | 내용 |
|---|---|---|---|---|
| A1 | `POST /api/zalo/ext/send` | 중 | 소 | 공유 시크릿 검증 → 본문(threadId·text·이미지·답글·리액션) → 기존 `sendChatMessageAsAdmin`/`sendChatImageAsAdmin`/`sendChatReplyAsAdmin`/`addReactionAsAdmin`(테오 고정) 호출. 재사용으로 신규 로직 최소 |
| A2 | `GET /api/zalo/ext/threads` | 소 | 소 | 시크릿 검증 → `ownerAdminId=테오` 대화목록. 기존 대화 조회 쿼리 재사용. credential·마진·재고 절대 미포함 DTO |
| A3 | `GET /api/zalo/ext/messages?conversationId&before` | 소~중 | 소 | 시크릿 검증 → 테오 스코프 메시지 페이지. 기존 메시지 쿼리 재사용 |
| A4 | 수신 webhook push | 중 | 소~중 | `handleInboundEvent`가 신규 INBOUND 저장 직후 Nike webhook URL로 fire-and-forget POST(메시지 DTO). 실패는 무시(Nike 폴백 폴링). 기존 SSE emit과 병렬 추가 |
| A5 | 인증·격리 | 소 | 소 | `ZALO_EXT_SHARED_SECRET` env. ext 라우트 전부 `ownerAdminId=테오` 하드코딩(요청 파라미터로 안 받음). credential·마진·판매가 비공개 검증 |
| A6 | 기능 동등 — villa 측 신규 구현(R13 해소) | 중~상 | 중 | **forward**: `sendChatForwardAsAdmin`(원본 메시지를 다른 thread로 zca-js `forwardMessage`). **alias**: `ZaloConversation.nickname` 이미 존재 → ext `setAlias`는 nickname 갱신으로 매핑(스키마 무변경). **음성 STT**: `lib/gemini.ts`에 `transcribeVoice(audioBase64, mimeType)` 추가(기존 generateContent 패턴 재사용), 수신 voice 메시지 저장 시 STT→`text`/`translatedText` 채움. ext `/ext/send`에 forward 액션, `/ext/threads` 별칭 변경 엔드포인트 추가 |
| A7 | 그룹 발송·수신 처리 | 중 | 소~중 | 발송: thread가 GROUP이면 그룹 id로 `api.sendMessage`(zca-js 그룹 발송). 수신 핸들러: 그룹 이벤트의 발신자 uid를 `senderUid`에 저장, 멤버 변동 시 `groupMembers` 갱신. (그룹 D 스키마 의존) |

### 그룹 B — Nike : 테오 세션 떼기 + 송수신/읽기/SSE 전환
| # | 작업 | 난이도 | 규모 | 내용 |
|---|---|---|---|---|
| B1 | 테오 세션 로그인 제거 | 중 | 중 | `connectAllUsers` 루프 + `connectUser`/`ensureConnectionForUser`/`startQRLoginForUser`에서 **테오 userId 차단**(다른 계정 무영향). QR 화면도 테오는 "villa에서 관리" 안내 |
| B2 | 발송 → villa HTTP | 중 | 중 | 테오 userId일 때 `sendZaloMessage`/`sendZaloImage`/`sendZaloReaction`을 villa `POST /ext/send` 클라이언트로 위임. 인메모리 store 의존 제거(테오 한정) |
| B3 | 채팅 읽기 → villa 정본 | 상 | 중~대 | 테오 세션의 `recentchat`/`conversation`/`messages`/`poll`을 villa `/ext/threads`·`/ext/messages`로. villa 응답 → Nike `toApiMessage` 형식 어댑터(threadId/from/attachments URL/quote/reactions 매핑) |
| B4 | SSE 전파 교체 | 중 | 소~중 | Nike에 villa webhook 수신 라우트 신설 → 받은 메시지로 기존 `emitZaloMessage` 호출(프런트 `useZaloSSE` 무변경). webhook 미수신 시 `poll` 폴백 |
| B5 | 테오 고급기능 → villa 위임(R13) | 중 | 중 | 테오 userId일 때 Nike route의 `forward`/`setAlias`/`voiceTranslations`(STT) 액션을 villa ext로 위임(다른 Nike 계정은 기존 풀 경로 유지). villa 응답을 Nike UI 형식으로 어댑팅 |
| B6 | 테오 그룹 스레드 읽기·표시(R10) | 중 | 중 | 테오 세션의 그룹 스레드(`recentchat`/`conversation`/`groupMembers`)를 villa `/ext/threads`·`/ext/messages`에서 가져와 Nike `toApiMessage`(그룹 발신자·멤버) 형식으로 어댑팅 |

### 그룹 C — ETL (1회성, 별도 스크립트)
| # | 작업 | 난이도 | 규모 | 내용 |
|---|---|---|---|---|
| C1 | Nike→villa 과거 대화 이관 스크립트 | 상 | 중~대 | 위 대조표대로 ZaloThread/Message/Reaction(→Json)/Attachment(→재업로드 URL) 변환. 테오 accountId 필터, **threadType user+group 모두**(R10). 멱등(zaloMsgId), quote 2-pass, 대화 메타 재계산, 그룹은 threadType=GROUP·groupMembers·senderUid 채움. cross-DB 불가(C2)라 Nike DB read 덤프 → villa DB write(접속 정보 일회성 주입) 또는 villa의 일회성 import 엔드포인트 |
| C2 | 첨부 바이너리 재업로드(R12 해소) | 상 | 중 | thumbData(Bytes)를 villa 저장소(R2/볼륨)로 업로드 후 URL을 attachmentUrls에 기록(**영구 보존 확정**). 멱등 키 `nike-attach/{zaloMsgId}/{index}`(존재 시 skip), 실패 첨부는 `(zaloMsgId,index)` 재시도 큐, 동시성 제한(예 4). C1과 분리 실행 가능(메시지 본문 먼저 이관 → 첨부 사후 보강) |

### 신규 인프라 / 마이그레이션
- 신규 인프라: **없음**(villa ext 라우트 + env `ZALO_EXT_SHARED_SECRET`, `NIKE_WEBHOOK_URL`; Nike에 webhook 수신 라우트 1개 + `VILLA_EXT_BASE_URL`/시크릿 env). 음성 STT는 기존 `GEMINI_API_KEY`·`lib/gemini.ts` 재사용 — 신규 키·SDK 0.
- 마이그레이션: **그룹 D만 신규**(threadType·groupMembers·senderUid 3컬럼 + ZaloThreadType enum, 전부 additive). 본 ADR은 설계만 — 실제 `prisma migrate`는 S4에서 TDA 검토 후. 그 외(텍스트·첨부 ETL)는 데이터 이관일 뿐 스키마 무변경.

---

## 배포 순서 (세션 충돌 방지 — 절대 순서)

> 순서를 어기면 villa·Nike가 테오 계정으로 동시 로그인 → **code 3000 재발**(밴 위험).

1. **Nike 테오 세션 로그인 먼저 중단**(B1 배포) — Nike가 테오 계정을 더 이상 WebSocket 로그인하지 않음을 확인(풀에서 테오 인스턴스 부재).
2. **villa 허브 가동 확인** — villa `__system__` 인스턴스가 테오 세션을 단독 보유·connected.
3. **ETL 실행**(C) — 과거 대화 이관(멱등이라 가동 중 실행 가능).
4. **Nike 송수신 전환**(B2·B3·B4 배포) — villa ext API로 발송/읽기/SSE 전환.

롤백 시 역순: Nike 송수신 원복 → ETL 결과 보존(또는 무시) → **villa 세션 내림 후** Nike 테오 로그인 재기동(동시 로그인 금지 — villa 먼저 내려야 함).

---

## 인증·보안

- **공유 시크릿**: villa ext API(`/ext/send`·`/ext/threads`·`/ext/messages`)는 `ZALO_EXT_SHARED_SECRET`(env, 서버-서버 전용) 헤더 검증. Nike만 호출. 시크릿은 로그·응답 미기록.
- **credential 절대 미반환**: ext 응답 DTO에 `ZaloAccount.credentials` 절대 포함 금지(기존 `BotStatus`처럼 명시 select·제외). C4 준수.
- **테오 스코프 하드코딩**: ext 라우트는 `ownerAdminId=테오 villa userId`를 **요청 파라미터가 아닌 서버 상수**로 고정. 타 관리자/공급자 대화·villa 마진/판매가/전체 재고 0 반환(ADR-0007 격리 유지).
- **마진/판매가 비공개**: 채팅 데이터에는 원래 마진/판매가가 없으나, ext API가 실수로 villa 내부 가격 모델을 싣지 않도록 채팅 전용 DTO만 반환.
- **webhook 인증**: villa→Nike push도 공유 시크릿(또는 HMAC) 서명. Nike webhook 라우트가 검증.

---

## 롤백

- **A안 가역성**: villa 스키마 무변경이라 DB 롤백 불필요. ext 라우트 비활성화 + Nike 테오 로그인 코드 복원으로 분리 운영 즉시 복귀(배포 역순 + villa 세션 선(先) 내림).
- **통합 기간 데이터**: 통합 중 신규 대화는 villa 정본에만 쌓임. 롤백 시 "통합 기간 대화는 villa에 남음"을 명시(Nike로 역이관은 별도 ETL 필요 — 미수행).
- **credential 동일성 활용**: villa·Nike credential 암호화 방식이 동일(실사 확인)하므로, 최악의 경우 같은 `ZALO_CREDS_KEY`로 한쪽 암호문을 다른 쪽에서 복호화해 세션 재기동 가능(단 동시 로그인 금지 불변식은 유지).

---

## 리스크 (Nike 실사 반영)

| # | 리스크 | 영향 | 완화 |
|---|---|---|---|
| R1 | 세션 충돌 재발(code 3000) | 밴 위험·강제 종료 | 배포 순서 절대 준수(Nike 로그인 先중단). B1에서 테오 로그인을 **제거**(주석 아님). `connectAllUsers`·lazy connect·QR 3경로 모두 차단 |
| R2 | SPOF(허브 다운) | villa 다운 시 양쪽 정지 | 테오 수용 결정(②). 끊김 경보(ADR-0007 S6) 우선. C안 승격으로 격리 가능 |
| R3 | 모델 불일치 | 메시지 매핑 누락·표시 깨짐 | 정본 villa 단일화 + 대조표 어댑터. 양방향 동기화 금지 |
| R4 | credential·스코프 누수(C4) | 보안 위반 | ext credential 미반환 + ownerAdminId 하드코딩 + 공유 시크릿. QA 누수 회귀 테스트 |
| R5 | 수신 실시간성 저하 | Nike 새 메시지 지연 | webhook push 우선, `poll` 폴백. 기존 `useZaloSSE` 재연결·catch-up 재사용 |
| R6 | 타 관리자 격리 회귀 | 통합이 ADR-0007 스코프 깨면 누수 | ext는 테오 외 차단. Nike B1은 테오 userId만 분기(다른 계정 무변경). QA "ext로 타 관리자 조회→0건" 회귀 |
| R7 | (해소) Nike 구조 미확인 | — | **본 실사로 해소**. 변경 지점 4영역(pool/route/sse/store) 확정 |
| R8 | 롤백 시 동시 로그인 | code 3000 | 롤백도 순서 규칙(villa 先 내림 후 Nike 재기동) |
| R9 | 분리 가능성 | 사업 분리 시 정본 villa 종속 | A→C 승격 경로 보존(ext 계약 동일). 분리 시 ETL |
| R10 | **(해소 확정)** 그룹 채팅 | Nike엔 그룹 스레드·그룹 발송 존재, villa는 1:1 모델만 | **그룹 포함 확정**(테오). villa 스키마 확장(그룹 D: threadType·groupMembers·senderUid)·발송/수신/표시(A7·B6·D4)·ETL 그룹 포함(C1). 잔여 리스크 R14 |
| R11 | globalMsgId 부재 | villa 미보유 → quote 참조·리액션 매칭 약화 | ETL은 globalMsgId→zaloMsgId 2-pass 변환. 통합 후 신규는 cliMsgId 기반(villa 기존 방식) |
| R12 | **(해소 확정)** 첨부 바이너리 영구보존 | Nike는 thumbData를 DB Bytes로, villa는 URL String[]만 | **재업로드 확정**(C2): villa 저장소로 업로드 후 URL 기록. 멱등 키·재시도 큐·동시성 제한. 잔여 리스크 R15 |
| R13 | **(해소 확정)** 기능 동등 구현 | forward/setAlias/voice STT가 villa에 없음 | **동등 구현 확정**(A6·B5): forward 신규, alias=기존 nickname 매핑, STT=`lib/gemini.ts` 재사용. 축소 트레이드오프 폐기 |

### 신규 잔여 리스크 (풀스펙 확정으로 추가)
| # | 리스크 | 영향 | 완화 |
|---|---|---|---|
| R14 | 그룹 발신자 매핑 결손 | 멤버 탈퇴/이름변경 시 senderUid→이름 미해석 | groupMembers 스냅샷에 없으면 senderUid 원문 표시 폴백. 멤버 변동 시 수신 핸들러가 groupMembers 갱신(A7) |
| R15 | 첨부 재업로드 용량·시간 | 대량 바이너리 이관 시 저장소·시간 부담 | thumbData는 썸네일 위주라 부담 적음. 동시성 제한·재시도 큐·본문/첨부 분리 실행(C1·C2). 원본 대용량 첨부는 모니터링 후 정책화 |
| R16 | STT 비용·정확도 | 음성 다량 시 Gemini 호출 비용·오인식 | STT는 신규 수신·요청 시에만(과거 voice는 선택 보강). 결과는 캐시(translatedText처럼 1회). 모델 핀(GEMINI_MODEL)으로 교체 가능 |

### 남은 미확정 리스크
- **(없음 — R10/R12/R13 모두 확정 처리됨.)** 잔여는 위 R14~R16(구현 시 완화 가능한 운영 리스크).

---

## 단계적 도입 경로 (스프린트 — 풀스펙 확정 분할, 가치·의존도 순)

각 스프린트 독립 배포·롤백 가능. S1만으로 요구1(QR 1번+발송 공유) 충족 → MVP 가치 조기 실현. 그룹·고급기능(S4·S5)은 1:1 통합(S1~S3)이 안정된 뒤 얹는다.

| 스프린트 | 범위(작업) | 완료 기준(1줄) |
|---|---|---|
| **S1 — 세션 단일화 + 발송 위임** | villa A1·A5 + Nike B1·B2 | Nike에서 테오가 보낸 텍스트·이미지가 villa 허브 세션을 통해 실제 발송되고, Nike가 테오 계정을 더 이상 WebSocket 로그인하지 않는다(code 3000 무발생) |
| **S2 — 채팅 읽기 정본 전환 + SSE** | villa A2·A3·A4 + Nike B3·B4 | Nike 테오 채팅 목록·과거 메시지가 villa 정본에서 표시되고, 신규 수신이 webhook→SSE로 양쪽에 실시간 반영된다(폴백 poll 동작) |
| **S3 — ETL 텍스트 + 첨부 재업로드** | 그룹 C(C1·C2, 1:1 user 스레드 한정) | 통합 이전 테오 1:1 대화·메시지가 villa로 멱등 이관되고, 첨부 바이너리가 villa 저장소에 재업로드되어 과거 이미지가 깨짐 없이 보인다 |
| **S4 — 그룹 채팅** | 그룹 D(D1~D4 스키마 마이그레이션+UI) + villa A7 + Nike B6 + C1 그룹분 이관 | 테오의 Zalo 그룹 대화가 villa에서 발신자별로 표시·발송되고, 과거 그룹 대화도 이관되어 한 곳에서 조회된다 |
| **S5 — forward/alias/음성STT 동등** | villa A6 + Nike B5 | villa에서 메시지 전달(forward)·별칭(alias)·음성 자동 STT가 Nike와 동등하게 동작한다(STT는 `lib/gemini.ts` `transcribeVoice` 재사용) |
| (S6 — C안 승격, 트리거 시) | villa 세션 소유 코드를 zalo-gw로 분리 | 부하·가용성 문제 발생 시에만. ext 계약 유지 → villa·Nike는 호스트만 변경(버리는 작업 0) |

**의존도**: S1→S2→S3 순차(세션 단일화가 모든 것의 전제). S4는 S2(읽기·SSE) 위에 그룹 스키마(D)를 얹으므로 S2 이후. S5는 S1(발송 경로) 위에 액션을 추가하므로 S1 이후 어디서나 가능(독립성 높음 → S4와 병렬 가능).
