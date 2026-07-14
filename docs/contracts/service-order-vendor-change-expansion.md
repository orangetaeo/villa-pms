# 계약: 부가서비스 공급자 변경 허용 범위 확장 (service-order-vendor-change-expansion)

- 날짜: 2026-07-14 / 발의: 테오 (예약 상세 패널 스크린샷 — "필요에 따라서는 공급업체를 변경해야 되는 상황이 있기 때문에 셀렉터로 변경해줘")
- 담당: BE / 검증: QA / 세션: worktree-vendor-change-selector

## 배경

패널 VendorCell의 공급자 셀렉터는 이미 존재하나(PR #242 changeVendor + 자동 재발주 체이닝),
서버 가드(VENDOR_LOCKED)와 클라 조건이 쌍으로 `status===REQUESTED && vendorStatus∈{null, VENDOR_REJECTED}`에
잠겨 있어, 확정(CONFIRMED)·발주됨(PENDING_VENDOR)·수락(VENDOR_ACCEPTED) 상태에선 이름 텍스트만 보인다.
원래 목적은 "이중 발주·이행 중 교체 사고 방지" — 확장 시 이 사고를 통보·리셋으로 대체해야 한다.

## 새 허용 규칙 (서버 정본 + 클라 미러 대칭)

vendorId 변경(PATCH)은 아래 **전부** 충족 시 허용:
1. `status ∈ {REQUESTED, CONFIRMED}` (CANCELLED·DELIVERED 종결 후 불가)
2. `vendorSettledAt == null` (정산 완료 후 불가)
3. `vendorCompletedAt == null` (이행 완료 후 불가)
4. TICKET이면 `ticketUrls.length === 0` (이미 발권된 QR 존재 시 불가 — 구 업체 QR 무효화 문제. 운영자 대리 삭제 후 교체는 가능)
5. TICKET이면 새 값 `null`(직접 제공 전환) 금지 — PR #304(TICKET 벤더 필수)와 정합, `400 TICKET_VENDOR_REQUIRED` 재사용

거부는 기존 `409 VENDOR_LOCKED` 유지(payload에 사유 필드 추가 가능), 승인 벤더 검증(VENDOR_NOT_APPROVED_OR_MISSING)·발주 사이클 리셋·클라 자동 재발주 체이닝은 현행 유지.

## 구 업체 stale PO 방지 (확장의 안전핀)

변경 시점에 살아있는 발주(`vendorStatus ∈ {PENDING_VENDOR, VENDOR_ACCEPTED}`)였고 구 vendorId가 있으면,
**구 업체에 발주 취소 통보**(기존 취소 통보 경로의 Zalo·인앱 재사용 — 무료 티켓 제외 게이트 동일)를 발송한다.
통보는 best-effort(실패해도 변경은 성공), count 검사 후 발송 원칙 유지.

## 완료 기준 (테스트 가능)

1. 서버: 위 규칙 5개 각각 가드 케이스(허용 4·거부 5) 테스트 통과. 동시성 가드(updateMany where 기대 상태) 유지.
2. 구 업체 취소 통보: PENDING_VENDOR·VENDOR_ACCEPTED에서 교체 시 구 업체 통보 발송, null·REJECTED에서 교체 시 미발송.
3. 클라: VendorCell 셀렉터가 새 허용 규칙과 동일 조건으로 노출(서버-클라 판정 대칭). TICKET 주문에는 "없음(직접 제공)" 옵션 미노출. 살아있는 발주 상태에서 변경 시 확인(confirm) 1회 — 실수 클릭으로 구 업체 취소 통보가 나가는 사고 방지.
4. i18n ko/vi 동시(신규 문구 있으면), 하드코딩 금지.
5. 회귀: 기존 REQUESTED/거절 상태 변경+자동 재발주 동작 불변. `npm run build`·typecheck·전체 테스트 통과.
6. 재발주 체인 CONFIRMED 경로 검증(PR #307 회귀): CONFIRMED 주문 공급자 변경 → 발주 사이클 리셋(vendorStatus=null) 후 자동 재발주가 dispatch 라우트에서 통과해 PENDING_VENDOR로 복귀해야 한다. `canDispatch`(lib/vendor-order.ts)가 CONFIRMED를 허용하지 않으면 409 CANNOT_DISPATCH로 벤더 발주함(PENDING_VENDOR만 조회)에서 사라지는 회귀 발생(demo-svc-so-2 실사례).

## 수정 금지 구역

- prisma/schema.prisma (스키마 변경 없음)
- 벤더 보드(components/vendor/) — vendorId 스코프 조회라 자동 정합
- 정산 허브·발권 라우트 로직

## 검증 방법 (QA)

가드 매트릭스 전수(상태×vendorStatus×정산×발권), 서버-클라 조건 대칭 코드 대조, 구 업체 통보 발송 조건, TICKET 직접 제공 차단이 PR #304 의미론과 일치하는지, 누수(통보 payload에 마진·판매가 없음 — costVnd만 허용) 확인.
