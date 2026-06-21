# 계약: Nike↔villa Zalo 통합 S2 — 채팅 읽기 정본 전환 + 실시간 수신(webhook→SSE) (ADR-0010 이행)

날짜: 2026-06-21 / 담당: villa=BE·INTEG / Nike=INTEG / 평가: QA
근거: docs/decisions/ADR-0010-nike-villa-zalo-session-chat-share.md (A안 채택·SPOF 수용·풀스펙 확정), WBS 그룹 A(A2·A3·A4)+그룹 B(B3·B4), 배포순서 절대규칙, ADR-0006(zca-js 단일봇), ADR-0007(멀티풀·`__system__`·ownerAdminId 격리), ADR-0009(첨부·번역·답글·리액션 DTO), lib/zalo-inbound.ts(saveInboundMessage)·lib/zalo-runtime.ts(handleInboundEvent)·app/(admin)/messages/page.tsx(읽기 select 화이트리스트). **선행 계약: docs/contracts/zalo-integration-s1.md(세션 단일화+발송 위임, 완료·QA통과·배포대기). 착수 선점 선언(이 계약 단독 커밋).**

## 배경
ADR-0010 A안(villa-pms를 Zalo 허브로 단독 보유, Nike는 villa ext API로 송수신)에서 **S1이 발송(Nike→villa 단방향 위임)**을 끝냈다. S2는 그 위에 **읽기·실시간 수신**을 얹어 요구2(채팅 데이터 공유 — 신규 분량)를 충족한다.
- **읽기 정본 전환**: Nike 테오 세션의 채팅 목록·메시지를 Nike 인메모리/DB가 아니라 **villa 정본(ZaloConversation/ZaloMessage)**에서 가져온다(B3 ← villa A2·A3).
- **실시간 수신 전파**: 테오 세션 수신 리스너는 이제 villa `__system__` 1개뿐이라 Nike엔 SSE 소스가 없다. villa가 새 메시지 저장 직후 **Nike로 webhook push**(A4)하고, Nike webhook 라우트가 받은 메시지를 **기존 `emitZaloMessage`로 흘려보내** 기존 SSE 파이프(`/api/zalo/events` + `useZaloSSE`)를 무변경으로 재사용한다(B4). webhook 미수신 시 Nike `poll` 폴백.

**방향 전환 핵심(S1과 다른 점)**: S1은 Nike→villa **단방향**(시크릿 1개로 충분). S2는 읽기(Nike→villa)에 더해 **수신 push가 villa→Nike로 방향이 반대**다. 이 역방향 webhook은 villa가 서명, Nike가 검증하는 **HMAC**로 인증한다(ADR-0010이 "공유 시크릿 또는 HMAC"으로 S2에 미뤄둔 항목 — 본 계약에서 HMAC으로 확정).

**절대 불변식(S1 계승)**: 테오 세션 수신 리스너는 villa `__system__` 인스턴스 **정확히 1개**(code 3000 회피). S2는 읽기·전파만 추가하므로 세션 소유 구조를 건드리지 않는다.

## ① 구현 범위

### villa-pms (허브) — BE/INTEG
- **A2 `GET /api/zalo/ext/threads`** (신규 라우트): S1 ext 시크릿(`ZALO_EXT_SHARED_SECRET`, `x-zalo-ext-secret` 헤더, `crypto.timingSafeEqual`) 게이트 → `ownerAdminId=테오`(서버 결정, S1 `getSystemBotOwnerId()`/env `ZALO_SYSTEM_OWNER_ID` 재사용, 요청 파라미터 미수용) 대화목록 반환. **쿼리는 messages/page.tsx 인박스 select(L119~144)를 그대로 재사용** — credential·마진·판매가·재고 모델 미참조. DTO는 채팅 전용(아래 ③ 화이트리스트).
- **A3 `GET /api/zalo/ext/messages?conversationId&before&limit`** (신규 라우트): 시크릿 게이트 → 테오 스코프(`where: { id, ownerAdminId: 테오 }`) 메시지 페이지. **쿼리는 messages/page.tsx 스레드 select(L184~222)를 재사용**. `before`(cursor: createdAt ISO 또는 메시지 id) + `limit`(기본 50, 상한 200) 페이지네이션. conversationId가 테오 대화가 아니면 404(타 관리자 누수 0). credential·마진 미반환.
- **A4 수신 webhook push** (신규 — `lib/zalo-inbound.ts`/`lib/zalo-runtime.ts` 호출부 보강): `handleInboundEvent`가 **신규 저장 직후** Nike webhook URL(`NIKE_WEBHOOK_URL` env)로 **fire-and-forget POST**(await 없이, 리스너 블로킹 금지). 페이로드는 A2/A3과 동일 메시지 DTO 1건. 실패는 무시(Nike `poll` 폴백). 기존 SSE emit이 villa엔 없으므로(villa는 폴링 — `messages/auto-refresh.tsx`) **기존 villa 폴링 경로는 무변경**, webhook push만 신규 병렬 추가. **(중요) 본인 발신(OUTBOUND echo, saveOutboundEcho)도 Nike 화면 일관성을 위해 push 대상에 포함** — 단 멱등(zaloMsgId)으로 Nike가 중복 무시.
  - **(B1 보강 — push 트리거 위치 정확화)** `handleInboundEvent`(zalo-runtime.ts:604~719)는 두 갈래다: INBOUND는 L684 `saveInboundMessage` 후, OUTBOUND echo는 L653 `saveOutboundEcho` 후 L668 별도 return. push 호출은 **두 저장 호출 각각의 반환이 `saved===true`인 직후에만** 넣는다(중복 멱등 `saved:false`면 미발송). **L649~652의 순수 비텍스트 OUTBOUND echo 조기 return 분기(saveOutboundEcho 미호출)는 push 하지 않는다**(저장 자체가 없으므로 정본·페이로드 부재). 즉 "saveInboundMessage saved:true" 한 곳이 아니라 **두 저장 지점 각각**에 push.
  - **(B3 보강 — 첨부 URL 도메인)** 페이로드 `attachmentUrls`는 **villa 저장소(R2/볼륨) 절대 URL**이어야 한다(상대경로 금지 — Nike 도메인 기준으로 깨짐). 신규 수신 첨부 저장 시 절대 URL로 기록되는지 확인 후 그대로 전달.
  - **(B4 보강 — webhook 타임아웃)** fire-and-forget POST에 **`AbortController` 타임아웃(3~5s)** 적용 — Nike 다운 시 dangling fetch가 리스너 스레드 자원을 잡지 않도록.
- **A4-HMAC villa 측 서명**: webhook 본문을 `ZALO_WEBHOOK_HMAC_SECRET`(env, 신규)로 **HMAC-SHA256 서명** → 헤더로 동봉(아래 ② webhook 인증). 서명 비밀·credential은 로그·페이로드 미포함.
- **인증·격리(S1 A5 계승)**: ext 읽기 라우트 전부 시크릿 게이트 + `ownerAdminId=테오` 서버 고정. 응답 DTO `ZaloAccount.credentials` 절대 미포함(select 화이트리스트 구조 차단). 채팅 전용 DTO만 — villa 마진/판매가/전체 재고 모델 비참조.

### Nike (C:\Projects\Nike) — INTEG
- **B3 채팅 읽기 → villa 정본** (`src/app/api/zalo/route.ts` GET, 테오 userId 분기): 테오 세션일 때 `recentchat`(L172)·`conversation`(L189)·`messages`(L202)·`poll`(L234)을 villa `GET /ext/threads`·`/ext/messages`로 위임. **(B2 보강 — poll 503 게이트 회피)** Nike `route.ts` L226 `if(!isZaloConnected(userId)) return 503`이 `switch(action)` **앞**에 있어, S1/B1 이후 테오는 미연결로 분류되어 `poll`(switch 내부 L234)이 도달 전 503으로 죽는다. 따라서 **테오 `poll`은 `recentchat`/`conversation`/`messages`와 동일하게 503 게이트보다 위(L172~224 영역)에서 villa 정본 폴링으로 재라우팅**해야 한다(안 그러면 ④ 폴백 poll 기준이 구조적으로 불충족). 다른 계정 poll은 기존 게이트 경로 유지. villa 응답 → Nike UI 형식 어댑터(`recentchat` 항목: `{userId,displayName,originalName,avatar,lastMessage,lastMessageTime,unreadCount,isGroup,...}` 형태 / `conversation`·`messages`: `toApiMessage` 형태로 threadId·from·attachments URL·quote·reactions 매핑). 다른 Nike 계정은 기존 풀/store 경로 유지(테오 userId만 분기). **S2는 1:1 USER 스레드만**(그룹 isGroup=false 폴백 — 그룹은 S4).
- **B4 SSE 전파 교체** (`src/app/api/zalo/` 하위 webhook 수신 라우트 신설 + 기존 SSE 재사용): villa webhook 수신 라우트(신규, 예 `POST /api/zalo/ext-inbound`) → **HMAC 검증**(`ZALO_WEBHOOK_HMAC_SECRET`, villa와 동일 값) → 받은 메시지 DTO를 기존 `emitZaloMessage(테오 userId, threadId, message)`(sse-emitter.ts:108)로 호출 → 기존 `/api/zalo/events`(events/route.ts) → `useZaloSSE`(use-zalo-sse.ts) 파이프로 흘려보냄. **프런트 `useZaloSSE`·`/api/zalo/events`·SSE 컴포넌트는 무변경**. webhook 미수신/HMAC 실패 시 기존 `poll` 폴백(B3로 villa 정본 폴링). 다른 Nike 계정 SSE는 기존 풀 리스너 경로 유지(무영향).

### 범위 밖 (S2 비포함 — 명시)
- 발송 위임(send/image/reply/reaction) → **S1**(완료, 본 계약 전제)
- ETL 과거 대화·첨부 이관 → **S3**
- 그룹 채팅 스레드 읽기·표시·스키마(threadType·groupMembers·senderUid) → **S4**(S2는 USER 스레드만)
- forward/alias/음성STT 동등 → **S5**
- villa 측 SSE 도입(villa 자체 UI는 기존 폴링 유지) — S2는 villa→Nike webhook만 추가, villa 내부 실시간화는 범위 밖
- **villa 스키마 변경 0건**(S2는 ext 읽기 라우트 2개 + webhook push 호출부 보강 + env 2개. 신규 컬럼은 S4)

## ② webhook 인증 설계 (villa→Nike HMAC — S2 신규 확정)

ADR-0010이 "공유 시크릿 또는 HMAC"으로 S2에 미뤄둔 역방향 webhook 인증을 **HMAC-SHA256**으로 확정한다(평문 시크릿 헤더보다 변조·재전송 방어 강함).

- **비밀 키**: `ZALO_WEBHOOK_HMAC_SECRET`(env, 양 레포 동일 값, 서버-서버 전용). S1의 `ZALO_EXT_SHARED_SECRET`(읽기·발송용)과 **별개 키**(역할·방향 분리 — 한쪽 유출이 다른 쪽을 열지 않음).
- **서명 대상**: `${timestamp}.${rawBody}`(rawBody = JSON 직렬화된 페이로드 문자열 그대로). timestamp는 webhook 발송 시각(epoch ms, 헤더로 동봉).
- **서명 헤더(villa→Nike POST)**:
  - `x-zalo-webhook-timestamp`: epoch ms
  - `x-zalo-webhook-signature`: `sha256=` + hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
- **Nike 검증**: ① timestamp가 현재 시각 ±5분 이내(재전송 윈도우 — 오래된 요청 거부) ② 본문으로 재계산한 HMAC을 `crypto.timingSafeEqual`로 비교(단순 `===` 금지) ③ 불일치/만료/누락 → **401**(emit 미수행).
- **페이로드(메시지 DTO 1건, A2/A3과 동일 스키마)**:
  ```jsonc
  {
    "ownerScope": "theo",            // 항상 테오(검증·라우팅 힌트, 신뢰 X — Nike는 HMAC만 신뢰)
    "conversationId": "<villa ZaloConversation.id>",
    "threadId": "<zaloUserId>",      // Nike emitZaloMessage threadId
    "message": {                      // Nike toApiMessage가 흡수하는 단일 메시지
      "id": "<ZaloMessage.id>",
      "zaloMsgId": "...", "cliMsgId": "...",
      "direction": "INBOUND|OUTBOUND",
      "msgType": "text|photo|file|...",
      "text": "...", "translatedText": "...|null",
      "attachmentUrls": ["..."],
      "quotedText": "...|null", "quotedSender": "...|null",
      "reactions": { "HEART": 2 } ,  // 집계 카운트(누수 무관)
      "createdAt": "<ISO>"
    }
  }
  ```
- **재전송/순서/멱등**: 멱등 키 = `message.zaloMsgId`. Nike emit·표시 측은 **zaloMsgId 기준 중복 무시**(이미 화면/store에 있으면 skip). 순서는 `createdAt`로 정렬(out-of-order 도착 허용). villa는 at-least-once(실패 무시·재시도 안 함 — Nike `poll`/B3 재조회가 누락 catch-up). **credential·시크릿·HMAC 비밀은 페이로드·로그에 절대 미포함.**

## ③ 읽기 DTO 누수 점검 (A2/A3 화이트리스트 — 절대 규칙)

ext threads/messages 응답은 **messages/page.tsx의 기존 select 화이트리스트만** 사용한다(신규 필드 추가 금지). 아래에 **없는 필드는 응답에 절대 포함 금지**.

- **threads(A2) 허용 필드**: `id, displayName, nickname, avatarUrl, counterpartyType, lastMessageAt, lastInboundAt, unreadCount` + 마지막 메시지 미리보기(`text, msgType` 1건) + 연결 사용자 표시명(`user.name`)·대표 빌라명(`user.villas[0].name`). **금지**: `ZaloAccount.credentials`, 빌라 `salePriceKrw/salePriceVnd/supplierCostVnd/marginType/marginValue`, 제안·정산 금액, 타 관리자(`ownerAdminId≠테오`) 대화.
- **messages(A3) 허용 필드**: `id, direction, source, msgType, text, translatedText, attachmentUrls, status, createdAt, quotedText, quotedSender, reactions`(집계 카운트). **금지**: credential·금액·마진·sentBy 외 내부 식별자 과다 노출(필요 최소). 공유 후보(villaCandidates/proposalCandidates/settlementCandidates)는 **A3 응답에 미포함**(그건 발송 모달 전용 — 읽기 DTO 아님).
- **마진 비공개 무관성 확인**: 채팅 데이터엔 원래 마진/판매가가 없으나, ext 쿼리가 실수로 villa 가격 모델(Villa.rates·Proposal·Settlement)을 join·반환하지 않도록 **채팅 전용 DTO만**. messages/page.tsx의 공유 후보 쿼리 블록(L277~420)은 ext 읽기에 **복제 금지**.
- **테오 스코프 격리**: A2는 `where ownerAdminId=테오`, A3은 `where { id, ownerAdminId: 테오 }`. conversationId 추측으로 타 관리자 대화 접근 → 404/빈 반환(ADR-0007 누수 0).

## ④ 테스트 가능한 완료 기준
- [ ] **읽기 목록 정본**: Nike UI 테오 채팅 목록(`recentchat`)이 villa 정본(`GET /ext/threads`)에서 표시된다(villa /messages 인박스와 동일 대화·순서·unread).
- [ ] **과거 메시지 정본**: Nike에서 테오 대화 스크롤 시 과거 메시지(`conversation`/`messages`)가 villa 정본(`GET /ext/messages`, before 페이지네이션)에서 로드된다.
- [ ] **실시간 수신(webhook→SSE)**: villa `__system__`가 새 INBOUND 수신 → Nike webhook 수신 → 기존 `emitZaloMessage`→`/api/zalo/events`→`useZaloSSE`로 Nike 화면에 **실시간 반영**(프런트 무변경 확인).
- [ ] **폴백 poll 동작**: webhook 미수신(URL 미설정/HMAC 실패/네트워크) 시 Nike `poll`이 villa 정본(B3)에서 신규 메시지를 가져와 누락 없이 표시.
- [ ] **ext 읽기 시크릿 게이트**: `/ext/threads`·`/ext/messages`가 `x-zalo-ext-secret` 없음/오류 시 **401**, 정상 시크릿 시에만 동작.
- [ ] **webhook HMAC 게이트**: Nike webhook 라우트가 서명 없음/오류/만료(±5분 밖) 시 **401**(emit 미수행), 정상 서명 시에만 emit.
- [ ] **ownerAdminId 테오 고정**: ext 읽기에 다른 ownerAdminId/conversationId(타 관리자) 주입 → 테오 스코프 외 0건/404(파라미터 주입 차단).
- [ ] **credential·마진 미반환**: ext threads/messages 응답·에러·로그 + webhook 페이로드에 `ZaloAccount.credentials`·`salePrice*`·`supplierCost*`·`margin*` 0건(QA grep + 동적).
- [ ] **타 관리자 격리 회귀(ADR-0007)**: ext 읽기로 테오 외 관리자 대화 조회 시도 → 0건/404(스코프 누수 0).
- [ ] **멱등·중복 무시**: 같은 zaloMsgId webhook 2회 도착 시 Nike 화면 중복 메시지 0(zaloMsgId dedup).
- [ ] **세션 단일성 회귀(S1)**: S2 배포 후에도 테오 세션 리스너는 villa `__system__` 단독, 양쪽 `code 3000` 0건.
- [ ] **villa 무변경 회귀**: villa /messages(페이지·발송·번역·리액션) + vitest 전체 green, tsc 0, next build 통과. webhook push 호출부 보강이 기존 수신 저장 동작을 깨지 않음(saveInboundMessage 반환·메타 갱신 무변경).

## ⑤ 검증 방법 (QA — 작성자≠평가자)
1. **시크릿 게이트**: `/ext/threads`·`/ext/messages`에 시크릿 미포함/오류/정상 3케이스 → 401/401/정상.
2. **HMAC 게이트**: Nike webhook 라우트에 ⓐ 서명 없음 ⓑ 위조 서명 ⓒ 만료 timestamp ⓓ 정상 4케이스 → 401/401/401/정상(emit). timingSafeEqual 사용 grep 확인.
3. **누수 grep + 동적**: ext 라우트 2개 + webhook push 소스 grep(`credentials`·`salePrice`·`supplierCost`·`margin`) 0건 + 실응답/페이로드 본문 동적 확인 0건.
4. **스코프 주입**: ext 읽기에 타 관리자 conversationId·ownerAdminId 주입 → 테오 외 0건/404 실증.
5. **읽기 정본 일치**: villa /messages 인박스·스레드 ↔ Nike `recentchat`·`conversation` 동일 데이터 대조(테오 협조 실측).
6. **실시간/폴백**: 상대→테오 발신 시 (a) webhook 정상 시 Nike 즉시 표시, (b) webhook 차단 시 `poll`로 표시(둘 다 누락 0). 멱등 중복 0 확인.
7. **회귀**: vitest 전체 green(기존 zalo·notification·inbound 단위 테스트 회귀 0), tsc 0, next build 통과. villa /messages 폴링·발송 무변경 확인.

## ⑥ 수정 금지 구역 (병렬 세션 보호)
**villa-pms** — 다른 세션 미커밋 WIP(2026-06-21 git status 기준), 절대 비접촉:
- `lib/cleaning.ts`, `lib/hold.ts`, `lib/proposal.ts` (타 세션 WIP — git status M)
- `LAUNCH.md`, `partB-evidence-*.png` (타 세션 untracked)
- 공유 파일은 **추가만 + 즉시 커밋**: `docs/INDEX.md`(S1 행에 S2 멘션 추가만, 충돌 시 양보), `.env`/Railway 변수(추가만: `NIKE_WEBHOOK_URL`, `ZALO_WEBHOOK_HMAC_SECRET`). `messages/*.json`·`globals.css`·`package.json` 변경 없음(서버 라우트 위주).

**S2 신규 충돌 가능성(S1 대비 명시)**: S2는 **villa `lib/zalo-inbound.ts`·`lib/zalo-runtime.ts`를 건드린다**(A4 webhook push 호출부 보강). S1은 신규 ext 라우트 파일 위주라 이 두 파일을 수정하지 않았으나, 두 파일은 ADR-0009 등 다른 INTEG 작업의 중심이기도 하다. **착수 전 `git pull`+`git status`로 이 두 파일에 미커밋 WIP가 있는지 확인**하고, 있으면 해당 세션과 조율(같은 함수 동시 수정 금지). A4 보강은 기존 `saveInboundMessage`/`saveOutboundEcho` **반환 직후 fire-and-forget push 1줄 추가**에 한정 — 기존 로직·시그니처 변경 금지(충돌 표면 최소화). webhook push는 가급적 `lib/zalo-webhook.ts`(신규 파일)로 분리하고 runtime은 호출만 추가.

**Nike (C:\Projects\Nike)** — 별도 레포·별도 세션 경계:
- villa 세션은 Nike 파일을 직접 수정하지 않는다. B3·B4는 Nike INTEG 세션이 Nike 레포에서 수행. villa 세션은 ext 읽기 API 계약(요청/응답 스키마) + webhook 페이로드·HMAC 계약만 **본 계약에 고정**해 양 레포 독립 작업 보장.
- Nike 무변경 보호: `src/hooks/use-zalo-sse.ts`, `src/app/api/zalo/events/route.ts`, `src/lib/sse-emitter.ts`(emit 함수)는 **무변경 재사용**(B4는 webhook 수신 라우트만 신설 + 기존 emit 호출). 프런트 SSE 컴포넌트 무변경.

## ⑦ 보안 체크 (사업 핵심 원칙 + ADR-0010 C4)
- credential(평문/암호문) ext 읽기 응답·webhook 페이로드·로그·AuditLog·SSE 미노출 (AES-256-GCM, ZALO_CREDS_KEY).
- ownerAdminId 테오 고정 — 타 관리자/공급자 대화·villa 마진·판매가·전체 재고 0 반환(읽기 화이트리스트 ③).
- webhook HMAC: villa 서명·Nike 검증, timingSafeEqual, ±5분 재전송 윈도우, HMAC 비밀 미노출.
- ext 시크릿·HMAC 비밀은 서버-서버 전용, 클라이언트·로그 미노출. `ZALO_EXT_SHARED_SECRET`(읽기)과 `ZALO_WEBHOOK_HMAC_SECRET`(webhook) **분리**.
- 채팅 전용 DTO만 — villa 가격 모델(Villa.rates/Proposal/Settlement) join·반환 금지(마진 비공개 무관성).

## ⑧ 배포 순서 (S1 활성 전제 — 절대 규칙)
> S2 읽기는 S1(세션 단일화)이 떠 있어야 의미가 있다. S1 발송 위임이 활성이고 villa `__system__`가 테오 세션 단독 보유한 상태가 전제. **S2는 villa 스키마 무변경**이라 DB 마이그레이션 없음.

1. **S1 활성 확인** — villa `__system__` 테오 세션 단독 connected, Nike 풀에 테오 인스턴스 부재(S1 ⑥ 검증 통과). 미충족 시 S2 배포 보류.
2. **villa A2·A3·A4 배포** — ext 읽기 API + webhook push 가동. env `ZALO_EXT_SHARED_SECRET`(S1 기존), `NIKE_WEBHOOK_URL`·`ZALO_WEBHOOK_HMAC_SECRET`(신규) 설정. 이 시점엔 Nike가 아직 villa 읽기를 안 쓰고 webhook 수신 라우트도 없어 무해(push는 404로 버려짐 — fire-and-forget).
3. **Nike B4 배포** — webhook 수신 라우트 + HMAC 검증 + emit 전파. villa webhook이 Nike SSE로 흐르기 시작(읽기 전환 전이라도 신규 수신은 실시간 표시).
4. **Nike B3 배포** — 읽기를 villa 정본으로 전환. 이후 Nike 테오 목록·과거 메시지가 villa에서 옴.

롤백 시 역순: B3 원복(읽기 Nike 로컬 복귀 — S3 ETL 전이면 과거 누락 가능, 명시) → B4 원복(webhook emit 중단, poll 폴백) → villa A2·A3·A4 비활성. **세션 소유는 S2가 안 건드리므로 code 3000 위험 없음**(S1 세션 구조 불변).

## 테오(사업주) 액션 (S2 배포 시)
- **villa Railway 환경변수 추가**: `NIKE_WEBHOOK_URL`(Nike webhook 수신 라우트 URL), `ZALO_WEBHOOK_HMAC_SECRET`(강한 랜덤 — webhook 서명용, ext 시크릿과 다른 값).
- **Nike Railway 환경변수 추가**: `ZALO_WEBHOOK_HMAC_SECRET`(villa와 동일 값), `VILLA_EXT_BASE_URL`·`ZALO_EXT_SHARED_SECRET`(S1 기존 재사용 — 읽기 호출용).
- **배포 순서 협조**: villa(A2·A3·A4) → Nike B4 → Nike B3. S1이 활성(테오 세션 villa 단독)인지 먼저 확인.
- **실측 검증**: 상대→테오 발신이 Nike에 실시간 표시(webhook), webhook 차단 시 poll로 표시. villa /messages와 Nike 목록 동일.
