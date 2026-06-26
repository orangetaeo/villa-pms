# 계약서 — 메시지 실시간(SSE) 전환

## 배경
현재 `/messages` 인박스는 5초 폴링(`messages-client.tsx` `POLL_INTERVAL_MS=5000`). 최대 5초 지연·불필요한 왕복. ADR(신규)로 SSE 전환.

## 범위
- 신규 `GET /api/zalo/stream` — SSE(EventSource) 엔드포인트. ADMIN 인증 필수, `ownerAdminId` 스코프.
- 신규 `lib/realtime-bus.ts` — 모듈 레벨 in-process EventEmitter(싱글 컨테이너 Railway 기준). `ownerAdminId`별 구독.
- 수신 저장 경로(`lib/zalo-inbound.ts saveInboundMessage`)와 발신 경로(`app/api/zalo/messages` POST)에서 메시지 확정 후 `publish(ownerAdminId, { type, conversationId })` 호출.
- `messages-client.tsx`: 폴링 루프를 EventSource 구독으로 교체. 이벤트 수신 시 기존 `refreshInbox()`/`fetchThread()` 재사용(데이터 페이로드는 신호만, 실데이터는 기존 fetch로). **연결 실패/미지원 시 5초 폴링 폴백 유지**.
- 하트비트(15s comment ping)로 프록시 타임아웃 방지. 가시성 OFF 시 연결 종료, 복귀 시 재연결 + 즉시 1회 새로고침.

## 수정 금지 구역
- ZaloMessage/ZaloConversation 스키마 변경 금지(불필요).
- Nike webhook(`lib/zalo-webhook.ts`) 동작 변경 금지.

## 완료 기준 (테스트 가능)
1. 새 수신 메시지가 1초 이내 인박스/토스트에 반영(폴링 5초 대비 개선).
2. EventSource 미지원/차단 환경에서 폴링 폴백으로 정상 동작(기능 회귀 없음).
3. 탭 비가시 → 가시 전환 시 즉시 갱신.
4. 다른 ADMIN의 대화 이벤트가 누수되지 않음(ownerAdminId 스코프).
5. `npm run typecheck` + `npm run lint` 통과, `next build` 성공.

## 검증 방법
QA: 두 브라우저(또는 ext API로 수신 모의)로 메시지 주입 → 1초 내 반영 육안 확인. 폴백은 EventSource 차단(devtools) 후 확인.
