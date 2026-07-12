# 계약: ADMIN 패널 무료 티켓 라인 발행 UI 제거 (벤더 측과 정합)

- 상태: 착수 (2026-07-12)
- 브랜치: wt/admin-free-ticket
- 배경(테오): 무료(1m 미만) 라인에 "QR 티켓 0/1장·티켓 첨부"가 떠 발행 대상처럼 보임 — 무료는
  발행 불필요(PR #256/#258 벤더 측과 동일 규칙을 ADMIN 표시에도).

## 설계
- 무료 판정 = type TICKET && priceVnd(판매가 스냅샷) "0" — 벤더 freeEntry와 동일 기준.
- AdminTicketCell: 무료면 카운터·첨부(대리 포함)·썸네일 대신 "무료 입장 — 티켓 발행 불필요"
  안내(선택 이용자 표시는 유지 — 누가 무료인지 정보).
- orderAttention(ticketShort)·그룹 티켓 카운터 합(groupAdminOrders)에서 무료 라인 제외
  (그룹 헤더 2/3장→2/2장, amber 미달 신호 소거).

## 범위
1. app/(admin)/bookings/[id]/service-orders-panel.tsx(셀 분기)
2. lib/service-order.ts(attention·그룹 카운터 무료 제외)+테스트, messages ko/vi 키 1개
3. 기존 유료 라인·벤더·소비자 회귀 없음

## 완료 기준 (QA)
- [ ] 무료 라인: 발행 UI 없음+안내, 선택 이용자 유지 / 그룹 카운터·미달 신호에서 제외
- [ ] 유료 티켓·비TICKET 현행, build 통과
