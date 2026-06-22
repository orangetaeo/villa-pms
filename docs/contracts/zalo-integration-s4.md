# 계약: Nike↔villa Zalo 통합 S4 — 그룹 채팅 (ADR-0010 R10 해소)

날짜: 2026-06-22 / 담당: villa=TDA·BE·INTEG·FE / Nike=INTEG / 평가: QA
근거: docs/decisions/ADR-0010-nike-villa-zalo-session-chat-share.md (그룹 D1~D4·A7·B6·C1-그룹분, WBS·로드맵 S4·R10 해소·R14), ADR-0006(zca-js 런타임·ThreadType), ADR-0007(`__system__`·ownerAdminId 격리), ADR-0009(첨부·번역·답글·리액션 DTO), lib/zalo-runtime.ts(현 `if (message.type !== ThreadType.User) return` — 그룹 드롭 지점), lib/zalo-inbound.ts(saveInboundMessage·classifyInbound), app/api/zalo/ext/threads·messages/route.ts, prisma/schema.prisma(ZaloConversation/ZaloMessage). **선행: S1(세션 단일화·발송 위임)·S2(읽기 정본·SSE)·S3(ETL 텍스트·첨부) — 코드완료·QA통과·배포 대기. S4 Nike 부분(B6)·그룹 ETL은 S1/S2/S3 배포 후 의미. 착수 선점 선언(이 계약 단독 커밋).**

## 배경
villa·Nike 둘 다 수신 리스너가 1:1(`ThreadType.User`)만 처리하고 그룹 메시지를 첫 줄에서 드롭한다(lib/zalo-runtime.ts:610 `// 그룹 무시`). 그래서 테오의 Zalo 그룹(단톡방) 대화가 villa `/messages`·Nike 어디에도 보이지 않는다. ADR-0010이 "그룹 포함"으로 방침을 확정(R10)했고, 본 S4는 그 설계(그룹 D·A7·B6·C1-그룹분)를 구현한다.

**S4 범위(전체)**: villa 그룹 수신·표시·발송(D1~D4·A7) + Nike 그룹 읽기 전환(B6) + 과거 그룹 대화 ETL(C1-그룹분). **테오 계정에만** 적용(다른 관리자 0 영향, ADR-0007 격리 계승).

**절대 불변식(S1~S3 계승)**: 테오 세션 리스너는 villa `__system__` 1개(code 3000 회피). 마진·판매가·재고·credential은 그룹 경로에서도 절대 노출/참조 금지. 신규 컬럼은 전부 additive(기존 1:1 행 영향 0 — threadType 기본 USER 백필).

## ① 구현 범위

### 그룹 D — villa 스키마 (TDA — prisma migrate, 한 세션 전담 규칙 #6)
- **D1** `enum ZaloThreadType { USER GROUP }` 신설 + `ZaloConversation.threadType ZaloThreadType @default(USER)`. 기존 행 USER 백필. `@@unique([ownerAdminId, zaloUserId])` 유지(그룹 id도 zaloUserId 슬롯 사용).
- **D2** `ZaloConversation.groupMembers Json?` — 그룹 멤버 스냅샷 `[{zaloId,name,avatarUrl}]`. 발신자명·아바타 매핑 원천. 1:1은 null.
- **D3** `ZaloMessage.senderUid String?` — 그룹 메시지 발신자 Zalo id. 1:1은 null(상대 고정). 수신 핸들러·ETL이 채움.
- **전부 additive** — 기존 데이터 손실 0. 마이그레이션은 **schema.prisma 점유 세션(현재 T-admin-availability-board WIP)이 커밋·push한 뒤** 수행(규칙 #6, 아래 ⑥ 수정 금지 구역·⑧ 순서 참조).

### 그룹 A7 — villa 수신·발송 (BE/INTEG)
- **수신**(lib/zalo-runtime.ts handleInboundEvent): 현 `if (type !== ThreadType.User) return`를 **GROUP 분기 추가**로 교체.
  - 그룹 메시지: `threadId`=그룹 id → ZaloConversation(`threadType=GROUP`, zaloUserId=그룹 id) upsert. 발신자 `uidFrom` → `ZaloMessage.senderUid`. displayName=그룹명(있으면).
  - `groupMembers` 갱신: 멤버 정보가 이벤트/조회로 들어오면 스냅샷 upsert(A7 — 멤버 변동 시 갱신, R14 폴백 대비).
  - **전화번호 자동매칭 금지**(그룹은 다중 발신자 — saveInboundMessage isSystemBot 매칭 경로에 GROUP 가드 추가). 그룹은 공급자 1:1 매칭 대상 아님.
  - 자동번역/STT/OCR: 그룹 메시지에도 동일 적용하되 발신자별 본문 기준(기존 maybe* 재사용). OFF 모드 스킵 동일.
  - isSelf(본인 발신) 그룹 echo → OUTBOUND 동기화(saveOutboundEcho에 senderUid·threadType 전달).
- **발송**: `sendVia`/`sendChat*Async` 류의 하드코딩 `ThreadType.User` → **대화 threadType에 따라 분기**(GROUP이면 그룹 id로 `api.sendMessage(..., ThreadType.Group)`). 발송 라우트(app/api/zalo/messages, ext/send)가 대화의 threadType을 읽어 전달.
- **saveInboundMessage/saveOutboundEcho 시그니처 확장**: `threadType`·`senderUid`·`groupMembers?` 파라미터 additive 추가(기존 1:1 호출은 기본값 USER/null — 동작 불변).

### 그룹 D4 — villa 표시 UI (FE — b14 채팅 확장)
- 스레드 목록(/messages 인박스): 그룹 대화에 **그룹 아이콘·멤버수** 표시. 1:1과 시각 구분.
- 메시지 버블: `senderUid`→`groupMembers` 스냅샷으로 **발신자명·아바타** 표시(여러 발신자 구분). 미해석 시 senderUid 원문/이니셜 폴백(R14).
- 발송: 그룹 thread로 전송(A7 발송 경로 공유). 첨부/공유 메뉴는 그룹에서도 동작(누수 분기는 counterpartyType 무관 — 그룹은 마진/판매가 비노출 기본).
- ext/threads·ext/messages 응답 DTO에 `threadType`·`senderUid`·`groupMembers`(이름·아바타만, credential·금액 0) 화이트리스트 추가.

### 그룹 B6 — Nike (별도 레포 C:\Projects\Nike, 별도 세션)
- 테오 세션 그룹 스레드(`recentchat`/`conversation`/`groupMembers`)를 villa `/ext/threads`·`/ext/messages`에서 가져와 Nike `toApiMessage`(그룹 발신자·멤버) 형식으로 어댑팅. (S2 B3/B4 위에 그룹 필드 추가)
- **S1/S2 배포 후** 의미. villa ext API가 threadType/senderUid/groupMembers를 내보내면 Nike가 소비.

### 그룹 C1-그룹분 — ETL (scripts/etl-nike-zalo.ts 확장)
- 현 ETL은 `threadType="user"`만. **`="group"`도 이관**: villa threadType=GROUP·groupMembers·senderUid 채움. 멱등(zaloMsgId), quote 2-pass, 대화 메타 재계산은 S3 패턴 계승.
- **S3 배포·실행 후**, S4 스키마(D) 적용된 villa DB 대상.

### 범위 밖 (명시)
- 그룹 멤버 추가/강퇴/그룹 생성 등 **그룹 관리 액션**(읽기·표시·송수신만). Phase 2.
- 그룹 리액션·답글의 그룹 특화 UX(기존 1:1 메커니즘 재사용, 그룹 특화 없음).
- 다른 관리자(ADMIN_PERSONAL)의 그룹 — 테오 계정만(ADR-0010). 단 스키마는 공용이라 자연 지원.

## ② 테스트 가능한 완료 기준
- [ ] **스키마 additive·무손실**: D1~D3 마이그레이션 후 기존 1:1 ZaloConversation 전부 threadType=USER 백필, groupMembers/senderUid=null. 기존 메시지/대화 카운트·내용 불변.
- [ ] **그룹 수신 저장**: 테오가 그룹방에서 받은 메시지가 villa ZaloConversation(threadType=GROUP, zaloUserId=그룹 id) + ZaloMessage(senderUid=발신자) 로 저장됨. 1:1과 분리.
- [ ] **그룹 표시(/messages)**: 인박스에 그룹 대화가 그룹 아이콘·멤버수와 함께 뜨고, 대화창 버블에 발신자별 이름/아바타 표시(미해석은 폴백). 1:1 대화 표시 회귀 0.
- [ ] **그룹 발송**: villa /messages에서 그룹방으로 보낸 텍스트/첨부가 `ThreadType.Group`으로 전송되어 OUTBOUND 미러됨. 1:1 발송 회귀 0.
- [ ] **전화매칭 미적용**: 그룹 수신은 User.zaloUserId 자동매칭 0(다중 발신자 오매칭 방지). 1:1 시스템봇 매칭은 불변.
- [ ] **Nike 그룹 읽기(B6)**: (S1/S2 배포 후) Nike에서 테오 그룹 대화가 villa 정본 기준으로 발신자별 표시.
- [ ] **그룹 ETL(C1)**: (S3 실행 후) 과거 그룹 대화가 threadType=GROUP·groupMembers·senderUid로 멱등 이관. 재실행 증가 0.
- [ ] **누수 0**: 그룹 경로(수신/표시/발송/ext DTO/ETL)에 마진·판매가·supplierCost·credential 참조 0(grep + 동적). ownerAdminId=테오 외 그룹 데이터 0.
- [ ] **회귀**: 전체 vitest 통과 + next build 통과(배포 게이트).

## ③ 검증 방법 (QA — 작성자≠평가자)
1. **마이그레이션 무손실**: push 전후 ZaloConversation/ZaloMessage count·표본 내용 대조, threadType 백필 USER 확인.
2. **그룹 수신/표시**: 테오 그룹방 실수신 → /messages에서 그룹 칩·발신자별 버블 실측(Playwright). 1:1 회귀 동시 확인.
3. **그룹 발송**: /messages에서 그룹 발송 → 실제 그룹방 도착 + OUTBOUND 미러 확인.
4. **누수 grep + 매트릭스**: 그룹 코드 경로 `margin`·`salePrice`·`supplierCost`·`credentials` 0건, ext DTO 화이트리스트 확인.
5. **Nike B6·ETL**: S1/S2/S3 배포·실행 후 별도 검증(B6 발신자 매핑, ETL 멱등·그룹 skip 해제).
6. **R14 폴백**: groupMembers에 없는 senderUid가 원문/이니셜로 폴백 표시되는지.

## ④ 수정 금지 구역 (병렬 세션 보호 — 2026-06-22 git status 기준)
**villa-pms** — 다른 세션 미커밋 WIP, 절대 비접촉:
- `prisma/schema.prisma` — **T-admin-availability-board 세션 점유 중**(`availabilityCheckedAt` WIP). 규칙 #6: 스키마는 한 세션 전담. **그 세션이 커밋·push 완료를 확인한 뒤** S4 그룹 D 컬럼을 추가한다(동시 편집 금지 — 그들의 변경이 내 커밋에 섞이지 않게).
- `lib/availability.ts`, `lib/cleaning.ts`, `lib/hold.ts`, `lib/proposal.ts`, `app/(admin)/proposals/new/proposal-create.tsx`, `app/(admin)/settings/season-manager.tsx`, `app/api/calendar-blocks/**` (타 세션 WIP — git status M)
- `app/(admin)/availability/`, `app/api/villas/[id]/availability-checked/`, `design/stitch/a16-*`, `design/stitch/b11-*`, `LAUNCH.md`, `partB-evidence-*.png` (타 세션 untracked)
- **S4가 만지는 파일**: lib/zalo-runtime.ts·lib/zalo-inbound.ts(수신·발송 분기 추가), app/api/zalo/ext/threads·messages·send, app/api/zalo/messages, /messages FE 컴포넌트, scripts/etl-nike-zalo.ts(그룹분). 이들은 타 세션 WIP 목록에 없음 — 충돌 표면 낮음. 단 zalo 계열을 동시 작업하는 세션이 생기면 즉시 조율.
- 공유 파일 추가만+즉시 커밋: `messages/*.json`(그룹 라벨 키 추가만), `docs/INDEX.md`(S4 행 추가만), `TASKS.md`(S4 행만). `package.json` 동결(신규 deps 없음).

**Nike (C:\Projects\Nike)** — 별도 레포·별도 세션. B6은 Nike 세션이 담당(이 villa 세션은 villa ext API만 제공). villa가 Nike 파일 직접 수정 금지.

## ⑤ 보안 체크 (사업 핵심 원칙)
- 그룹 수신/표시/발송/ext DTO/ETL 어디에도 마진·판매가(KRW)·supplierCost·credential 미참조/미노출. groupMembers는 이름·아바타·zaloId만(공개 프로필 — 누수 무관).
- 테오 스코프 고정: ownerAdminId=테오(getSystemBotOwnerId 동적). 다른 관리자 그룹 데이터 미생성.
- 그룹 자동 전화매칭 금지(다중 발신자 → User.zaloUserId 전역 오염 방지).

## ⑥ 실행 순서·의존 (절대)
1. **schema.prisma 점유 해제 대기**: T-admin-availability-board 세션 커밋·push 확인 → 그 후 그룹 D 마이그레이션(TDA, 단독 push). (현 블로커)
2. **villa-local(D+A7+D4)**: 스키마 → 수신 핸들러 → 발송 분기 → ext DTO → FE. villa 자체 Zalo 세션으로 독립 검증 가능(Nike 무관). → "그룹방 보임" 1차 출시.
3. **Nike B6**: S1/S2 배포 후, villa ext API의 그룹 필드를 Nike가 소비(Nike 세션 담당).
4. **그룹 ETL(C1)**: S3 실행 후, S4 스키마 적용 villa DB 대상 1회 실행(`--dry-run`→본실행→멱등 재실행).

## 테오(사업주) 액션
- **schema 세션 정리**: 현재 schema.prisma를 점유한 다른 작업(공실 보드)을 커밋·배포해 스키마 잠금 해제(S4 마이그레이션 선행 조건).
- **S1/S2/S3 배포**: Nike 통합 부분(B6·그룹 ETL)은 S1/S2/S3 배포가 끝나야 의미(현재 전부 배포 대기). villa-local 그룹 표시는 이와 무관하게 먼저 가능.
- **실검증**: 그룹 실수신/발송은 테오 봇 세션 활성 상태에서 실측 필요.
