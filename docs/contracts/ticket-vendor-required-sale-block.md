# 계약: TICKET 벤더 미배정 판매 차단 (ticket-vendor-required-sale-block)

- 날짜: 2026-07-14 / 발의: 테오 ("벤더가 없는 상태로 판매가 이루어지는 것 자체가 문제야")
- 담당: BE / 검증: QA / 세션: worktree-ticket-vendor-required

## 배경 (실사고)

7/13 퀸테센스 콤보 TICKET 주문 2건이 카탈로그 공급자 미지정 상태에서 게스트 판매됨
→ vendorId=NONE 스냅샷 → 발주·발권 경로에 아예 진입 불가(발권 불가능한 주문).
티켓은 벤더의 QR 발행 없이는 이행이 불가능하므로, 판매 시점에 벤더가 확보되어야 한다.

## 범위 (TICKET 타입 한정)

**규칙**: TICKET 품목은 해석된 벤더(resolveOrderVendorId 결과)가 존재하고 `approvalStatus=APPROVED && active=true`일 때만 판매(주문 생성) 가능. 무료 variant 포함 품목 단위로 차단(부분 허용 없음).

다른 타입(FOOD/BBQ/MASSAGE 등)은 "미지정=직접 제공" 모드가 의도된 기능이므로 **불변**.

## 완료 기준 (테스트 가능)

1. **서버 가드(정본)** — 게스트 POST `/api/g/[token]/service-orders`와 운영자 POST `/api/bookings/[id]/service-orders` 모두: TICKET인데 판매가능 벤더가 없으면 `400 { error: "TICKET_VENDOR_REQUIRED" }`. 판정은 공유 헬퍼 1곳(단일 원천 — UI/서버 재구현 금지, ruleHasAny 패턴).
2. **게스트 메뉴 숨김** — 게스트 부가서비스 메뉴에서 벤더 미확보 TICKET 품목은 목록에서 제외(구매 진입 자체 차단).
3. **운영자 주문 폼** — 카탈로그 선택지에서 해당 TICKET 품목 비활성 + "공급자 미지정 — 판매 불가" 안내(ko/vi). 서버 400 메시지도 i18n 매핑.
4. **회귀 없음** — 벤더 정상 배정된 TICKET(자동 발주·무료 확정 경로), 비TICKET 벤더 미지정(직접 제공) 기존 동작 불변.
5. **테스트** — 공유 헬퍼 순수 테스트 + 가드 케이스(미지정/미승인/비활성/정상/비TICKET) 통과. `npm run build` 통과.

## 수정 금지 구역

- prisma/schema.prisma (스키마 변경 없음)
- 기존 주문 소급 처리(퀸테센스 2건)는 별도 운영 조치 — 이 계약 범위 밖
- vendor 보드·발권·정산 로직 불변

## 검증 방법

QA: 헬퍼 단위 테스트 + 두 POST 라우트 가드 대칭성 + 게스트 메뉴 API select에서 판정 필드 확인 + 마진·원가 누수 없음(벤더 approval 필드만 추가 노출).
