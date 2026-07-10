# ADR-0033 — 게스트 부가옵션 주문의 벤더 직접 발주·자동 확정

- 상태: 채택(Accepted)
- 날짜: 2026-07-10
- 관련: ADR-0019(게스트 셀프 체크인·부가옵션), ADR-0023(부가서비스 원천 공급자 발주·중개)
- 결정자: 테오(운영자), TDA 설계 승인, BE 구현

## 배경

게스트가 `/g/[token]/options`에서 부가옵션(마사지·BBQ·차량 등)을 신청하면, 기존에는
운영자(ADMIN)가 **① 수동 발주(dispatch) → ② 벤더 수락 → ③ 운영자 고객확정(CONFIRMED)**
의 2중 승인을 거쳐야 했다(ADR-0023 §4.3). 실제 운영에서는 부가서비스를 해당 벤더(부가서비스
공급자)가 직접 이행하고 **소비자↔벤더가 직접 연락**하는 형태라, 운영자가 중간에서 두 번 개입하는
구조가 지연·병목을 만든다.

테오 지시: "게스트 주문 = 벤더에게 즉시 자동 발주, 벤더 수락 = 자동 확정, 운영자는 현황 모니터링만."

## 결정

1. **자동 발주** — 게스트 주문 생성 시 카탈로그 항목의 벤더가 승인(`approvalStatus=APPROVED`)·
   활성(`active`)이면, 생성 시점에 `vendorStatus=PENDING_VENDOR`·`poSentAt=now`를 함께 세팅하고
   벤더에게 Zalo(연결 시)·인앱 발주 통보(VENDOR_PO)를 즉시 발송한다. 운영자 수동 dispatch 불필요.
   - 신규 행 생성이므로 동시성 가드 불필요(발주 상태를 처음부터 박아 저장).
   - **폴백**: 벤더 미배정·미승인(PENDING_APPROVAL/거절)·비활성이면 현행대로 `REQUESTED`로만 생성
     → 운영자가 수동으로 벤더 지정·발주하거나 직접 제공.
   - 운영자 정보성 알림(A1, `notifyOperatorsServiceOrderRequested`)은 그대로 유지(현황 인지).

2. **자동 확정** — 벤더가 `/vendor`에서 수락(accept)할 때, 그 주문이 `requestedVia=GUEST`이고
   `status=REQUESTED`이면 **같은 `updateMany`에서 `status=CONFIRMED`로 원자 전이**한다.
   운영자 고객확정 단계 제거. where에 `status=REQUESTED`를 포함해 운영자 동시 취소와의 레이스를 DB가 판정.
   - `propose`(시간 협의)·`reject`는 현행 유지 — 일정 미확정/거절은 예외라 운영자가 조율(모니터링 대상).
   - 파트너/운영자 발주(`requestedVia≠GUEST`)는 수락 후에도 `REQUESTED` 유지(기존 2단계 게이트).

3. **게스트 셀프 취소 확장** — 벤더가 아직 수락하지 않은 상태
   (`vendorStatus ∈ {null, VENDOR_REJECTED, PENDING_VENDOR}`)면 게스트 셀프 취소 허용.
   벤더 수락(`VENDOR_ACCEPTED`, 게스트 주문은 이 시점에 자동 확정) 이후만 차단(409).
   - `PENDING_VENDOR`였던 주문 취소 성공 시 벤더에게 발주취소 통보(VENDOR_PO_CANCELLED) 발송(stale PO 방지).
   - 취소와 벤더 수락의 레이스는 `updateMany`(where의 OR에 `PENDING_VENDOR` 포함)로 원자 판정.

4. **게스트 가시성** — 신청 직후 성공 배너("담당자에게 바로 전달됨") + 상태 라벨 개편
   (REQUESTED="담당자 확인 중", CONFIRMED="확정") + 확정 후 담당자 **이름·전화**(tel: 링크) 노출.

## 근거

- 소비자↔벤더 직접 연락 모델에 맞춰 운영자 개입을 제거해 지연을 없앤다.
- 운영자는 대시보드에서 현황 모니터링(취소·거절·시간 제안 등 예외만 개입).

## 공용 헬퍼

발주/발주취소 통보 로직이 세 경로(운영자 수동 dispatch·게스트 자동 발주·취소)에서 중복되므로
`lib/vendor-dispatch.ts`로 추출: `sendVendorPoNotifications`, `sendVendorPoCancelledNotifications`.
인앱 적재 실패는 try/catch로 격리해 본 발주/취소 로직에 영향 0.

## 누수 검토 (마진 비공개 원칙 유지)

- **벤더 통보**: 판매가(priceVnd/priceKrw)·마진 절대 미포함. 품목·수량·빌라·옵션 라벨·본인 정산액
  (costVnd, 게스트 자동 발주는 미확정=0→미표기)·고객 요청만(VENDOR_PO 화이트리스트, 기존 유지).
- **게스트 응답/화면**: `costVnd`·`bankInfo`·마진 절대 미포함. 신규 노출은 담당 벤더의 **이름·전화만**
  (`ServiceVendor.name`·`phone`), 그것도 **확정(CONFIRMED)·벤더 수락 후에만** payload에 포함
  (그 전에는 서버 매핑에서 null 처리 — 미수락 벤더 신원 사전 노출 차단).

## 스키마 영향

없음 — 기존 필드(`vendorStatus`·`poSentAt`·`requestedVia`·`ServiceVendor.name/phone`)로 충분.
`prisma/schema.prisma` 변경 없음.
