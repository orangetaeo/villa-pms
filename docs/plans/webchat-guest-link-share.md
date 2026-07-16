# 웹챗 게스트 링크 전달 (Webchat Guest Link Share) — 기획 v1

작성: 2026-07-16 · 상태: **승인·착수** · 선행: 웹챗 MVP(PR #324)+확장(PR #328) 배포 완료

## 1. 배경 — 지금의 업무 플로우 (AS-IS)

랜드사 경유 고객이든 직접 고객이든, 체크인 무렵·문의 시 웹챗으로 들어온다.
대화 중 운영자가 "아, ○○빌라 7/20 체크인 김철수님이구나"를 알게 되는 순간이 오는데,
그때 체크인 페이지나 부가서비스 페이지 URL을 주려면:

1. `/messages` 웹챗 탭에서 대화 중
2. 새 탭으로 `/bookings` 이동 → 게스트명/날짜로 예약 수동 검색
3. 예약 상세 진입 → 게스트 토큰 카드에서 "링크 복사" (토큰 미발급이면 발급부터)
4. 웹챗 탭으로 복귀 → 붙여넣기 → 안내 문구를 직접 타이핑 (방문자 언어로 번역은 Gemini 의존)

**화면 전환 3~4회 + 수동 검색 + 수동 문구 작성.** 같은 고객이 나중에 "마사지 예약하고 싶어요" 하면 처음부터 반복.
대화가 여러 건 동시에 진행되면 어느 채팅이 어느 예약인지 운영자 머릿속에만 있다.

## 2. 목표 — TO-BE 플로우

> 문의 수신 → **채팅 화면 안에서** 예약 연결(자동 후보 1클릭 or 검색 1회) → 세션에 예약 배지 고정 → **버튼 1클릭**으로 방문자 언어 안내문구+링크 발송 → 이후 그 대화는 계속 예약 컨텍스트 유지

- 링크 전달 소요: 화면 전환 0회, 클릭 1~3회
- 안내 문구: 5언어 사전 번역 템플릿 — Gemini 호출 없음(비용 0·번역 실패 0·URL 훼손 0)
- 한 번 연결하면 재문의 시 즉시 식별

## 3. 현황 조사 결과 (설계 발판)

| 항목 | 현황 | 근거 |
|---|---|---|
| 게스트 포털 | `/g/<token>`(체크인) · `/g/<token>/options`(부가서비스) · `/g/<token>/orders`(신청내역) · `/g/<token>/receipt`(영수증, 체크아웃 후) | app/g/[token]/ |
| 토큰 | `GuestCheckinToken` — bookingId @unique(예약당 1개), expiresAt=체크아웃+1일, revokedAt soft revoke | prisma/schema.prisma:662, app/api/bookings/[id]/guest-token/route.ts |
| 웹챗 세션 | `WebChatSession` — **bookingId 없음(간극)**. `sourcePage`에 유입면 기록: /g 페이지 유입이면 **`g:<토큰 앞 8자>`** 저장됨 | schema.prisma:1550, app/g/[token]/layout.tsx:6 |
| 운영자 발신 | `POST /api/webchat/sessions/[id]/reply` — ko 원문→방문자 언어 Gemini 번역 후 발송 | app/api/webchat/sessions/[id]/reply/route.ts |
| 운영자 UI | `app/(admin)/messages/webchat-thread.tsx` 헤더(언어·연락처·sourcePage 뱃지) + 입력창 | webchat-client.tsx |
| 기존 링크 전달 | admin 예약 상세의 guest-token-card(복사+QR 2종)뿐 — 채팅 연동 없음 | app/(admin)/bookings/[id]/guest-token-card.tsx |

## 4. 설계

### A. 세션 ↔ 예약 연결 (식별의 정본)

- `WebChatSession`에 additive 3컬럼: `bookingId String?`(+index), `bookingLinkedAt DateTime?`, `bookingLinkedBy String?`(운영자 userId)
- 연결/해제 API: `POST/DELETE /api/webchat/sessions/[id]/booking-link` — 운영자 3등급(isOperator), **writeAuditLog 필수**(연결·해제·오연결 추적)
- 연결 스코프 = **조직 공유**(웹챗 확장 PR #328과 동일 — ownerAdminId는 알림용만). 한 운영자가 연결하면 전 운영자에게 보임
- 스레드 헤더에 예약 배지: 빌라명 · 체크인~체크아웃 · 게스트명. 클릭 → `/bookings/<id>` 새 탭
- 세션:예약 = N:1 허용(같은 게스트가 세션을 여러 번 만들 수 있음). 예약:세션 유니크 제약 없음

### B. 예약 후보 자동 추천 (검색 이전에 제안)

연결 팝오버를 열면 후보를 신뢰도 순으로 먼저 보여준다:

1. **★토큰 유입 매칭(신뢰도 최상)** — `sourcePage`가 `g:<8자>`면 `GuestCheckinToken.token` startsWith 매칭 → 그 예약. **이 방문자는 이미 그 체크인 링크를 열고 있던 사람**이므로 본인 확률이 매우 높음. "링크에서 유입" 배지 표시. (8자 prefix 충돌 시 후보 복수 표시 — cuid 특성상 실질 0에 수렴)
2. **연락처 매칭(신뢰도 중)** — 세션 `contactZalo`/`contactKakao`를 숫자 정규화([[phone-digit-normalization]]) 후 `Booking.guestPhone` 매칭. 체크인 임박(±14일) 예약 우선
3. **수동 검색** — 게스트명/전화/빌라명 검색, 임박 예약 상위 정렬. 신규 검색 API `GET /api/webchat/booking-search?q=` (limit 10, **금액 필드 select 원천 배제** — STAFF도 사용 가능)

후보/검색 결과 표시 필드: 게스트명 · 전화 뒷 4자리 · 빌라명 · 체크인일 · 상태. **판매가·원가 미포함.**

### C. 빠른 링크 발송 (Quick Send)

연결된 세션의 입력창 위에 버튼 노출:

| 버튼 | URL | 활성 조건 |
|---|---|---|
| 🏠 체크인 안내 | `/g/<token>` | 항상 (예약 CONFIRMED 이상) |
| 🛎 부가서비스 | `/g/<token>/options` | 항상 |
| 🧾 영수증 | `/g/<token>/receipt` | 체크아웃 완료 후만 |

- API: `POST /api/webchat/sessions/[id]/send-link` `{ kind: "checkin"|"options"|"receipt" }`
- 서버 처리: ① 세션의 bookingId 확인(미연결=400) ② 활성 토큰 조회 — 있으면 **재사용**, 없으면 발급(기존 guest-token POST 로직 재사용. ⚠ 기존 API가 무조건 재발급=구 토큰 무효화라면 "존재 시 재사용" 분기 필수 — 이미 QR로 전달된 링크를 깨면 안 됨) ③ 방문자 언어 템플릿 조립 ④ WebChatMessage OUTBOUND 기록+SSE ⑤ **writeAuditLog**(무엇을 어느 세션에 발송했는지)
- 템플릿은 **Gemini 미경유**: `translatedText`에 방문자 언어 완성문 직접 기록(`translationFailed=false`). 번역 비용 0·실패 0·URL 훼손 0

### D. 문구 템플릿 (LOC — 5언어 사전 번역)

`lib/webchat-link-templates.ts` — ko/vi/en/zh/ru × 3종. 예(ko):

> [빌라고] 체크인 안내 페이지입니다. 아래 링크에서 여권 등록과 동의서 서명을 진행해 주세요. 🔗 {url}

- URL은 템플릿 변수로 마지막에 삽입 — 번역문 안에 URL이 섞이지 않게
- 방문자 언어가 5언어 밖(미래 hi 등)이면 en 폴백
- 운영자 UI 문구는 adminWebchat NS ko+vi 동시 추가([[admin-screens-need-vi-json]])

### E. 위젯 링크 렌더 (방문자 측)

- 현재 위젯 메시지는 평문 렌더(추정) → URL autolink 필요: 정규식 토큰화 렌더로 `<a target="_blank" rel="noopener">` 변환. **dangerouslySetInnerHTML 금지**(XSS)
- 수동 타이핑 메시지에 URL이 섞인 경우의 번역 훼손 방지(Gemini 프롬프트에 URL 원문 보존 지시 — [[translation-number-preservation]] 계열)는 P2

## 5. 보안·누수 검토 (QA 게이트)

**핵심 위험 = 오발송.** 토큰 URL 자체가 인증 수단이므로, 엉뚱한 방문자에게 보내면 타인이 여권 업로드·동의서 서명·부가서비스 주문(체크아웃 청구 귀속) 가능.

| # | 위험 | 대응 |
|---|---|---|
| 1 | 오발송(타인에게 토큰 전달) | 연결 확인 다이얼로그(게스트명·전화 뒷4자리·체크인일 표시 + "방문자에게 이름/전화 뒷자리를 확인하셨나요?" 안내). 토큰 유입 후보는 위험 낮음(이미 링크 보유자) |
| 2 | 오발송 후 복구 | 기존 revoke(DELETE)+재발급 동선 유지 — 예약 상세 링크를 배지에서 1클릭 도달. 발송 이력=WebChatMessage(sentBy)+AuditLog로 전량 추적 |
| 3 | 마진·원가 누수 | 후보/검색 API select에서 금액 필드 원천 배제. `/g` 로더는 기존대로 판매가만 직렬화(변경 없음) |
| 4 | 방문자에게 연결 정보 노출 | 방문자 폴링 GET 화이트리스트에 `bookingId`·게스트명 **절대 미추가**. 방문자는 링크 메시지 텍스트만 받음 |
| 5 | 재고 누수 | 토큰 스코프=자기 예약 1건(기존 로더 불변). 검색 API는 운영자 전용(isOperator 첫 줄 검사) |
| 6 | STAFF 등급 | 검색·연결·발송 모두 금액 무관 → 3등급 개방(웹챗 응대 개방과 정합). 영수증 링크 발송은 게스트 본인에게 가는 것이므로 STAFF 발송 허용(운영자 화면 금액 게이트와 무관) |

## 6. 태스크 분해

| 태스크 | 담당 | 내용 |
|---|---|---|
| T1 스키마 | TDA→BE | WebChatSession 3컬럼 additive raw SQL(migrations-manual) + prisma generate |
| T2 API | BE | booking-link POST/DELETE · booking-search GET · send-link POST — 전건 AuditLog, 토큰 "존재 시 재사용" 시맨틱 확정 |
| T3 운영자 UI | FE | 스레드 헤더 연결 팝오버(자동 후보+검색+확인 다이얼로그)·예약 배지·빠른 링크 버튼 3종 |
| T4 위젯 렌더 | FE | URL autolink(XSS 안전 토큰화 렌더) + 로더 변경 시 `?v=` 버전업 확인(위젯 iframe 내부 변경만이면 불필요) |
| T5 문구 | LOC | 템플릿 3종×5언어 + adminWebchat NS ko/vi |
| QA | QA | §5 표 6항목 + 방문자 GET 응답 스냅샷 대조·오발송 revoke 실측 |

규모: PR 1~2개, 신규 API 3, 기존 화면 수정 2. 스키마는 additive만(파괴 변경 없음).

## 7. 범위 밖 (백로그 — 구현 금지, 기록만)

- **제안 링크(/p/<token>) 발송** — 예약 전 문의 고객에게 빌라 제안 링크를 채팅에서 바로 생성·발송. 가치 크지만 제안 생성 플로우(빌라 선택·유효기간)가 얽혀 별도 스프린트
- 카드형 구조화 메시지(버튼 UI) — MVP는 텍스트+URL로 충분
- 연락처 매칭 자동 배지(연결 전 인박스 목록에서부터 "예약 후보 있음" 표시)
- Zalo 대화(웹챗 아님)에서 동일한 빠른 링크 버튼 — 패턴 검증 후 이식
- 수동 타이핑 메시지의 URL 번역 보존 프롬프트 강화

## 8. 가정 (테오 확인 — 다르면 알려주세요)

1. 링크 발송 전 본인 확인의 최종 책임은 운영자 — 시스템은 확인 다이얼로그로 보조(방문자에게 생년월일 입력 요구 같은 추가 인증 게이트는 과설계로 판단, 미도입)
2. 랜드사 경유·직접 고객 구분 없이 동일 플로우(체크인·부가서비스·영수증 모두 게스트 본인 대상 — 랜드사 응대 채널 분리는 하지 않음)
3. 토큰은 "존재 시 재사용" — 채팅 발송이 기존 QR·기전달 링크를 무효화하지 않음
