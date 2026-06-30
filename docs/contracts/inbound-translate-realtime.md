# 계약: 수신 메시지 번역 완료 실시간 노출 (inbound-translate-realtime)

날짜: 2026-06-30 / 담당: INTEG·BE / 평가: QA

## 배경 (버그)
수신(INBOUND) 메시지 번역이 화면에 늦게 뜬다. 새로고침하거나 5초 폴링이 돌아야 번역이 보임.
- 송신은 발송 시점에 동기 번역 → `translatedText` 채워서 저장 → 즉시 노출(정상).
- 수신은 `saveInboundMessage()`가 `translatedText=null`로 먼저 저장 + SSE `inbound` 신호 발행
  → 클라가 그 신호로 재조회하면 아직 번역 전(null) → 원문만 보임.
  → 이후 `maybeTranslateInbound/Voice/Photo`가 fire-and-forget으로 `translatedText` UPDATE.
  → **UPDATE 후 SSE 재발행이 없어** 클라가 갱신을 모름 → 새로고침/폴링까지 지연.

## 범위 (최소·additive)
번역 결과를 `translatedText`에 UPDATE 성공한 직후 실시간 신호 1회 재발행:
- `publishRealtime(ownerAdminId, { type: "update", conversationId })`
- 적용 3곳(전부 lib/zalo-inbound.ts):
  1. `maybeTranslateInbound` (텍스트 자동번역)
  2. `maybeTranscribeVoice` (음성 STT→ko)
  3. `maybeTranslatePhoto` (사진 OCR→ko, on-demand 라우트에서도 호출됨)
- 음성/사진은 이미 번역 후 `conversation` 조회(ownerAdminId·zaloUserId)를 하므로 거기에 publish만 추가.
- 텍스트는 현재 `conversation` 조회가 없어 message→conversation 1회 조회 추가(또는 호출부에서 전달).

## 완료 기준 (테스트 가능)
1. 세 헬퍼 모두 `translatedText` UPDATE 성공 시 `publish(ownerAdminId, {type:"update", conversationId})` 1회 호출.
2. 번역 스킵/실패(OFF·빈본문·ko·결과 빈문자열·예외) 시 publish 미호출.
3. 누수 0 — 페이로드에 본문·마진·판매가 미포함(type·conversationId만, 기존 RealtimeEvent 규약 유지).
4. 리스너 블로킹 0 — 헬퍼는 기존대로 fire-and-forget, publish 실패는 swallow.
5. tsc/lint/build 0, 기존 zalo-inbound-translate.test.ts 회귀 통과 + publish 호출 단위 테스트 추가.

## 수정 금지 구역
- 다른 세션 작업 파일 없음(git status clean). 공유 json/css/package.json 미변경.

## 검증
- `npm run typecheck && npm run lint`
- `npx vitest run tests/zalo-inbound-translate.test.ts`
- `npm run build`
