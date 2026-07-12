# 계약: TICKET 수락 시 자동 확정을 전 발주 주체로 확대

- 상태: 착수 (2026-07-12)
- 브랜치: wt/ticket-confirm-all
- 배경(테오): 운영자 생성 티켓 주문이 발행 완료(2/2)돼도 "요청" 잔류 — 발행됐으면 확정이어야.
  현행 자동 확정(ADR-0033)은 requestedVia=GUEST만 대상.

## 설계 (ADR-0034 보강)
- 근거: 티켓은 variant 가격이 사전 확정 — 운영자 가격 검토 단계가 무의미. 수락(발행 완료 게이트
  포함)=이행 확정.
- **벤더 티켓 발행 라우트**(수락 전이 시): autoConfirm 조건을 `status=REQUESTED`면 requestedVia
  무관 CONFIRMED(이 라우트는 TICKET 전용). 동시성 가드(where status=REQUESTED) 기존 패턴.
- **벤더 respond accept**: TICKET 주문이면 requestedVia 무관 자동 CONFIRMED(수동 수락 — 확인시트
  케이스 포함). 비TICKET은 현행(GUEST만).
- 알림: 기존 수락 통보 유지(확정 겸행 문구는 기존 GUEST 자동 확정과 동일 취급 — 추가 알림 없음).
- 기존 잔류 데이터(REQUESTED+발행 완료)는 소급 안 함(운영자 수동 확정 가능).

## 범위
1. app/api/vendor/orders/[id]/tickets/route.ts · app/api/vendor/orders/[id]/respond/route.ts
2. ADR-0034 보강, 테스트(ADMIN/PARTNER 티켓 발행 완료=CONFIRMED·수동 수락=CONFIRMED·비TICKET 회귀)

## 완료 기준 (QA)
- [ ] 운영자 생성 TICKET: 발행 완료 시 수락+확정+완료 동시(원자), 수동 수락도 확정
- [ ] 비TICKET·GUEST 규칙 현행 회귀 없음, 취소 레이스 가드 유지, build 통과
