# 계약: 무료 티켓은 발행 불필요 (자동 확정 + 정보성 표시)

- 상태: 착수 (2026-07-12)
- 브랜치: wt/free-ticket-no-issuance
- 배경(테오): 무료 티켓(1m 미만 무료 등, 판매가 0)은 업체가 QR을 발행할 필요도, 소비자가 제시할
  필요도 없음 — 그냥 입장. 현재는 무료 라인도 발주함에 들어가 발행 완료 게이트(PR #255) 대상이 됨.

## 설계 (ADR-0034/0036 개정)

- **무료 판정**: `type=TICKET && 주문 판매가(priceVnd 스냅샷)=0`. (variant 가격 0 그룹 — 무료/유아)
- **게스트 생성 경로**: 무료 그룹 주문은 생성 시 **vendorStatus=VENDOR_ACCEPTED + status=CONFIRMED
  (GUEST) 원자 세팅**, poSentAt·vendorRespondedAt 기록 — 발주함 미경유·벤더 Zalo/인앱 발주 통보 생략
  (할 일 아님). 벤더 예약현황에 정보성으로만 노출. 운영자 신청 접수 알림(A1)은 현행 유지.
- **벤더 보드**: freeEntry(서버 파생 boolean — 가격값 노출 아님)를 행에 추가. 무료 라인은
  TicketPanel(발행 UI) 대신 "무료 입장 — 티켓 발행 불필요" 안내(vi/ko). 완료보고 버튼은 유지.
- **소비자 신청 내역**: 무료 라인(클라 판정: type TICKET && priceVnd "0")에 "티켓 없이 입장
  가능(무료)" 안내(5언어), 부분 발행 경고(PR #254) 제외.
- 운영자/파트너 생성 경로는 현행(수동 발주 판단) — 벤더 보드 발행 UI 숨김은 공통 적용.

## 범위
1. `app/api/g/[token]/service-orders/route.ts` — 무료 그룹 자동 확정·통보 생략
2. `app/api/vendor/orders/route.ts` — freeEntry boolean(ROW_SELECT에 priceVnd 추가 금지 — 서버 계산만)
3. `components/vendor/vendor-board.tsx` — 무료 라인 발행 UI 숨김+안내
4. `app/g/_components/guest-orders.tsx` — 무료 안내·경고 제외
5. `lib/guest-i18n.ts`(5언어)·`messages/ko.json`·`vi.json`
6. 테스트: 무료 그룹 생성=자동 확정·통보 0 / 유료 그룹 동시 신청=유료만 발주 / freeEntry 파생 /
   벤더 응답에 priceVnd 값 미노출(boolean만) / 소비자 경고 제외

## 수정 금지 구역
- prisma, 발행 완료 게이트(PR #255 유료 로직), 운영자 대리 첨부

## 완료 기준 (QA)
- [ ] 성인 2+유아 1 신청 → 유료 주문만 발주함, 무료 주문은 즉시 확정·예약현황 정보 표시
- [ ] 무료 라인: 벤더 발행 UI 없음·발주 통보 없음, 소비자 "티켓 없이 입장" 안내·부분 발행 경고 없음
- [ ] ★누수: 벤더 응답에 판매가 값 미노출(freeEntry boolean만), 기존 화이트리스트 불변
- [ ] 유료 티켓 흐름(발행 완료 게이트) 회귀 없음, build 통과
