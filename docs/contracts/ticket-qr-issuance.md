# 계약서: 티켓형 부가옵션 QR 티켓 발행·열람 (TICKET issuance)

- 담당: BE (구현) / QA (독립 검증) / 메인 세션(Fable) = TDA 스키마 승인·설계
- 브랜치: worktree-ticket-qr-issuance
- 배경(테오 지시 2026-07-10): 티켓형 부가서비스(혼똔 케이블카·빈사파리·심포니쇼 등,
  ServiceType=TICKET)는 벤더가 주문 수량만큼 QR 티켓을 발행한다. 벤더가 티켓 이미지를
  업로드하면 소비자가 자기 신청내역에서 각 티켓을 열람해야 한다. 관리자는 발행 현황 확인
  + 대리 업로드(벤더가 Zalo로 보내온 티켓 첨부 관행) 가능해야 한다.
- 전제: ADR-0033(게스트 주문 자동발주·벤더 수락 자동확정, PR #228)이 이미 배포됨.

## 설계 결정 (TDA)
- 티켓업체 구분은 **주문의 type=TICKET**으로 판정(벤더 플래그 신설 안 함 — 한 업체가
  여러 유형 판매 가능, 주문 단위가 정확).
- 스키마 additive 2필드: `ServiceOrder.ticketUrls String[] @default([])`,
  `ServiceOrder.ticketsIssuedAt DateTime?`. 라이브 적용은 migrations-manual raw SQL
  (`db push` 금지). CleaningTask.photoUrls와 동형 패턴.
- 티켓 이미지는 기존 lib/storage 공개 이미지 경로(saveFile — R2/volume, 추측 불가 URL,
  매직바이트·5MB) 재사용. 이미지 전용(jpeg/png/webp/heic) — PDF는 범위 외.
- 발행 수량은 하드 강제하지 않음(min 1, 총 30장 상한) — 확인시트·FOC 등 추가 첨부 현실.
  벤더 UI에서 수량 미달 시 경고 표시만.
- **발행=수락 겸행**: PENDING_VENDOR 상태에서 티켓 업로드 시 VENDOR_ACCEPTED 전이 +
  (requestedVia=GUEST면 ADR-0033 규칙대로 status=CONFIRMED 원자 전이) + 기존 수락
  운영자 알림 발송. 이미 수락된 주문엔 추가 업로드만.

## 범위 (Scope)

### 1. 스키마 + 마이그레이션 (TDA 승인됨)
- prisma/schema.prisma ServiceOrder에 ticketUrls·ticketsIssuedAt 추가.
- `prisma/migrations-manual/2026-07-10-service-order-tickets.sql` 작성
  (ALTER TABLE ... ADD COLUMN IF NOT EXISTS, additive만).
- 라이브 적용·prisma generate는 메인 세션이 실행.

### 2. 벤더 티켓 발행 API (BE)
- 신규 `POST /api/vendor/orders/[id]/tickets` — Role=VENDOR + 본인 vendorId 스코프(404),
  type=TICKET 주문만(400 NOT_TICKET_ORDER), status CANCELLED/DELIVERED 차단(409),
  multipart 다중 이미지(개당 5MB·매직바이트·합계 30장 상한) → saveFile 저장 →
  ticketUrls append + ticketsIssuedAt(최초) 기록.
- PENDING_VENDOR면 같은 트랜잭션/원자 갱신으로 VENDOR_ACCEPTED(+GUEST면 CONFIRMED —
  respond 로직과 동일 게이트·알림, 코드 재사용) 처리. 동시성: updateMany 가드.
- 신규 `DELETE /api/vendor/orders/[id]/tickets` — body {url} 단건 제거(본인 주문·
  DELIVERED 전만). 저장 파일 자체는 미삭제(다른 업로드와 동일 정책).
- AuditLog: 업로드/삭제 모두 기록(장수·URL).

### 3. 관리자 대리 업로드/열람 (BE+FE)
- 신규 `POST /api/service-orders/[id]/tickets` — isOperator 가드, 동일 검증·저장.
  운영자 업로드는 수락 겸행하지 않음(발주 상태 불변 — 단순 첨부; 단 ticketsIssuedAt는 기록).
- `service-orders-panel.tsx`(수정 허용으로 계약 갱신): TICKET 주문 행에 발행 티켓
  썸네일(N장)+확대 열람+업로드 버튼+삭제. ko/vi 키 추가(admin NS 화이트리스트 확인).

### 4. 벤더 화면 (vi)
- `components/vendor/vendor-board.tsx`(+ /api/vendor/orders 조회 확장): TICKET 주문
  카드에 "티켓 발행" 버튼 → 다중 파일 선택 업로드 → 발행됨 N장 썸네일·삭제.
  수량 미달 경고(quantity 대비). PENDING_VENDOR 카드에는 "발행 시 수락 처리" 안내.
- vendor NS i18n ko/vi 동시 추가.

### 5. 게스트 화면 (공개 L2 5언어)
- lib/guest-checkin-load.ts requestedOrders select에 ticketUrls 추가.
- guest-orders.tsx: ticketUrls 있는 주문에 "내 티켓 (N장)" 섹션 — 썸네일 그리드,
  탭하면 원본 확대(라이트박스 또는 새 탭). GUEST_LABELS 전 언어 추가.
- 티켓은 상태 무관 표시(발행된 것 자체가 진실).

### 6. 문서
- ADR-0034(티켓 발행 모델 — 구분 기준·발행=수락 겸행·수량 비강제 근거).
- docs/NOTIFICATIONS.md 검토 포인트에 "티켓 발행 시 소비자 푸시 채널 없음(페이지 열람만)" 기록.
- PROGRESS.md는 메인 세션이 커밋 직전 갱신.

## 수정 금지 구역
- 미니바·청소·체크인 등 무관 도메인. 기존 respond/complete API의 비티켓 동작.
- lib/storage.ts 코어 로직(재사용만 — 필요 시 saveFile 옵션 추가는 허용).

## 완료 기준 (테스트 가능)
1. 벤더가 자기 TICKET 주문에 이미지 2장 업로드 → ticketUrls 2개·ticketsIssuedAt 기록,
   PENDING_VENDOR였으면 VENDOR_ACCEPTED(+GUEST 주문이면 CONFIRMED) 전이 + 운영자 알림.
2. 타 벤더 주문 업로드 404, 비TICKET 주문 400, CANCELLED 409, 비이미지/6MB 거부.
3. 게스트 orders 페이지에 티켓 N장 썸네일 + 확대 열람. 5언어 라벨 파리티.
4. 관리자 패널 썸네일·대리 업로드 동작(발주 상태 불변).
5. 누수 0: 벤더·게스트 응답에 판매가/원가/마진/bankInfo 신규 노출 없음.
6. lint·typecheck·vitest 회귀 0·next build 통과. 신규 API 단위 테스트 포함.
