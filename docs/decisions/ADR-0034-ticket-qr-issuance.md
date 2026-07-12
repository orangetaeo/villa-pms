# ADR-0034 — 티켓형 부가서비스 QR 티켓 발행·열람

- 상태: 채택 (2026-07-10)
- 관련: ADR-0023(원천 공급자 발주), ADR-0033(게스트 직접 발주·자동 확정), ADR-0019(게스트 셀프 체크인)
- 계약: `docs/contracts/ticket-qr-issuance.md`

## 배경

혼똔 케이블카·빈사파리·심포니쇼 같은 입장권형 부가서비스는 벤더가 **주문 수량만큼 QR 티켓**을
발행한다. 소비자는 자기 신청내역(/g/[token]/orders)에서 각 티켓을 열람해 입장 시 제시하고,
운영자는 관리자 패널에서 발행 현황을 확인하거나 벤더가 Zalo로 보내온 티켓을 대신 첨부한다.

## 결정

### 1. 티켓업체 구분 기준 = 주문의 `type=TICKET`
- 벤더에 "티켓업체" 플래그를 신설하지 않는다. 한 업체가 여러 유형(마사지·티켓)을 판매할 수 있어
  **주문 단위(ServiceOrder.type)가 정확**하다. 카탈로그 항목의 ServiceType이 그대로 주문에 스냅샷된다.

### 2. 스키마 additive 2필드 (CleaningTask.photoUrls 동형)
- `ServiceOrder.ticketUrls String[] @default([])` — 발행 이미지 공개 URL 목록.
- `ServiceOrder.ticketsIssuedAt DateTime?` — 최초 발행 시각(증빙).
- 라이브 적용은 migrations-manual raw SQL(`db push` 금지) — `2026-07-10-service-order-tickets.sql`.

### 3. 발행 = 수락 겸행
- `PENDING_VENDOR` 주문에 벤더가 티켓을 업로드하면 같은 원자 갱신(updateMany 가드)으로
  `VENDOR_ACCEPTED` 전이 + (requestedVia=GUEST·status=REQUESTED면 ADR-0033 규칙대로 `CONFIRMED`)
  + 기존 수락 운영자 알림(Zalo VENDOR_PO_RESPONSE + 인앱 VENDOR_ACCEPTED) 발송.
- 근거: 티켓을 발행했다는 것은 곧 발주를 수락했다는 것. 별도 "수락" 클릭을 강제하면 이중 조작.
- 이미 수락된(또는 미발주·거절) 주문엔 추가 업로드만 — 상태 전이 없음.
- 운영자 대리 업로드(`/api/service-orders/[id]/tickets`)는 **상태 전이 없음** — 단순 첨부(벤더가
  Zalo로 보내온 티켓을 운영자가 대신 붙이는 관행). `ticketsIssuedAt`만 최초 기록.

### 4. 발행 수량 비강제 (min 1, 총 30장 상한)
- 발행 수량을 주문 수량(quantity)에 하드 강제하지 않는다 — 확인시트·FOC(무료 제공)·재발행 등 현실.
- 벤더/관리자 UI에서 **수량 미달 시 amber 경고만** 표시. 상한 30장은 악용·비용 방지.

### 5. 저장 방식 = 공개 이미지 파이프라인(추측 불가 URL)
- `lib/storage.saveFile` 재사용 — R2/volume, 파일명 `타임스탬프-업로더-uuid`(열거 불가),
  화이트리스트 MIME + 매직바이트(SVG/HTML/실행파일 위장 차단) + 개당 5MB.
- PDF는 범위 외(이미지 전용). 공용 헬퍼 `lib/ticket-upload.saveTicketFiles`가 검증·저장·상한 담당.
- 동시성 409로 DB 미기록 시 저장 파일이 orphan으로 남을 수 있으나 **노출 URL이 없어 무해**(허용).

### 3-1. (개정 2026-07-12) 발행 완료 게이트 + 부족 발행 수동 수락 보존

발행=수락 겸행의 **발동 시점을 "업로드 반영 후 발행 수량 ≥ 주문 수량"으로 한정**한다(계약 `ticket-issuance-complete-gate.md`). 배경(테오 실측): 2장짜리 TICKET 주문에 1장만 발행해도 즉시 수락되어 예약현황으로 이동하는 업무 순서 오류. 이제 미달 업로드는 `ticketUrls`만 추가하고 `PENDING_VENDOR`를 유지(발주함 잔류·운영자 통보 미발송)하며, 나눠 업로드로 수량이 충족되는 마지막 업로드에서 1회 전이(+GUEST·REQUESTED면 CONFIRMED)+통보한다(원자 updateMany 가드·`accept = wasPending && newUrls.length ≥ quantity`). 단 §4 수량 비강제 취지(확인시트 1장으로 전원 커버·FOC)를 위해 **부족 발행 상태의 수동 수락 경로는 열어둔다** — 벤더 보드에서 발행 1장 이상이면 기존 `respond accept` 수락 버튼을 노출(0장이면 발행 유도 위해 숨김). 이미 `VENDOR_ACCEPTED`인 주문의 추가 발행·삭제는 상태 불변(삭제로 수량 미달이 돼도 un-accept 없음), 운영자 대리 첨부(§3)도 상태 불변으로 유지된다.

## 누수 경계

- 벤더 응답(`/api/vendor/orders`·업로드 응답)·게스트 응답에 판매가·마진·costVnd·bankInfo **신규 노출 없음**.
- 게스트 티켓은 **상태 무관 표시**(발행된 것 자체가 게스트 대상 산출물). 원가·게이트 불필요.

## 대안 검토

- (기각) 벤더 "티켓업체" 플래그: 한 업체 다유형 판매를 표현 못 함.
- (기각) 발행 수량 == 주문 수량 하드 강제: 확인시트·FOC 첨부를 막아 현장 마찰.
- (기각) 티켓 발행 시 게스트 푸시: 게스트는 비로그인 웹 열람만 — 별도 알림 채널 없음(아래 참조).
