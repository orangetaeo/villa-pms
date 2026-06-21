# 계약: Nike↔villa Zalo 통합 S1 — 세션 단일화 + 발송 위임 (ADR-0010 이행)

날짜: 2026-06-18 / 담당: villa=BE·INTEG / Nike=INTEG / 평가: QA
근거: docs/decisions/ADR-0010-nike-villa-zalo-session-chat-share.md (A안 채택·SPOF 수용·풀스펙 확정), WBS 그룹 A(A1·A5)+그룹 B(B1·B2), 배포순서 절대규칙, ADR-0006(zca-js 런타임 단일봇), ADR-0007(멀티풀·__system__·ownerAdminId 격리), lib/zalo-runtime.ts·lib/zalo-credentials.ts·lib/zalo-inbound.ts. **착수 선점 선언(이 계약 단독 커밋).**

## 배경
ADR-0010이 A안(villa-pms를 Zalo 허브로 단독 보유, Nike는 villa ext API로 송수신)으로 확정됐다. S1은 통합의 전제이자 MVP 가치 조기 실현 단계 — **테오 계정의 세션을 villa 하나로 단일화**하고, **Nike의 발송을 villa HTTP로 위임**한다. S1만으로 테오 요구1(QR 1번 + 발송 공유)이 충족된다. 채팅 읽기·SSE(S2)·ETL(S3)·그룹(S4)·고급기능(S5)은 후속 스프린트.

**절대 불변식**: zca-js 동일 계정 2프로세스 동시 WebSocket 로그인 → code 3000(밴 위험). 테오 세션 수신 리스너는 villa `__system__` 인스턴스 **정확히 1개**에만 존재해야 한다.

## ① 구현 범위

### villa-pms (허브) — BE/INTEG
- **A1 `POST /api/zalo/ext/send`** (신규 라우트): 본문(threadId·text 또는 이미지·답글·리액션) 수신 → 기존 `sendChatMessageAsAdmin`/`sendChatImageAsAdmin`/`sendChatReplyAsAdmin`/`addReactionAsAdmin`을 **테오 ownerAdminId 고정**으로 호출. 발송 실패는 명확한 에러 코드 응답(Nike가 폴백/재시도 판단). 신규 발송 로직 작성 금지 — 기존 함수 재사용.
- **A5 인증·격리** (신규 + 기존 강화):
  - `ZALO_EXT_SHARED_SECRET` 환경변수 헤더 검증. 없거나 불일치 시 **401**. 시크릿은 로그·응답·AuditLog에 미기록. **(D) 시크릿 비교는 `crypto.timingSafeEqual` 기반 — 단순 `===` 금지(타이밍 공격 차단).**
  - ext 라우트는 `ownerAdminId = 테오 villa userId`를 **요청 파라미터로 절대 받지 않고 서버 측에서 결정**한다. **(A) 해석 방식은 기존 `getSystemBotOwnerId()`(lib/zalo-credentials.ts:179, `kind=SYSTEM_BOT` DB 동적 해석) 재사용 또는 env `ZALO_SYSTEM_OWNER_ID` 중 택1 — 리터럴 ID 인라인 하드코딩 금지(DB seed/재마이그레이션 시 ID 변동·진실원천 이원화 방지).** 요청 파라미터 미수용 원칙은 동일.
  - 응답 DTO에 `ZaloAccount.credentials`(평문/암호문) 절대 미포함. select 화이트리스트로 구조적 차단.
  - 채팅 전용 DTO만 — villa 마진·판매가·전체 재고 모델 비참조.

### Nike (C:\Projects\Nike) — INTEG
- **B1 테오 세션 로그인 제거**: `connectAllUsers` 부팅 루프 + `connectUser`/`ensureConnectionForUser`/`startQRLoginForUser` **3경로 전부**에서 테오 Nike userId를 **차단(주석 아닌 제거/가드)**. 다른 Nike 계정은 무영향(테오 userId 분기만). QR 화면은 테오에 대해 "villa에서 관리" 안내.
- **B2 발송 → villa HTTP 위임**: 테오 userId일 때 `sendZaloMessage`/`sendZaloImage`/`sendZaloReaction`를 villa `POST /api/zalo/ext/send` 클라이언트 호출로 교체. `VILLA_EXT_BASE_URL` + 공유 시크릿 헤더. 테오 한정 인메모리 store 의존 제거. 다른 Nike 계정은 기존 풀 경로 유지.

### 범위 밖 (S1 비포함 — 명시)
- 채팅 읽기 전환(recentchat/conversation/messages/poll), SSE/webhook push → **S2**
- ETL 과거 대화·첨부 이관 → **S3**
- 그룹 채팅 스키마·발송/표시 → **S4**
- forward/alias/음성STT 동등 → **S5**
- **(C) villa→Nike webhook push 및 그 HMAC 인증 → S2** (S1은 Nike→villa **발송 위임 단방향만**. 수신 전파·webhook/HMAC은 범위 밖).
- villa 스키마 변경 **0건**(S1은 ext 라우트 + env만, additive 컬럼은 S4)

## ② 테스트 가능한 완료 기준
- [ ] **발송 위임 실동작**: Nike UI에서 테오가 보낸 **텍스트**가 villa 허브 세션을 통해 실제 Zalo로 발송된다(상대 수신 확인).
- [ ] **이미지 발송 실동작**: Nike에서 테오가 보낸 **이미지**가 villa 허브 경유로 발송된다.
- [ ] **Nike 미로그인**: Nike 프로세스가 테오 계정을 더 이상 WebSocket 로그인하지 않는다(Nike 풀에 테오 인스턴스 부재 — 로그·상태 확인).
- [ ] **세션 단일성 + code 3000 부재 (B 구체화)**: "무발생"(부재 증명)을 다음 3요소로 검증한다 — (a) Nike B1 배포 후 Nike 풀 상태/로그에서 **테오 인스턴스 부재** 확인(존재 시 실패), (b) villa `getSystemBotStatus()`/`/settings/zalo`에서 `__system__` **connected 단독** 확인, (c) B1 배포~B2 전환 사이 **최소 10분 관찰 윈도우** 동안 양쪽 로그에 `code 3000`/"다른 곳에서 로그인됨"(lib/zalo-runtime.ts:563-567) 라인 **0건**.
- [ ] **ext API 시크릿 게이트**: `/api/zalo/ext/send`가 공유 시크릿 헤더 없음/오류 시 **401**, 정상 시크릿 시에만 동작.
- [ ] **credential 미반환**: ext API 응답·에러·로그에 `ZaloAccount.credentials`가 0건(QA grep + 동적).
- [ ] **ownerAdminId 고정**: 요청 본문에 다른 ownerAdminId를 넣어도 무시되고 테오 스코프로만 발송(파라미터 주입 차단).
- [ ] **타 관리자 격리 회귀**(ADR-0007): ext 경로로 테오 외 관리자 발송 시도 → 불가/차단(스코프 누수 0).
- [ ] **villa 호출부 무변경**: 기존 `enqueueNotification` 8종 + tamtru(T3.6) + /messages 발송 시그니처·동작 무변경, vitest 회귀 0.

## ③ 검증 방법 (QA — 작성자≠평가자)
1. **시크릿 게이트**: `/api/zalo/ext/send`에 시크릿 미포함/오류/정상 3케이스 호출 → 401/401/정상.
2. **credential 누수**: ext 라우트 소스 grep(`credentials`) + 응답·에러 본문 동적 확인 0건.
3. **ownerAdminId 주입**: 본문에 임의 ownerAdminId 주입 호출 → 테오 스코프 외 미발송 실증.
4. **세션 단일성**(배포 순서 검증): Nike B1 배포 후 Nike 로그/상태에서 테오 인스턴스 부재 확인 → villa `__system__` connected 단독 확인 → 양쪽 code 3000 로그 부재.
5. **실송수신**(테오 협조): Nike UI 발송 텍스트·이미지가 실제 상대에게 도달.
6. **회귀**: vitest 전체 green(기존 zalo·notification 테스트 회귀 0), tsc 0, next build 통과.

## ④ 수정 금지 구역 (병렬 세션 보호)
**villa-pms** — 다른 세션 미커밋 WIP(2026-06-18 git status 기준), 절대 비접촉:
- `lib/cleaning.ts`, `lib/hold.ts`, `lib/proposal.ts` (타 세션 WIP)
- `docs/INDEX.md` (타 세션 수정 중 — S1은 ADR-0010 기존 행에 추가 멘션만, 충돌 시 양보)
- `LAUNCH.md`, `partB-evidence-*.png` (타 세션 untracked)
- 공유 파일은 **추가만 + 즉시 커밋**: `messages/ko.json`·`vi.json`(키 추가 시), `.env`/Railway 변수(추가만). S1은 신규 라우트 파일 위주라 공유 파일 변경 최소.

**Nike (C:\Projects\Nike)** — 별도 레포·별도 세션 작업 경계:
- S1에서 villa 세션이 Nike 파일을 **직접 수정하지 않는다**. B1·B2는 Nike 레포에서 Nike INTEG 세션이 수행(작업 경계 분리). villa 세션은 ext API 계약(요청/응답 스키마)만 제공하고, Nike 측 클라이언트 구현은 Nike 세션 담당.
- 충돌 방지: ext API 계약(엔드포인트·헤더·본문·응답 코드)을 본 계약에 **고정**하여 양 레포가 독립 작업 가능하게 한다.

## ⑤ 보안 체크 (사업 핵심 원칙 + C4)
- credential(평문/암호문) 응답·로그·AuditLog·SSE 미노출 (AES-256-GCM, ZALO_CREDS_KEY).
- ownerAdminId 테오 하드코딩 — 타 관리자/공급자 대화·villa 마진·판매가·전체 재고 0 반환.
- 채팅 데이터에는 원래 마진/판매가가 없으나, ext DTO가 실수로 villa 가격 모델을 싣지 않도록 **채팅 전용 DTO만** 반환(마진 비공개 무관성 확인).
- 공유 시크릿은 서버-서버 전용, 클라이언트·로그 미노출.

## ⑥ 배포 순서 (절대 규칙 — 위반 시 code 3000·밴 위험)
1. villa A1·A5 배포(ext API 가동, 발송 위임 수신 준비).
2. **Nike B1 먼저 배포·확인** — Nike가 테오 계정을 더 이상 WebSocket 로그인하지 않음(풀에 테오 인스턴스 부재).
3. **villa 허브 단독 보유 확인** — villa `__system__`가 테오 세션 단독 connected.
4. **그 다음 Nike B2 전환** — 발송을 villa ext로 위임.

롤백 시 역순: Nike B2 원복 → **villa 세션 선(先) 내림** → Nike 테오 로그인 재기동(동시 로그인 금지).

## 테오(사업주) 액션 (S1 배포 시)
- **villa Railway 환경변수 추가**: `ZALO_EXT_SHARED_SECRET`(강한 랜덤 문자열), 필요 시 테오 villa userId 상수 확인.
- **Nike Railway 환경변수 추가**: `VILLA_EXT_BASE_URL`(=https://villa-pms-production.up.railway.app), `ZALO_EXT_SHARED_SECRET`(villa와 동일 값).
- **배포 순서 협조**: B1(테오 로그인 중단) 배포 확인 → villa 허브 단독 확인 → B2 전환. 순서 어기면 밴 위험.
- **실송수신 검증**: villa `__system__` 세션 QR 로그인 활성 상태(ADR-0006 — /settings/zalo)에서 Nike UI로 테오 텍스트·이미지 발송 실측.
