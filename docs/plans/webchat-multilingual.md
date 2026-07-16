# 기획서 — 홈페이지 다국어 웹 채팅 (Web Chat Widget)

> 작성 2026-07-16 · 상태: **기획(미착수)** · 회의: TDA + FE + INTEG 3자 (탐색: Explore)
> 착수 시 docs/contracts/ 계약서 + ADR-0045(스키마·아키텍처) 필요. TASKS.md 등록 전.

## 1. 목적

villa-go.net 방문자(비로그인 — 국제 관광객·한국 여행사·랜드사)가 홈페이지에서 **바로** 운영자(테오)와 채팅한다. 언어가 달라도 Gemini 자동번역(vi/ko/en/zh/ru)으로 소통. 현재 intro 페이지들은 Zalo/카카오 외부 링크로 유도하는데, 앱 설치·가입 마찰 없이 사이트 안에서 문의를 받는 것이 목표.

## 2. 핵심 결정 (회의 합의)

| # | 쟁점 | 결정 | 근거 |
|---|------|------|------|
| D1 | 자체 구축 vs 3rd party(Channel.io 등) | **자체 구축** | 번역 파이프라인·SSE 버스·토큰 패턴·알림·감사로그 등 플러밍 80% 보유. SaaS는 seat 과금 + 대화 데이터 외부 유출 + 인박스 파편화(Zalo/웹 분리) |
| D2 | 데이터 모델 | **신규 테이블 2개 분리** (`WebChatSession`, `WebChatMessage`) — ZaloMessage 재사용 금지 | Zalo 모델은 zaloUserId·threadType·유니크 제약에 강결합. 저장은 분리, 운영자 인박스 **표현만** 어댑터로 통합 |
| D3 | 방문자 식별 | **httpOnly 서명 쿠키(주) + localStorage(보조)**, 슬라이딩 TTL 30일, 세션 생성 시 **Cloudflare Turnstile** | 도난 방지(httpOnly), 동일 오리진이라 정적 intro.html에서도 쿠키 전송됨. Turnstile로 봇의 대량 세션 생성 원천 차단 |
| D4 | 실시간 채널 | **방문자=폴링(3~5s, 유휴 백오프), 운영자=기존 realtime-bus SSE 재사용** | 익명 SSE는 연결 점유형 DoS 벡터 + replica=1 제약. 운영자는 인증된 소수라 SSE 안전. 트래픽 실측 후 방문자 SSE 승격 검토 |
| D5 | 번역 시점 | **즉시(eager) + 캐시 + 4계층 방어** (TDA 지연안 기각) | 운영자 Zalo 알림에 ko 미리보기 필수, lazy는 열람마다 재호출 위험. 비용은 스로틀·킬스위치로 통제 (§6) |
| D6 | 언어 감지 | **위젯 선택값 = 답장 방향 판정 전용, 번역 소스 = Gemini 자동감지** | translateText가 이미 소스 미지정 자동감지. 선택값이 틀려도(러시아인이 ko 페이지에서 러시아어 입력) 품질 안 깨짐 |
| D7 | 운영자 콘솔 | **기존 /messages 인박스에 "웹 채팅" 탭/소스 뱃지로 통합** — 별도 페이지 금지 | 테오 단일 인박스 동선. 번역 미리보기·답장 UI 동형 재사용 |
| D8 | 정적 intro.html 노출 | **로더 스크립트 1줄 + iframe 격리 위젯** (`/webchat/widget` Next 라우트를 iframe 로드) | 동일 오리진 → CORS 없음. iframe으로 정적 페이지 CSS/CSP 충돌 격리 + Next 컴포넌트 재사용 |
| D9 | 지원 언어 | **5언어(vi/ko/en/zh/ru) 유지, hi 힌디 보류** | 기술 비용 0이지만 위젯 UI·안내문구 6언어 감수(LOC) 부담. 첫 힌디 실문의 로그 시 30분 작업. `visitorLang` 필드는 확장 가능하게 설계 |
| D10 | 연락처 수집 | **프로그레시브** — 채팅은 무기명 즉시 시작, 오프라인/첫 응답 후에만 인라인 유도 | 선입력 게이트=이탈. 연락처(Zalo 우선)는 이탈 후 회신의 유일한 수단이라 유도는 필수 |

## 3. 사용자 흐름

### 방문자 (비로그인)
1. 우하단 플로팅 버튼(모바일=풀스크린 바텀시트 `h-[100dvh]`+세이프에어리어, PC=360~400px 패널)
2. 언어: `p-locale` 쿠키 → `navigator.language` → en 폴백 자동감지, 헤더 언어 칩 5개로 1탭 교정
3. 첫 메시지 즉시 전송 가능(Turnstile은 세션 생성 시 1회). 운영자 오프라인이면 시스템 버블: "보통 09:00~22:00(ICT) 답변 + 연락처 남기면 알림" (사전번역 문구)
4. 운영자 답장은 **방문자 언어 번역문이 주 표시**, 원문 접힌 토글. 번역 실패 시 원문 + 재시도 링크(메시지 숨김 금지)
5. 재방문 시 쿠키로 대화 복원, 미확인 답장은 버튼 뱃지 카운트

### 운영자 (테오)
1. 새 문의 → Zalo 그룹 알림(ko 번역 미리보기 + 대화 링크). **대화당 첫 메시지 즉시, 후속 10분 디바운스, 응답 중 억제**
2. /messages "웹 채팅" 탭에서 원문+ko 번역 병기, 헤더에 언어·연락처·유입 페이지(sourcePage) 표시
3. ko로 답장 → 발송 직전 방문자 언어로 1회 번역 → 저장·발송 (기존 Zalo 번역 미리보기 플로우 동형)

## 4. 데이터 모델 초안 (TDA — ADR 승격 대상)

**WebChatSession**: id, ownerAdminId, visitorLocale(자유 확장 가능), status(OPEN/CLOSED/BLOCKED), contactEmail?/contactZalo?/contactKakao?, sourcePage, ipHash(원문 IP 저장 금지), unreadForAdmin, lastMessageAt, expiresAt.
인덱스: (ownerAdminId, lastMessageAt), (status), (ipHash, createdAt)

**WebChatMessage**: id, sessionId(FK Cascade), direction(INBOUND/OUTBOUND), text, sourceLocale, translatedText?(캐시 — 재호출 금지), translatedTo?, status, sentBy?(ADMIN userId), createdAt.
인덱스: (sessionId, createdAt). **금액 컬럼 없음** — 마진 누수 표면 제거.

스키마 적용은 additive raw SQL(`prisma/migrations-manual/`) 규약 준수.

## 5. API·컴포넌트 초안

- `POST /api/webchat/session` — Turnstile 검증 + httpOnly 쿠키 발급
- `POST /api/webchat/messages` — 방문자 발신(쿠키 스코프 강제) → eager ko 번역 → realtime-bus publish(신호만) → operator-notify
- `GET /api/webchat/messages` — 방문자 폴링(자기 세션만)
- `POST /api/webchat/reply` — 운영자 답장(role 검사) → 방문자 언어 번역 → 저장
- `GET /api/webchat/inbox` — 운영자 인박스(/messages 탭 데이터)
- `POST /api/webchat/contact` — 연락처 남기기 (+AuditLog)
- `public/webchat-loader.js` — 정적 intro용 로더(버블 토글만, 위젯 본체는 iframe)
- 모든 데이터 변경 API에 writeAuditLog (세션 생성·차단·연락처·운영자 답장)

## 6. 어뷰즈·비용 방어 (4계층 — INTEG)

1. **Cloudflare**: 세션 생성 Turnstile(서버측 siteverify 필수). ⚠**폴링 GET은 WAF api-rate-limit(100/10s)에서 별도 완화 취급** — 호텔·공항 공유 NAT 뒤 33~50명이 동시 폴링하면 IP 하나로 묶여 전원 차단됨(타겟=국제 관광객이라 정상 시나리오). Bot Fight Mode의 XHR 챌린지 오탐도 점검 대상
2. **세션/IP 스로틀(신규 유틸)**: costThrottle은 userId 기반이라 익명용 래퍼 필요 — `webchat:${sessionId}` 15msg/분, `webchat-ip:${ipHash}` 40msg/분, 초과 시 SecurityEvent RATE_LIMIT. 세션당 미응답 N개 초과 시 Turnstile 재검증
3. **번역 절약**: 길이 상한 2000자(서버 400), 선택 언어=ko거나 숫자·이모지뿐이면 번역 스킵, 동일 문자열 캐시 히트
4. **킬스위치**: AppSetting `WEBCHAT_PAUSED`(위젯 전체 오프) + `WEBCHAT_GLOBAL_DAILY_CAP`(일일 번역 호출 상한) — 운영자 알림 킬스위치 패턴 동일. ⚠일일 카운터는 **인메모리 금지, DB(AppSetting 일자별 카운터)** — 재배포마다 리셋되면 상한이 무의미(lib/rate-limit.ts MemoryRateLimitStore는 짧은 분 단위 창에만 허용)

## 7. 보안·누수 체크포인트 (QA 인계)

- 방문자 payload(폴링·메시지)는 화이트리스트 select — 재고·KRW·마진·타 세션 대화 절대 미포함
- realtime-bus 이벤트는 식별 신호만(본문 미탑재) — 기존 규약 유지
- 방문자 토큰은 자기 세션 스코프 강제(타 스레드 조회 차단)
- Zalo 알림 payload에 판매가·마진 미포함
- 가격 공유는 위젯 자동 임베드 금지 — 운영자가 기존 /p/[token] 제안 링크로만
- QA 누수 체크리스트에 "웹 채팅" 섹션 신설
- CSP enforce(백로그) 시 로더 inline에 nonce 필요 — csp-enforce-blockers에 항목 추가

## 8. 구현 단계

### MVP (1차 — 태스크 4~5개 규모)
1. **T-webchat-schema** (TDA→BE): 테이블 2개 additive SQL + prisma generate + ADR-0045
2. **T-webchat-api** (BE): 세션/발신/폴링/답장/인박스 API + 스로틀 유틸 + 킬스위치 + AuditLog
3. **T-webchat-widget** (FE): 위젯(버블+패널+바텀시트) + 폴링 + 5언어 + 오프라인 안내 + 연락처 카드 + 로더 스크립트/iframe + intro 3종 임베드
4. **T-webchat-inbox** (FE): /messages 웹 채팅 탭 + 번역 병기 + 답장 플로우
5. **T-webchat-notify** (INTEG): NotificationType `WEBCHAT_NEW_MESSAGE` 신설(enum ALTER + zalo.ts switch case + NOTIFICATIONS.md 동시 갱신) + 디바운스 정책

### 백로그 (Phase 2)
- 방문자 SSE 승격(트래픽 실측 후) · 이미지 첨부(+OCR) · hi 힌디 · 이메일 회신 인프라 · 미응답 리마인더 cron · FAQ 자동응답 봇 · 타이핑/읽음 표시 · /p·/g 거래 페이지 노출 · 채팅→제안링크 전환 퍼널 분석 · 카카오까지 통합 인박스

## 9. 2차 감사 반영 (QA + OPS — 2026-07-16, 실코드 대조 완료)

### 확인 결과 "문제 아님" (계약서에서 제외 가능)
- writeAuditLog는 `userId` 옵셔널(lib/audit-log.ts:17) — 익명 행위는 null로 기록 가능. 단 attribution은 entity="WebChatSession"+entityId 규약에 의존 → 규약만 명시
- middleware는 default-allow 구조(middleware.ts:281 matcher + 보호경로 목록 방식) — /api/webchat·/webchat/widget에 allowlist 추가 작업 불필요
- 기존 메시지 렌더는 XSS 안전(dangerouslySetInnerHTML 미사용, RichText http(s) 전용 자동링크 chat-pane.tsx:281-321) — 위젯 신규 렌더러가 이 패턴을 이식하면 됨
- iframe 임베드는 X-Frame-Options SAMEORIGIN + frame-ancestors 'self'로 동일 오리진 OK — 단 **외부 파트너 사이트 임베드는 불가**(전제 유지)
- db-backup은 dmmf 전수 순회(lib/db-snapshot.ts:29)라 신규 테이블 자동 포함, BigInt 없어 복원도 무영향

### P1 — 계약서 완료 기준에 반드시 포함
1. **스플래시 게이트 제외**: app/layout.tsx:10 SPLASH_GATE가 /p·/g만 제외 — `/webchat` 미제외 시 intro.html의 360px iframe 안에서 핀드롭 스플래시 재생됨. `p.indexOf('/webchat')===0` 제외 추가
2. **Turnstile 신규 도입 비용**: 코드에 흔적 0. env 2개(`TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) + .env.example 동기화 + **서버측 siteverify 호출 필수**(클라 토큰만 받으면 무력) + CSP `script-src`·`frame-src`에 `https://challenges.cloudflare.com`(지금 report-only에 선반영 + csp-enforce-transition.md 항목화)
3. **인박스 비정규화 컬럼**: WebChatSession에 `lastMessageText`/`lastMessagePreviewType` 추가 — 기존 인박스가 N+1 제거용으로 비정규화(_thread-data.ts:120-127)하는 패턴 준수, 누락 시 N+1 재발
4. **통합 인박스 병합 페이지네이션**: Zalo 대화+웹챗 세션 2소스를 lastMessageAt 병합 정렬할 때 커서 규약 미정의 — 탭 분리(웹챗 탭은 자체 커서)로 단순화 권장, 계약서에서 확정
5. **BLOCKED 생명주기 5종 정의**: ①차단 API+UI(+AuditLog) ②차단 세션 폴링 응답 ③발신 서버측 403 ④차단 시 알림·번역 억제 ⑤인박스 노출/필터
6. **운영자 답장 번역 실패 시 동작**: 방문자측(원문+재시도)만 정의돼 있고 발신 방향 미정의 — "ko 원문 발송+실패 플래그" vs "발송 차단+경고" 택일
7. **3개 상태의 방문자 UX**: WEBCHAT_PAUSED / 일일캡 초과 / 세션 만료 — 각각 폴링·발신 응답 코드와 위젯 문구(사전번역 → LOC) 정의
8. **개인정보 수집 고지**: 위젯 하단 "대화·연락처 저장" 고지 1줄(5언어) — EU·러시아 관광객 대상, 기존 동의서(lib/agreement.ts) 관행 준수
9. **로더 캐시버스팅**: public/*.js는 Next 해시 미부여 + CF 엣지 캐시 → intro.html에서 `webchat-loader.js?v=<버전>` 참조(intro 수동 동기화 표면에 포함)
10. **ddos-guard NAT 충돌**: lib/ddos-guard.ts:13 글로벌 IP 1000/분도 호텔 60명 폴링(720~1200/분)이면 초과 — 폴링 GET은 이 카운터에서 제외 또는 세션 키 기준으로

### P2 — 계약서에 명시 권장
- **ipHash는 HMAC-SHA256(secret, ip)** — 무염 해시는 IPv4 2³² 전수 대입으로 가역. 서명키는 `WEBCHAT_COOKIE_SECRET` 신설 or NEXTAUTH_SECRET 재사용 결정(쿠키 서명키와 함께 명명)
- **iframe에 locale 쿠키 안 잡힘**(middleware.ts:251-273 분기 미매칭) — 위젯 i18n은 p-locale/쿼리/navigator.language 자체 판정(next-intl locale 쿠키 의존 금지)
- **익명 세션 ownerAdminId 배정 규칙**: 생성 시점에 로그인 admin 없음 — 기본 수신자(테오)를 AppSetting에서 해석
- **세션 생성↔첫 메시지 원자성**: 첫 POST가 세션을 원자 생성하는 규약으로(경합 시 중복 세션 방지)
- **unreadForAdmin 리셋 시점**: 운영자 스레드 열람 엔드포인트에서 0으로 (totalUnread 정확도)
- **보존·삭제 정책**: expiresAt=세션 유효기간이지 삭제 아님. MVP는 "무기한 보존" 명시 + 만료 세션 정리는 신규 cron 대신 기존 일일 cron에 편입(cron-registration 등록 비용 절약). 메시지 누적 시 일일 백업 gz 비대화 유의
- **위젯 렌더러 안전 패턴 강제**: dangerouslySetInnerHTML 금지 + RichText 패턴 이식 + 방문자 발신 링크의 피싱 표면 인지(운영자 인박스 자동링크 rel=noopener)
- **middleware auth() 부하**: 폴링도 matcher에 걸려 익명 요청마다 JWT 디코드 — MVP 무해, 볼륨 증가 시 관찰
- **상수 vs env 구분**: 디바운스 10분·TTL 30일·스로틀 15/40·2000자는 lib 상수로(env 남발 금지)

### 태스크 반영
- T-webchat-widget에 추가: 스플래시 제외 + 캐시버스팅 + PII 고지 + 안전 렌더러
- T-webchat-api에 추가: Turnstile siteverify + BLOCKED 5종 + 3상태 응답 + HMAC ipHash + 원자 세션 생성
- T-webchat-inbox에 추가: 차단 버튼 + unread 리셋 + 비정규화 컬럼 갱신
- **T-webchat-loc 신설(LOC)**: 위젯 UI 문구·오프라인 안내·PII 고지·3상태 문구 5언어 사전번역 감수
- OPS 체크리스트: env 2개+.env.example, CSP 디렉티브 선반영, WAF 폴링 완화 규칙, csp-enforce-transition.md 갱신

## 10. 전제·리스크

- **전제**: 운영자=테오 단일 수신, 저트래픽(모집 단계). 다중 상담원이 초기부터 필요하면 D4(SSE)·배정 로직을 앞당겨야 함
- **리스크**: ① 방문자 이탈 후 회신 불가(연락처 미수집 시) — 구조적 한계, 연락처 유도로만 완화 ② ko→zh/ru 방향은 부분실패 감지가 약함(숫자 보존만) — MVP 수용 ③ 정적 intro 로더는 AppSetting과 별개 정적 파일 — 배포 동기화 대상 명시
