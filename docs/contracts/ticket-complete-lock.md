# 계약: 발행 완료 후 벤더 티켓 변경 잠금 (변경=Villa Go 경유)

- 상태: 착수 (2026-07-12)
- 브랜치: wt/ticket-complete-lock
- 배경(테오): 발행 완료된 티켓을 업체가 임의로 삭제·추가하면 안 됨 — 완료 후에는 삭제/추가 버튼
  자체를 없애고, 변경이 필요하면 Villa Go 관리자와 연락 후 진행(운영자 대리 첨부/삭제 경로 기존재).

## 설계 (ADR-0034 §3-5 — §3-1 정정 창 축소)
- **잠금 기준**: `vendorCompletedAt != null`(발행 완료·자동 확정 이후). 완료 전(미달·부분 발행)은
  현행(첨부·삭제로 자가 정정 가능 — §3-1 취지 유지).
- **서버(UI·서버 대칭)**: 벤더 POST(발행)·DELETE(삭제) 모두 완료 주문이면 409 `TICKETS_LOCKED`.
  PR #261의 "DELETE로 미달 시 완료 해제" 벤더 경로는 도달 불가가 되므로 제거(운영자 대리 라우트는
  상태 불변 현행 — 관리자 정정 경로).
- **벤더 보드**: 완료된 TICKET 카드=첨부·삭제 버튼 숨김 + 안내 "티켓 변경이 필요하면 Villa Go로
  연락해 주세요"(ko/vi).

## 범위
1. app/api/vendor/orders/[id]/tickets/route.ts(POST/DELETE 잠금·해제 로직 제거)
2. components/vendor/vendor-board.tsx(TicketPanel 잠금 표시)·messages ko/vi
3. ADR-0034 §3-5, 테스트(완료 후 POST/DELETE 409·완료 전 현행·해제 로직 제거 반영)

## 완료 기준 (QA)
- [ ] 발행 완료 주문: 벤더 첨부·삭제 API 409 + 보드 버튼 미노출 + 연락 안내
- [ ] 완료 전(부분 발행) 자가 정정 현행, 운영자 대리 라우트 불변, build 통과
