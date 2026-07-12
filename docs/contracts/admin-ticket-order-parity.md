# 계약: ADMIN 주문 추가 — 카테고리 셀렉터·티켓 시간 제거·이용자 선택(신장)

- 상태: 착수 선점 (2026-07-12) — ★선행: admin-order-panel-cleanup 머지 후(같은 파일)
- 브랜치(예정): wt/admin-ticket-parity
- 배경(테오): ADMIN 주문 추가 폼에 ① 메뉴 외 카테고리(ServiceType) 셀렉터 필요 ② 티켓은 시간
  불필요(소비자와 동일) ③ ADMIN은 소비자 정보를 아는 상태 — 소비자 페이지처럼 체크인 명단에서
  이용자 선택+신장 입력, 어떤 소비자의 티켓인지 정확히 기록.

## 설계
- 추가 폼: 카테고리 셀렉터(전체+타입) → 메뉴(카탈로그) 목록 필터링.
- TICKET 선택 시: 시간 입력 숨김(날짜만) — 서버(bookings/[id]/service-orders POST)도 TICKET
  serviceTime 선택화(게스트 라우트와 동일 규칙).
- TICKET+체크인 명단 존재 시: 이용자 체크(이름)+신장 입력 — lib/ticket-variant-rules 공유 자동
  판정·variantKey 그룹 분리 생성(게스트와 동일: 그룹당 1주문, ticketGuests {name,birthDate,heightCm}
  스냅샷). admin POST에 ticketGuests 수용(게스트 라우트의 검증 로직 재사용 — 대조·수량·중복·규칙).
  무료(총액 0) 그룹은 admin 경로에서도 자동 확정 준용 여부: **준용**(동일 규칙 — 발주 불필요).
- 체크인 전·명단 없음: 현행 수량 입력.

## 범위
1. app/(admin)/bookings/[id]/service-orders-panel.tsx(추가 폼)
2. app/api/bookings/[id]/service-orders/route.ts(ticketGuests·시간 규칙·그룹은 클라 분리 제출)
3. 검증 로직 lib 공유화(게스트 라우트에서 추출 재사용), messages ko/vi
4. 테스트: 서버 검증 재사용 경로·TICKET 시간 선택화·스냅샷 저장·비TICKET 현행

## 완료 기준 (QA)
- [ ] 카테고리 셀렉터로 메뉴 필터, TICKET=날짜만, 이용자 선택·신장→자동 판정·그룹 분리 주문
- [ ] ticketGuests 검증(대조·수량·중복·규칙) admin 경로에도 동일, 누수·회귀 없음, build 통과
