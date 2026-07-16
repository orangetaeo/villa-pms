# 계약: T-webchat-guest-link-share — 웹챗 세션↔예약 연결 + 원클릭 게스트 링크 발송

착수: 2026-07-16 · 브랜치: worktree-webchat-guest-link · 기획 정본: docs/plans/webchat-guest-link-share.md

## 범위 (IN)

1. **스키마 additive**: `WebChatSession.bookingId String?`(+index) · `bookingLinkedAt DateTime?` · `bookingLinkedBy String?` — 라이브 DB raw SQL + prisma/migrations-manual/ 보존 + prisma generate
2. **API 3종** (전건 첫 줄 isOperator 검사 + writeAuditLog):
   - `POST/DELETE /api/webchat/sessions/[id]/booking-link` — 연결/해제
   - `GET /api/webchat/sessions/[id]/booking-candidates` — 자동 후보(sourcePage `g:<8자>` 토큰 prefix 매칭 최우선 + contactZalo/Kakao 전화 정규화 매칭) + `?q=` 수동 검색 겸용. **금액 필드 select 원천 배제**
   - `POST /api/webchat/sessions/[id]/send-link` `{kind: checkin|options|receipt}` — 활성 토큰 존재 시 재사용/없으면 발급, 방문자 언어 템플릿 조립(Gemini 미경유, translatedText 직접 기록), WebChatMessage OUTBOUND+SSE
3. **템플릿 모듈**: `lib/webchat-link-templates.ts` — 3종×5언어(ko/vi/en/zh/ru), 5언어 밖=en 폴백
4. **운영자 UI**(`app/(admin)/messages/`): 스레드 헤더 예약 연결 팝오버(후보+검색+확인 다이얼로그)·예약 배지(빌라명·체크인~아웃·게스트명, /bookings/<id> 새 탭 링크)·입력창 위 빠른 링크 버튼 3종(영수증=체크아웃 후만 활성)
5. **위젯 URL autolink**(`app/webchat/widget/`): XSS 안전 토큰화 렌더(a target=_blank rel=noopener), dangerouslySetInnerHTML 금지
6. **i18n**: adminWebchat NS ko+vi 동시 추가

## 범위 밖 (OUT — 기획 §7)

제안 링크(/p) 발송 · 카드형 메시지 · 인박스 자동 후보 배지 · Zalo 대화 이식 · 수동 URL 번역 보존 프롬프트

## 완료 기준 (테스트 가능)

- [ ] 연결 안 된 세션에서 send-link → 400
- [ ] sourcePage `g:<8자>` 세션의 후보 API가 해당 예약을 1순위 반환("링크 유입" 표식 포함)
- [ ] send-link(checkin/options) → WebChatMessage OUTBOUND 생성, translatedText=방문자 언어 완성문+URL, translationFailed=false, Gemini 미호출
- [ ] 활성 토큰 존재 시 send-link가 기존 토큰 재사용(신규 발급·revoke 없음)
- [ ] receipt kind는 체크아웃 미완료 예약에서 400
- [ ] 연결/해제/발송 3경로 모두 AuditLog 기록
- [ ] **방문자 폴링 GET 응답에 bookingId·게스트명·예약 정보 필드 부재** (응답 화이트리스트 무변경)
- [ ] 후보/검색 API 응답 JSON에 판매가·원가·마진 필드 부재
- [ ] 위젯에서 발송된 URL이 클릭 가능한 링크로 렌더, `<script>` 포함 텍스트는 이스케이프
- [ ] npm run lint + next build 통과

## 검증 방법

QA 서브에이전트 독립 검증: 완료 기준 체크리스트 + .claude/skills/qa/leak-checklist.md + 방문자 GET 응답 스냅샷 대조.

## 수정 금지 구역 (다른 세션 보호)

- app/api/webchat/messages/route.ts의 방문자 응답 화이트리스트(필드 추가 금지)
- lib/webchat.ts 번역 파이프라인(reply 경로 불변 — send-link는 별도 라우트)
- public/webchat-loader.js(위젯 iframe 내부만 변경 — 로더 `?v=` 버전업 불필요 확인)
- prisma/schema.prisma의 타 모델
