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

### 3-2. (개정 2026-07-12) 무료 티켓 예외 — 발행·제시 불필요

무료 입장 티켓(판매가 0 — 무료/유아 variant 등)은 업체가 QR을 **발행할 필요도, 소비자가 제시할 필요도 없다**(그냥 입장, 테오). 따라서 발행 완료 게이트(§3-1) 대상에서 제외한다. 무료 판정=`type=TICKET && 주문 판매가(priceVnd 스냅샷)=0`. 게스트 생성 경로(`/api/g/[token]/service-orders`)는 무료 그룹을 자동 발주(PENDING_VENDOR) 대신 **생성 시점에 `status=CONFIRMED`+`vendorStatus=VENDOR_ACCEPTED`+`poSentAt`·`vendorRespondedAt` 원자 세팅**하고, **벤더 발주 통보(`sendVendorPoNotifications`)를 생략**한다(할 일 아님 — 벤더 예약현황 정보 노출로 충분). 운영자 신청 접수 알림(A1)은 유지. `vendorId`는 정상 스냅샷(해석 결과 그대로 — 벤더 예약현황 노출용). 같은 제출의 유료 그룹은 §3-1 자동 발주 흐름 그대로. 벤더 응답(`/api/vendor/orders`)은 행에 서버 파생 `freeEntry` boolean만 노출(판매가 값 자체는 절대 미포함) — 벤더 보드는 무료 행에 발행 패널 대신 "무료 입장 — 티켓 발행 불필요" 안내를 렌더한다. 소비자 신청 내역은 무료 라인에 "티켓 없이 입장 가능(무료)" 안내(5언어)를 표시하고 부분 발행 경고(§표시)는 제외한다.

### 3-3. (개정 2026-07-12) 발행 = 이행 완료(자동), 삭제 시 대칭 해제

티켓은 **발행(사진 첨부)이 곧 서비스 완료** — 완료보고 별도 클릭이 불필요하다(테오). 따라서 §3-1 완료 게이트가 충족되는 순간 같은 원자 갱신에서 `vendorCompletedAt=now`를 자동 세팅한다(계약 `ticket-issuance-auto-complete.md`). 발동 조건은 `meetsQuantity && order.vendorCompletedAt === null`(스냅샷 기준 멱등)으로, 두 경로 모두에 적용된다: (a) `PENDING_VENDOR` 주문이 발행으로 수량 충족 — 수락 전이(+GUEST·REQUESTED면 CONFIRMED)와 **동시**에 `vendorCompletedAt` 세팅. (b) 이미 `VENDOR_ACCEPTED`인 주문(수동 수락 등)의 추가 발행으로 충족 — 상태 전이 없이 `vendorCompletedAt`만 세팅(기존 "상태 불변" 경로에 조건부 필드만 추가, 동시성 가드 패턴 유지). **별도 완료 통보는 없다** — 수락 통보(§3)로 충분하며 이중 알림을 피한다.

**삭제 시 대칭 해제**: 첨부 실수 정정(삭제 후 재등록)을 위해, DELETE로 `newUrls.length < quantity`가 되고 `vendorCompletedAt`이 있으면 같은 갱신에서 `vendorCompletedAt=null`로 해제한다(정정 구간 동안 "완료" 오표시 방지). 재등록으로 다시 충족되면 POST 경로에서 재완료된다. 수락 상태(`VENDOR_ACCEPTED`)는 해제하지 않는다(un-accept 없음 — 현행). 초과분 삭제로도 여전히 수량이 충족되면 완료는 유지된다. DELETE의 closed 가드(CANCELLED/DELIVERED 409)는 현행이며, `vendorCompletedAt`이 세팅돼 있어도 `status`는 CONFIRMED이므로 정정 삭제는 열려 있다. 운영자 대리 첨부(`/api/service-orders/[id]/tickets`)는 완료 자동화도 미적용(상태·완료 불변 — 현행). 벤더 보드의 완료 칩·완료보고 버튼은 기존 `vendorCompletedAt` 조건 그대로라 자동으로 반영된다(로직 무변경).

### 3-4. (개정 2026-07-12) 수락 = 확정 (전 발주 주체)

TICKET 주문은 **수락 시 `requestedVia`와 무관하게 자동 `CONFIRMED`**로 전이한다(테오). 배경: 운영자 생성 티켓 주문이 발행 완료(예: 2/2)돼도 `status=REQUESTED`로 잔류해 "발행됐으면 이미 확정 아니냐"는 업무 인식 불일치가 발생. 근거는 티켓 variant 가격이 사전 확정(카탈로그 스냅샷)이라 기존 자동 확정(ADR-0033)이 GUEST에만 국한한 **운영자 가격 검토 단계가 TICKET에는 무의미**하다는 것. 적용 지점 두 곳: (1) 발행=수락 겸행 라우트(`/api/vendor/orders/[id]/tickets`, TICKET 전용) — autoConfirm 조건에서 `requestedVia=GUEST` 제거, `accept && status=REQUESTED`로 판정(수량 충족 발행 시). (2) 수동 수락 라우트(`/api/vendor/orders/[id]/respond`) — `action=accept && status=REQUESTED && (requestedVia=GUEST || type=TICKET)`. 두 경로 모두 원자 `updateMany` where에 `status=REQUESTED`를 넣어 운영자 동시 취소 레이스를 차단하는 기존 패턴을 유지하고, 확정 통보는 별도 추가 없이 기존 수락 통보와 동일 취급한다. 비TICKET 파트너/운영자 발주는 현행(REQUESTED 잔류)이며, 기존 잔류 데이터(REQUESTED+발행 완료)는 소급하지 않는다(코드만 — 운영자 수동 확정 가능).

## 누수 경계

- 벤더 응답(`/api/vendor/orders`·업로드 응답)·게스트 응답에 판매가·마진·costVnd·bankInfo **신규 노출 없음**.
- 게스트 티켓은 **상태 무관 표시**(발행된 것 자체가 게스트 대상 산출물). 원가·게이트 불필요.

## 대안 검토

- (기각) 벤더 "티켓업체" 플래그: 한 업체 다유형 판매를 표현 못 함.
- (기각) 발행 수량 == 주문 수량 하드 강제: 확인시트·FOC 첨부를 막아 현장 마찰.
- (기각) 티켓 발행 시 게스트 푸시: 게스트는 비로그인 웹 열람만 — 별도 알림 채널 없음(아래 참조).
