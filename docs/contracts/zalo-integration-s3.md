# 계약: Nike↔villa Zalo 통합 S3 — 과거 대화·첨부 ETL 이관 (ADR-0010 이행)

날짜: 2026-06-21 / 담당: villa=BE·INTEG / 평가: QA
근거: docs/decisions/ADR-0010-nike-villa-zalo-session-chat-share.md (A안 채택·정본=villa·SPOF 수용·풀스펙 확정), WBS 그룹 C(C1·C2), "Nike↔villa 모델 필드 대조표"·"ETL 멱등성·중복방지·순서"·배포순서 절대규칙, ADR-0006(zca-js 단일봇), ADR-0007(`__system__`·ownerAdminId 격리), ADR-0009(첨부·번역·답글·리액션 DTO), prisma/schema.prisma(villa ZaloConversation/ZaloMessage), `C:\Projects\Nike\prisma\schema.prisma`(ZaloThread/ZaloMessage/ZaloAttachment/ZaloReaction), lib/storage.ts(saveFile R2/디스크)·lib/zalo-inbound.ts(saveInboundMessage 레코드 형태)·lib/zalo-credentials.ts(getSystemBotOwnerId). **선행 계약: docs/contracts/zalo-integration-s1.md(세션 단일화+발송 위임)·zalo-integration-s2.md(읽기 정본+webhook→SSE) — 둘 다 완료·QA통과·배포대기. 착수 선점 선언(이 계약 단독 커밋).**

## 배경
ADR-0010 A안에서 정본 = **villa**, ETL은 Nike(원천)→villa(정본) **단방향·일회성**. S1(발송)·S2(읽기·실시간)가 *통합 이후* 신규 송수신을 villa 정본으로 흐르게 했다. 그러나 통합 *이전* Nike에 쌓인 테오 과거 대화·메시지·첨부는 villa에 없다 — 테오가 "한 곳에서 전체 이력 조회"(요구2의 과거분)를 하려면 이 과거 데이터를 villa로 옮겨야 한다. S3는 그 **일회성 데이터 이관(ETL)**이다.

- **C1 — 대화·메시지 이관**: Nike `ZaloThread`+`ZaloMessage`(+`ZaloReaction` 집계)를 villa `ZaloConversation`+`ZaloMessage`로 모델 대조표대로 변환·삽입.
- **C2 — 첨부 영구보존**: Nike `ZaloAttachment`를 villa 저장소(R2/디스크)로 **재업로드**하고 그 절대 URL을 `attachmentUrls`에 기록(R12 해소 — URL 참조 아님, 영구 보존). **(H1 정정 — 원본 우선)** Nike `ZaloAttachment`에는 `originalUrl String?`(Zalo CDN 원본)와 `thumbData Bytes?`(주석상 "압축 썸네일 <50KB")가 **둘 다** 있다. 썸네일만 옮기면 과거 이미지가 영구 저화질로 박제되므로(사용자 요구=고화질 영구보존 위반), 이관원 우선순위는 **① `originalUrl` 다운로드(원본 화질) → ② 실패/만료 시 `thumbData` 폴백 → ③ 둘 다 없으면 skip + 로그**. ETL은 통합 전환 시점 일회 실행이라 CDN URL이 대개 살아있다. 폴백/실패 건수는 `original / thumb-fallback / failed`로 분리 집계.

**S3 범위 한정(절대)**: **1:1 USER 스레드만**(`ZaloThread.threadType="user"`). 그룹(`="group"`)은 villa에 `threadType`/`groupMembers`/`senderUid` 컬럼이 아직 없으므로(스키마 D, S4 마이그레이션) **전부 건너뜀** — S4 범위.

**절대 불변식(S1/S2 계승)**: 테오 세션 리스너는 villa `__system__` 1개(code 3000 회피). **S3는 데이터 이관일 뿐 세션 소유·리스너를 일절 건드리지 않는다.** ETL은 zca-js 세션을 열지 않는다(순수 DB read/write + 저장소 업로드).

## ① 구현 범위

### villa-pms (스크립트) — BE/INTEG
- **C1+C2 ETL 스크립트**: 신규 파일 `scripts/etl-nike-zalo.ts`(villa 레포). **일회성 운영자 수동 실행**(cron 아님 — cron 라우트 규칙·CRON_SECRET 무관). Nike DB read + villa DB write + 첨부 villa 저장소 업로드.
- **실행 방식**: `npx tsx scripts/etl-nike-zalo.ts [--dry-run] [--limit N] [--attachments-only]`. dry-run은 read·집계·로그만(쓰기 0). 기본 실행은 본문 이관 + 첨부 재업로드.
- **재사용(신규 로직 최소)**: 첨부 업로드는 `lib/storage.ts`의 R2/디스크 백엔드 선택 로직을 재사용하되, **멱등 키(`nike-attach/{zaloMsgId}/{index}`) 고정 + 존재 시 skip**이 필요하므로 saveFile(랜덤 파일명) 대신 ETL 전용 `putAttachmentByKey(buffer, mimeType, key)` 헬퍼를 같은 R2 클라이언트·버킷·publicUrl로 구현(저장소 설정·MIME 화이트리스트 검증은 storage.ts 패턴 차용). 레코드 형태(direction·source·msgType·attachmentUrls·zaloMsgId·cliMsgId·quoted*·status)는 **`lib/zalo-inbound.ts` saveInboundMessage가 만드는 형태와 일관**되게 생성(아래 ② 매핑표).

### Nike DB 접근 (권고안 — ②-A에서 확정)
- cross-DB 직접 쿼리 불가(ADR-0010 C2: 별도 Railway·별도 PostgreSQL). 두 후보:
  - **(권고) 직접 연결**: villa 스크립트에서 env `NIKE_DATABASE_URL`(읽기 전용 자격이 이상적)로 별도 Prisma/pg 클라이언트를 만들어 Nike를 **읽기만** 한다. 한 프로세스에서 read→transform→write가 끝나 첨부 바이너리(Bytes)를 중간 JSON으로 직렬화·디스크 경유할 필요가 없다(대용량 Bytes에 유리).
  - (대안) export→import: Nike 측에서 JSON+첨부 덤프 → villa가 import. 운영 단계가 둘로 늘고 Bytes를 base64로 부풀려 디스크를 거치므로 **비권고**(단, Nike DB에 villa 프로세스가 닿지 못하는 네트워크 격리 상황에서만 폴백).
- **보안**: `NIKE_DATABASE_URL`은 env 전용(로그·커밋·계약서에 값 노출 금지), 가능하면 **읽기 전용 role**. ETL은 Nike를 **읽기만** — Nike에 write 0. credential 컬럼(`ZaloAccount.credentials`)은 **select하지 않는다**(이관 대상 아님 — villa가 세션 단독 보유, ADR-0010 ④).

### 범위 밖 (S3 비포함 — 명시)
- 그룹 스레드(threadType=group) 이관·스키마(threadType/groupMembers/senderUid) → **S4**(C1 그룹분 + 스키마 D). S3은 USER만.
- 발송/읽기/실시간 → **S1/S2**(완료, 본 계약 전제).
- forward/alias/음성STT 동등 → **S5**.
- **villa 스키마 변경 0건**(S3은 기존 ZaloConversation/ZaloMessage에 INSERT/UPDATE만 — 신규 컬럼 불필요. 신규 컬럼은 S4). **마이그레이션 0건.**
- Nike→villa 역방향·양방향 동기화 금지(단방향 일회성만, ADR-0010 R3).

## ② 모델 매핑표 (Nike 원천 → villa 정본 — 1:1 USER 한정)

정본 = villa. 필터: Nike `ZaloThread.accountId` = 테오 `ZaloAccount`(`userId`=테오 Nike userId `cmmdavtkx00001dqytx9v1ss2`로 식별) **그리고** `threadType="user"`. villa 소유자 = `ownerAdminId` = 테오 villa userId.

### 테오 식별 (양쪽 — 하드코딩 금지)
- **villa ownerAdminId**: `lib/zalo-credentials.ts` `getSystemBotOwnerId()`(kind=SYSTEM_BOT·isActive=true DB 동적 해석) 재사용 — 리터럴 ID 인라인 금지(seed/재마이그레이션 시 변동·진실원천 이원화 방지). 현 값은 참고로 `cmq9dzydp0000uk94gx0ip100`이나 **코드는 동적 해석**. 해석 실패(null) 시 ETL은 즉시 중단(테오 스코프 없이 쓰면 안 됨).
- **Nike 테오 accountId**: `ZaloAccount where userId = 테오 Nike userId`(env `NIKE_THEO_USER_ID`, 기본/문서값 `cmmdavtkx00001dqytx9v1ss2`)로 조회해 `accountId` 산출. 그 accountId의 USER 스레드만 이관.

### 대화 (Nike ZaloThread → villa ZaloConversation)
| Nike ZaloThread | villa ZaloConversation | 매핑 규칙 / 기본값 |
|---|---|---|
| zaloThreadId | zaloUserId | 그대로(상대 Zalo id) |
| displayName | displayName | 그대로(빈 문자열이면 null) |
| avatar | avatarUrl | 그대로(`""`이면 null) |
| lastMessageTime | lastMessageAt | **직접 매핑 안 함** — 메시지 삽입 후 `max(message.createdAt)`로 **재계산**(아래 ③) |
| unreadCount | unreadCount | **0으로 리셋**(이관분은 과거 — 미독 카운트 무의미, ADR-0010 권장) |
| threadType="user" | (필터 조건) | "user"만 통과. "group"은 skip(S4) |
| (없음) | ownerAdminId | **테오 villa userId 고정**(getSystemBotOwnerId) |
| (없음) | userId(공급자 매칭) | **null**(과거 이관은 전화매칭 미수행 — 전역 User.zaloUserId 오염 방지. 신규 수신만 매칭, saveInboundMessage 정책 계승) |
| (없음) | counterpartyType | **기본 UNKNOWN**(과거 분류 미상 — 누수 안전측. ADMIN 수동 분류 fallback) |
| (없음) | translateMode | **기본 VI**(스키마 @default) |
| (없음) | nickname / lastInboundAt | nickname=null. lastInboundAt = max(INBOUND message.createdAt) 재계산(없으면 null) |
| **id** | id | **신규 cuid**(Nike id 미이식 — 충돌 회피). 멱등 키는 `(ownerAdminId, zaloUserId)` 복합 유니크 |

### 메시지 (Nike ZaloMessage → villa ZaloMessage)
| Nike ZaloMessage | villa ZaloMessage | 매핑 규칙 / 기본값 |
|---|---|---|
| zaloMsgId | zaloMsgId | **그대로(멱등 키)** — villa `@unique`라 재실행 시 충돌→skip |
| direction "sent"/"received" | direction OUTBOUND/INBOUND | sent→OUTBOUND, received→INBOUND |
| (파생) | source | OUTBOUND→`CHAT`, INBOUND→`USER` |
| msgType "text/image/file/sticker/voice" | msgType(String) | 그대로(villa String). Nike "image"는 villa 컨벤션 "photo"로 정규화 권장(classifyInbound와 일치), 그 외 동일 |
| text | text | 그대로(빈 문자열이면 null) |
| translatedText | translatedText | 그대로 |
| timestamp | createdAt | **그대로(정렬·이력 보존)** — `@default(now())` 무시하고 명시 set |
| cliMsgId | cliMsgId | 그대로(없으면 null) |
| globalMsgId | (없음) | **드롭**. 단 quote 해석에 필요 → ETL 단계에서 `globalMsgId→zaloMsgId` 사전 구축(아래 ③ 2-pass) |
| senderUid | (없음, S4) | **드롭**(USER 1:1은 상대 고정 — 발신자 식별 불필요. 그룹은 S4) |
| quoteText | quotedText | 그대로 |
| quoteSender | quotedSender | 그대로 |
| quoteMsgId(=globalMsgId) | quotedMsgId(=zaloMsgId) | **변환**: quoteMsgId(globalMsgId)를 사전으로 zaloMsgId로 치환해 채움(미해석 시 null + quotedText/Sender 스냅샷은 유지) |
| quoteMsgType | (없음) | 드롭 |
| reactions(ZaloReaction[] 별 테이블) | reactions(Json 집계) | **아이콘별 카운트 집계** `{ "<icon>": count }`(ADR-0009 — 누가 달았는지 불필요). 빈 경우 null |
| attachments(ZaloAttachment[]) | attachmentUrls(String[]) | **C2**: 각 첨부를 **originalUrl 우선 다운로드 → 실패 시 thumbData 폴백**으로 받아 villa 저장소에 `nike-attach/{zaloMsgId}/{index}` 키로 업로드 → 절대 URL을 배열에 누적(아래 ③ 첨부 전략) |
| attachment.ocrTranslatedText | (메시지) translatedText | **(H2)** 첨부의 OCR/음성STT 결과. 메시지 `translatedText`가 null/빈 voice·image 메시지에 한해 이 값으로 **보강**(과거 STT·OCR 자산 소실 방지). 메시지 본문 translatedText가 이미 있으면 덮지 않음 |
| status(없음) | status | **기본 SENT**(이미 송수신 완료된 과거 메시지) |
| sentBy | sentBy | OUTBOUND는 테오 villa userId, INBOUND는 null(saveInboundMessage 형태 계승) |
| error | error | null |
| **id** | id | **신규 cuid**(Nike id 미이식 — 충돌 회피) |

**누락 필드 기본값 원칙**: villa 비필수 컬럼은 스키마 @default 또는 null. id는 항상 villa cuid 신규 발급(Nike id 절대 이식 금지 — 충돌·진실원천 이원화 방지). 멱등은 오직 `zaloMsgId`(메시지)·`(ownerAdminId,zaloUserId)`(대화)로만.

## ③ 멱등성·quote 2-pass·첨부 R2 키 전략 (가장 중요)

### 멱등성 (재실행해도 증가 0)
- **대화 멱등 키 = `(ownerAdminId, zaloUserId)`**(villa `@@unique`). `upsert(where: ownerAdminId_zaloUserId, update:{}, create:{...})` — 이미 있으면 메타만 재계산, 신규 생성 0.
- **메시지 멱등 키 = `zaloMsgId`**(villa `@unique`). 삽입 전 `findUnique({where:{zaloMsgId}})` 존재 시 skip(saveInboundMessage와 동일 패턴). 또는 `createMany({skipDuplicates:true})` + zaloMsgId 유니크 충돌 무시. **재실행 시 신규 메시지 0건이 완료 기준.** **(주의)** Nike는 `@@unique([zaloMsgId, accountId])`라 zaloMsgId가 Nike 내 전역 유니크가 아니다 — 본 ETL이 **테오 단일 accountId로 필터하는 전제 하에서만** zaloMsgId가 villa 전역 `@unique`와 1:1로 멱등 성립한다(S4 그룹/다계정 확장 시 동일 zaloMsgId 혼입 주의).
- **첨부 멱등 키 = R2 객체 키 `nike-attach/{zaloMsgId}/{index}`**(아래). 동일 키 존재 시 재업로드 skip → 동일 URL 재사용. zaloMsg 없는 첨부(zaloMsgId null)는 이관 불가로 skip + 로그.

### quote 2-pass (인용 대상이 뒤에 올 수 있음)
1. **1-pass — 전체 메시지 삽입**: USER 스레드 전 메시지를 createdAt 순으로 삽입. 동시에 `globalMsgId→villa ZaloMessage.id`(및 `→zaloMsgId`) 사전을 메모리에 구축. 이 시점 `quotedMsgId`는 **임시 미연결**(인용 원본이 아직 안 들어왔을 수 있음).
2. **2-pass — quote 연결**: quote 있는 메시지마다 Nike `quoteMsgId`(globalMsgId)를 사전으로 villa의 대응 `zaloMsgId`로 치환해 `quotedMsgId` UPDATE. **UPDATE 대상 행은 인용하는 메시지 자신을 그 메시지의 `zaloMsgId @unique`로 찾아(`where:{zaloMsgId:<인용메시지 zaloMsgId>}`) `quotedMsgId` 필드만 set** — id 추측 불필요. 사전에 없으면(원본이 이관 범위 밖·삭제) `quotedMsgId=null` 유지하되 `quotedText`/`quotedSender` 스냅샷은 1-pass에서 이미 채워져 있어 **인용 블록은 표시 가능**(villa quote는 스냅샷 기반 — FK 아님). Nike `resolveQuoteMsgIds` 패턴 차용.
- 재실행 멱등: 2-pass UPDATE도 동일 결과(idempotent) — quotedMsgId가 이미 맞으면 no-op.

### 첨부 R2 키 전략 (C2 — 영구보존·멱등)
- **소스 우선순위(H1)**: ① `originalUrl` HTTP GET(원본 화질) → ② 실패/만료(4xx/5xx/타임아웃) 시 `thumbData`(Bytes) 폴백 → ③ 둘 다 없으면 skip + 로그. 각 첨부가 어느 소스로 보존됐는지 `original / thumb-fallback / failed` 카운터로 집계(전건 로그, silent cap 금지).
- 키 = **`nike-attach/{zaloMsgId}/{index}`**(index = 메시지 내 첨부 순번 0..n). zaloMsgId가 유니크하므로 키 충돌 없음 + 재실행 시 동일 키.
- **존재 시 skip**: 업로드 전 R2 HeadObject(또는 디스크 파일 존재) 확인 → 있으면 업로드 생략하고 `{publicUrl}/{key}` 그대로 사용(멱등·대역폭 절약).
- **절대 URL 필수**: `attachmentUrls`는 **villa 저장소 절대 URL**(R2: `https://{publicUrl}/{key}`, 디스크: `/uploads/...`는 상대지만 villa 도메인 서빙 — Nike 화면에서 깨지지 않게 S2 webhook과 동일 "절대 URL" 원칙 적용. R2 모드 권장). 상대경로로 인한 깨짐 0이 완료 기준.
- **mimeType/fileName**: Nike `ZaloAttachment.mimeType`(없으면 type으로 유추: image→image/jpeg 등) 사용. 이미지가 아닌 일반 파일(file/voice 등)도 thumbData가 있으면 같은 키 체계로 업로드(storage.ts MIME 화이트리스트는 ETL에서 완화 — 과거 데이터 보존 목적이므로 octet-stream 허용).
- **실패 격리·재시도**: 첨부 업로드 실패는 `(zaloMsgId,index)` 단위로 실패 목록에 기록하고 ETL 종료 후 재시도 패스. **메시지 본문은 이미 삽입됐으므로** 첨부만 사후 보강(`--attachments-only`로 재실행 → 멱등 키로 성공분 skip·실패분만 재시도). 동시성 제한(예: 동시 4건)으로 저장소 부하 통제. **silent cap 금지** — 처리/성공/skip/실패 건수를 전부 로그.

### 대화 메타 재계산 (메시지 삽입 후 집계)
각 대화: `lastMessageAt = max(message.createdAt)`, `lastInboundAt = max(INBOUND message.createdAt)`(없으면 null), `unreadCount = 0`으로 UPDATE. (lastMessageTime을 직접 옮기지 않고 실제 삽입된 메시지 기준 — 부분 이관·재실행에도 일관.)

## ④ 테스트 가능한 완료 기준
- [ ] **멱등 이관(증가 0)**: Nike 테오 1:1 USER 대화 N건·메시지 M건을 1차 실행으로 villa 정본에 이관 → **2차 실행(재실행) 시 신규 대화 0·신규 메시지 0**(count 불변). createMany skipDuplicates 또는 findUnique skip로 검증.
- [ ] **대화 매핑 정확**: villa ZaloConversation이 `ownerAdminId=테오`·`zaloUserId=Nike zaloThreadId`·displayName/avatarUrl 매핑·counterpartyType=UNKNOWN·translateMode=VI·unreadCount=0으로 생성.
- [ ] **메시지 매핑 정확**: direction(sent→OUTBOUND/received→INBOUND)·source(CHAT/USER)·msgType(image→photo 정규화)·text·translatedText·createdAt(=Nike timestamp, 정렬 보존)·cliMsgId·status=SENT 매핑.
- [ ] **첨부 R2 영구보존·깨짐 0(원본 우선)**: 과거 첨부가 **originalUrl 우선(실패 시 thumbData 폴백)**으로 `nike-attach/{zaloMsgId}/{index}` 키로 villa 저장소에 재업로드되고, attachmentUrls가 **villa 절대 URL**로 기록되어 접근 시 200(깨짐 0). 표본 이미지가 썸네일(<50KB)이 아닌 원본 해상도임을 확인. 로그에 `original/thumb-fallback/failed` 분리 집계, `original`>0. 재실행 시 동일 키 skip(재업로드 0).
- [ ] **STT/OCR 보존(H2)**: Nike `ocrTranslatedText` 있는 voice/image 첨부의 값이 villa 대응 메시지 `translatedText`(본문이 비었을 때)로 보강됨.
- [ ] **quote 연결 정확**: quote 있는 메시지의 quotedMsgId가 villa 대응 메시지의 zaloMsgId로 연결되고(2-pass), 인용 원본이 범위 밖이면 quotedText/Sender 스냅샷으로 표시(quotedMsgId=null 허용).
- [ ] **대화 메타 일치**: 각 대화 lastMessageAt=삽입 메시지 max(createdAt), unreadCount=0.
- [ ] **그룹 skip(S4)**: threadType="group" 스레드·메시지는 0건 이관(건너뜀 로그 확인).
- [ ] **테오 스코프 외 미생성**: ownerAdminId=테오 외 ZaloConversation/ZaloMessage 생성 0(다른 accountId·다른 관리자 데이터 미이관, ADR-0007 누수 0).
- [ ] **credential·마진 비참조**: ETL이 Nike `ZaloAccount.credentials`를 select·이관 0, villa 마진/판매가/재고 모델 비참조(채팅 데이터만). Nike DB write 0(읽기 전용).
- [ ] **dry-run 무쓰기**: `--dry-run`이 villa DB·저장소에 쓰기 0(집계·로그만), 본 실행 분량과 일치하는 예상 건수 출력.
- [ ] **분량 로그(silent cap 금지)**: 스레드/메시지/첨부 처리·성공·skip(멱등)·실패 건수가 전부 로그에 표시, 부분 실패 재시도(`--attachments-only`) 동작.

## ⑤ 검증 방법 (QA — 작성자≠평가자)
1. **멱등 회귀**: 1차 실행 후 villa count(ZaloConversation/ZaloMessage where ownerAdminId=테오) 기록 → 2차 실행 후 count 불변(증가 0) 실증.
2. **매핑 대조**: Nike 표본 스레드/메시지 K건을 villa와 필드별 대조(direction·source·msgType·createdAt·quote·reactions 집계). villa /messages 인박스에서 이관 대화 표시 확인.
3. **첨부 검증**: 표본 첨부 URL이 villa 절대 URL이고 HTTP 200(이미지 렌더), R2 객체 키가 `nike-attach/{zaloMsgId}/{index}` 형식. 재실행 시 업로드 0(skip 로그) 확인.
4. **quote 2-pass**: 인용 메시지가 정확한 원본을 가리키는지(quotedMsgId↔zaloMsgId), 범위 밖 인용은 스냅샷 표시 확인.
5. **그룹 격리**: threadType=group 입력이 있어도 villa에 GROUP 데이터 0건(건너뜀 로그).
6. **누수 grep + 동적**: ETL 소스 grep(`credentials`·`salePrice`·`supplierCost`·`margin`) 0건 + Nike 쿼리 select에 credentials 부재 확인. Nike DB write 쿼리 0(read만) 확인.
7. **dry-run**: `--dry-run` 후 villa count·R2 객체 수 변화 0.

## ⑥ 수정 금지 구역 (병렬 세션 보호)
**villa-pms** — 다른 세션 미커밋 WIP(2026-06-21 git status 기준), 절대 비접촉:
- `lib/cleaning.ts`, `lib/hold.ts`, `lib/proposal.ts` (타 세션 WIP — git status M)
- `LAUNCH.md`, `partB-evidence-*.png` (타 세션 untracked)
- **S3는 신규 파일(`scripts/etl-nike-zalo.ts`) 위주라 충돌 표면 최소**. `lib/zalo-inbound.ts`·`lib/storage.ts`·`lib/zalo-credentials.ts`는 **읽기(import·패턴 차용)만** — 수정 금지(기존 시그니처·로직 불변). 첨부 키 헬퍼(`putAttachmentByKey`)가 필요하면 storage.ts에 함수 **추가만** 가능하나, 우선 ETL 스크립트 내부 로컬 헬퍼로 두어 충돌 0을 권장.
- 공유 파일은 **추가만 + 즉시 커밋**: `docs/INDEX.md`(ADR-0010 행에 S3 멘션 추가만, 충돌 시 양보), `.env`/Railway 변수(추가만: `NIKE_DATABASE_URL`, `NIKE_THEO_USER_ID`). `messages/*.json`·`globals.css`·`package.json` 변경 없음(스크립트는 기존 deps `@aws-sdk/client-s3`·prisma·tsx 재사용 — 신규 의존성 도입 시 본 계약에 선언).

**Nike (C:\Projects\Nike)** — 별도 레포·별도 세션 경계:
- S3은 Nike 파일을 **수정하지 않는다**(읽기 전용 DB 접근만). Nike 측 코드 변경 0. ETL은 villa 레포 단독 작업.

## ⑦ 보안 체크 (사업 핵심 원칙 + ADR-0010 C4)
- **Nike DB 읽기 전용**: ETL은 Nike를 read만(write·delete 0). 가능하면 읽기 전용 role의 `NIKE_DATABASE_URL`.
- **credential 미이관**: Nike `ZaloAccount.credentials`(평문/암호문)를 select·이관·로그 0(villa가 세션 단독 보유 — 옮길 이유 없음).
- **마진 무관**: 채팅 데이터엔 마진/판매가 없음. ETL이 villa 가격 모델(Villa.rates/Proposal/Settlement) 비참조 — 채팅 전용.
- **`NIKE_DATABASE_URL` 노출 금지**: env 전용, 로그·응답·커밋·계약서에 값 미기록. ETL 로그는 건수·키만(원문 자격·바이너리 미출력).
- **테오 스코프 고정**: ownerAdminId=테오(getSystemBotOwnerId 동적), 해석 실패 시 중단. 다른 관리자 데이터 미생성.

## ⑧ 실행/롤백 전략
- **dry-run 우선**: 항상 `--dry-run`으로 예상 건수·매핑 검증 후 본 실행.
- **부분 실패 재시도**: 본문 이관(C1)과 첨부 보강(C2) 분리 실행 가능 — 본문 먼저 멱등 삽입 → `--attachments-only`로 첨부만 재시도(성공 키 skip·실패만). 동시성 제한(예 4)으로 저장소 부하 통제.
- **분량 로그**: 처리/성공/skip/실패 건수 전부 출력(silent cap 금지). 실패 첨부는 `(zaloMsgId,index)` 목록으로 남겨 재실행 타깃.
- **롤백**: ETL은 멱등 일회성이라 "잘못 이관" 시 villa에서 `ownerAdminId=테오 AND zaloMsgId IN (...)` 또는 이관 배치 식별로 삭제 가능(단, S1/S2 가동 후엔 신규 메시지와 섞이므로 **이관 전 백업** 권장). 첨부 R2 객체는 `nike-attach/` prefix로 일괄 식별·삭제 가능. **Nike 원천은 불변(read only)이라 재이관 항상 가능.**

## ⑨ 배포/실행 순서 (ADR-0010 ⑤ — 절대 순서)
> ADR-0010 배포순서: ① Nike 테오 로그인 중단(B1) → ② villa 허브 단독 보유 → ③ **ETL 실행(C)** → ④ Nike 송수신 전환(B2·B3·B4). ETL은 멱등이라 가동 중 실행 가능.

1. **선이관 가능 여부**: S3 ETL은 **villa 스키마 무변경**이라 S1/S2 배포 *전후 무관*하게 villa DB에 선이관 가능하다(과거 데이터는 신규 송수신과 zaloMsgId로 멱등 분리). 다만 ADR 권장 순서는 "세션 단일화(S1) 후 ETL" — 동시 로그인 위험은 ETL과 무관(ETL은 세션 미사용)하므로 **villa 허브 단독 확인 후 실행**을 따른다.
2. **운영자 수동 실행**: `npx tsx scripts/etl-nike-zalo.ts --dry-run` → 검증 → 본 실행. **cron 아님**(일회성). 테오 협조로 `NIKE_DATABASE_URL`·`NIKE_THEO_USER_ID`·villa 저장소(STORAGE_*) env 설정 후 실행.
3. **그룹 제외**: USER 스레드만. 그룹 이관은 S4(스키마 D 마이그레이션 후).

## 테오(사업주) 액션 (S3 실행 시)
- **villa Railway/로컬 env**: `NIKE_DATABASE_URL`(Nike PostgreSQL 읽기 전용 권장), `NIKE_THEO_USER_ID`(테오 Nike userId, 기본 `cmmdavtkx00001dqytx9v1ss2`), villa `STORAGE_*`(R2 — 첨부 영구보존, 미설정 시 디스크 폴백). villa `__system__` SYSTEM_BOT 계정 존재(getSystemBotOwnerId 해석용).
- **실행 순서 협조**: villa 허브 단독 보유 확인(S1 활성) → `--dry-run` 검증 → 본 실행 → 표본 검증(과거 대화·첨부 표시).
- **일회성**: ETL은 1회 실행이 원칙(멱등이라 재실행 안전). 첨부 실패분만 `--attachments-only` 재시도.
