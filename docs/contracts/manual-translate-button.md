# 계약: 수신 텍스트 버블 수동 "번역" 버튼 (manual-translate-button)

날짜: 2026-06-30 / 담당: FE·INTEG / 평가: QA

## 배경 (요청)
수신 자동번역이 보통은 되지만 **간혹 어떤 이유로 번역이 안 되는 메시지**가 생긴다.
사진 버블엔 이미 on-demand "번역" 버튼이 있으나(translate-photo), **텍스트 버블엔 없다**.
→ 번역이 비어 있는 수신 텍스트 버블에 수동 "번역" 버튼을 추가해, 운영자가 눌러 ko 번역을 채운다.

## 범위 (additive·누수 0)
1. **신규 라우트** `POST /api/zalo/messages/[id]/translate` (translate-photo 미러)
   - ADMIN 전용 + 본인(ownerAdminId) 대화 메시지만(스코프 가드).
   - costThrottle("translate", userId) 적용(P1-S11 일관).
   - 이미 translatedText 있으면 멱등 반환(Gemini 0).
   - msgType이 텍스트류이고 text 본문 있을 때만, translateText(text,"ko")로 번역→저장→반환.
   - 저장 직후 publishInboundTranslated와 동일하게 실시간 "update" 발행(다른 탭/Nike 정합) — 라우트에서 publish.
2. **chat-pane.tsx** — InboundBubble 텍스트 분기:
   - translateMode를 ChatPane→MessageBubble→InboundBubble로 전달.
   - 번역모드 ON(≠OFF) + 수신 text + 본문 있음 + 번역 비어있을 때 작은 "번역" 버튼 노출.
   - 클릭 → 라우트 호출 → 로컬 state로 자막 표시(PhotoCard on-demand 패턴 복제: localTranslated/loading/note).
3. **i18n** — adminMessages.textTranslate.{button,loading,failed,empty} ko+vi 추가(photoTranslate 미러).

## 완료 기준 (테스트 가능)
1. 번역 없는 수신 텍스트 버블에 "번역" 버튼 노출(OFF 모드·이미 번역됨·발신·비텍스트엔 미노출).
2. 클릭 → 라우트 200 {translated} → 버블에 ko 자막 표시 + 멱등(재클릭/재조회 시 재호출 0).
3. 누수 0 — 타 관리자 메시지 404, 마진·판매가 무관.
4. tsc/lint/build 0. 라우트 단위/스코프 테스트 추가(가능 범위).

## 수정 금지 구역
- 공유 json은 **키 추가만**(textTranslate 블록). globals.css·package.json 무변경.
- 다른 세션 WIP 없음(git status clean 확인).

## 검증
- npm run typecheck && npm run lint && npm run build
- (가능 시) Playwright 프로덕션 수동 검증은 배포 후.
