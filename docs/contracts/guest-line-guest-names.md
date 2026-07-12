# 계약: 소비자 신청 내역 라인에 티켓 이용자 이름 표기

- 상태: 착수 (2026-07-12)
- 브랜치: wt/guest-line-names
- 배경(테오): 발행된 티켓 화면에서 누가 무료·누가 어떤 티켓인지 안 보임 — 최소 이름 표기 필요.

## 설계
- 주문 스냅샷 ticketGuests({name,birthDate,heightCm})가 이미 라인별 저장됨 — 소비자 payload에
  **이름만** 노출(자기 예약 명단이라 누수 아님, birthDate·신장은 소비자 표기 불필요로 생략).
- 게스트 orders 로더 select에 ticketGuests 추가 → whitelistTicketGuests 재사용해 names 배열 매핑
  → 라인에 person 아이콘 + "이름 · 이름" 표기(TICKET·이름 존재 시).

## 범위
1. lib/guest-checkin-load.ts(select)·app/g/[token]/orders/page.tsx(매핑)·types.ts
2. app/g/_components/guest-orders.tsx(라인 렌더) — 5언어 라벨 필요 시 guest-i18n
3. 테스트: payload names만(여권번호 등 미포함)·비TICKET 미노출·스냅샷 없는 구주문 안전

## 완료 기준(QA)
- [ ] 각 구분 라인에 해당 이용자 이름 표시, 스냅샷 없는 주문은 표기 없음(오류 없음)
- [ ] 이름 외 필드(생년월일·신장·여권번호) 소비자 라인 미노출, build 통과
