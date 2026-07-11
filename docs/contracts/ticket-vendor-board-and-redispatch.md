# 계약: 티켓 벤더 전용 보드 + 업체 변경 시 자동 재발주

- 상태: 착수 (2026-07-11)
- 브랜치: wt/ticket-vendor-board
- 배경(테오 요청):
  1. admin에서 부가옵션 주문의 업체를 변경하면 새 업체 페이지에 요청 내역이 안 보임.
  2. 티켓 업체는 티켓만 판매 — 벤더 페이지의 "시간제안" 카테고리가 불필요, 티켓 업무 전용 화면 필요.
     추후 티켓 공급 업체가 여러 곳으로 늘어날 수 있음을 감안.

## 원인 진단 (회의 요약: TDA·BE·FE·UX-VN 합의)

- **1번**: `PATCH /api/service-orders/[id]` 업체 변경 시 발주 사이클 리셋(`vendorStatus=null`, `poSentAt=null`)
  → 벤더 발주함은 `PENDING_VENDOR`만 조회하므로 **재발주(dispatch) 전에는 새 업체에 안 보임**.
  재발주 버튼은 있으나 수동이라 누락됨. → **업체 변경 성공 후 클라이언트가 dispatch를 자동 체이닝**
  (서버 API 의미 불변, 감사로그 2건 유지, Zalo PO 자동 발송, NO_VENDOR_ZALO 경고 승계).
- **2번**: 벤더 보드가 4탭 공통(발주함|시간제안|예약현황|정산). 티켓 발주에 시간 협의(propose)는 무의미.
  - 티켓 벤더 판정 = **보유 활성 카탈로그 품목이 1개 이상이고 전부 type=TICKET** (파생 판정 — 스키마 변경 없음,
    업체가 늘어나도 자동 적용. 혼합 판매 업체는 일반 보드 유지).
  - 티켓 벤더: "시간제안" 탭 숨김(3탭). TICKET 주문 카드의 "시간 제안" 버튼도 숨김(벤더 종류 무관 — 주문 type 기준).
  - 서버 가드: `respond` action=propose를 type=TICKET 주문에 대해 400(TICKET_NO_PROPOSAL) 거부 — UI·서버 대칭.

## 범위 (수정 파일)

1. `app/(admin)/bookings/[id]/service-orders-panel.tsx` — changeVendor 성공 후 vendorId!=null이면 dispatch 자동 호출 + 통합 메시지
2. `messages/ko.json` `vi.json` — admin 통합 메시지 키(기존 NS 내 추가만)
3. `app/vendor/page.tsx` — ticketOnly 파생 판정(RSC) → VendorBoard prop
4. `components/vendor/vendor-board.tsx` — ticketOnly 3탭, TICKET 주문 propose 버튼 숨김·그리드 조정
5. `app/api/vendor/orders/[id]/respond/route.ts` — TICKET propose 서버 가드
6. 테스트: respond 가드 + ticketOnly 판정 (기존 tests/ 패턴)

## 수정 금지 구역
- prisma/schema.prisma (스키마 변경 없음), 타 세션 진행 파일(design-audit/ 등)

## 완료 기준 (QA 검증)
- [ ] 업체 변경 → 새 업체 발주함(PENDING_VENDOR)에 즉시 표시 + Zalo PO 발송(연결 시)
- [ ] 티켓 전용 벤더 로그인 시 시간제안 탭 미노출·TICKET 카드에 제안 버튼 없음
- [ ] 혼합/일반 벤더는 기존 4탭 유지
- [ ] respond propose(TICKET) → 400
- [ ] 판매가·마진 누수 없음(기존 화이트리스트 불변), next build 통과
