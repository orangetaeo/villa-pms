# 계약서: 관리자 수동 예약 생성 (admin-manual-booking)

- 상태: 착수 (2026-07-12)
- 담당: BE + FE, QA 검증
- 브랜치: wt/admin-manual-booking

## 배경

현재 Booking 생성 경로는 ①공개 제안링크 가예약 ②홀드 확정 ③공급자 직접예약 ④체크인 후 연장뿐.
운영자(테오)가 전화·Zalo로 직접 받은 예약을 기록하려면 제안 링크를 만들어 스스로 클릭해야 하는 우회가 필요했다.
→ 관리자 대시보드에서 예약을 직접 생성하는 정식 경로를 추가한다.

## 범위

### BE
1. `lib/admin-booking.ts` — `createAdminBooking()`:
   - `lockVillaInventory` + `checkAvailability` 재사용 (기존 4경로와 동일한 단일 소스, 트랜잭션 원자성)
   - villa.status=ACTIVE + **isSellable 게이트 유지** (검수 게이트 — 사업원칙 3. 공급자 직접예약과 달리 우회 없음)
   - 정원 검증: guestCount ≤ villa.maxGuests
   - 원가 스냅샷: `quoteStayForVilla()` 합산 → supplierCostVnd
   - 환율 스냅샷: 기존 fx 소스 재사용 (fxVndPerKrw / fxVndPerUsd)
   - seller=OPERATOR 고정. channel(DIRECT/TRAVEL_AGENCY/LAND_AGENCY) + partnerId 선택
   - 상태 선택: **HOLD**(holdExpiresAt 필수, 기존 cron 만료 대상) 또는 **CONFIRMED**
     - CONFIRMED + 파트너 지정 시: 여신 게이트(`evaluateConfirmCredit`) + 채권 생성(`ensureReceivableForBooking`) — confirmHold와 동일 규칙. 구현은 HOLD 생성 후 confirm 로직 체이닝 등 기존 코드 재사용 우선
   - 판매가: saleCurrency(KRW/VND/USD) + 해당 통화 컬럼만 채움 (관례 준수)
   - Notification: 기존 BOOKING_HOLD / BOOKING_CONFIRMED 재사용 (공급자에게 — 판매가·마진 미포함)
   - `writeAuditLog` CREATE Booking (source: ADMIN_MANUAL 표기)
2. `POST /api/bookings` — 첫 줄 role 검사(isOperator), zod 검증, 409(SOLD_OUT 등) 에러 코드

### FE
3. `/bookings/new` 생성 폼 페이지 (다크, ko):
   - 빌라 선택(검색), 날짜 범위(**components/date-field.tsx DateField 필수** — iOS raw date input 금지), 박수 자동계산
   - 게스트(이름·인원·연락처), 채널, 파트너 선택(TA/LA 시), 통화+판매가, 조식, 상태 토글(가예약+만료시각 / 확정)
   - 쿼리 프리필 지원: `?villaId=&checkIn=&checkOut=`
4. `/bookings` 목록에 "새 예약" 버튼
5. 공실보드 AVAILABLE 셀 팝오버에 "예약 만들기" 링크 (villaId+날짜 프리필)
6. i18n: ko+vi 동시 추가 (admin NS면 ADMIN_CLIENT_NAMESPACES 확인)

### 범위 외
- 스키마 변경 없음 (기존 필드로 충족)
- 다중 빌라 일괄 생성, 게스트 셀프 체크인 토큰 자동발급(기존 상세페이지 기능 사용)

## 완료 기준 (테스트 가능)
1. ADMIN이 폼에서 HOLD/CONFIRMED 예약 생성 → 목록·공실보드에 즉시 반영
2. 점유 겹침 날짜로 생성 시 409 (동시성: advisory lock 하 재검증)
3. isSellable=false 빌라 생성 거부
4. SUPPLIER 계정으로 POST /api/bookings → 403
5. 공급자 알림 payload에 판매가·마진 부재 (누수 QA)
6. AuditLog CREATE 기록 존재
7. CONFIRMED+파트너 시 채권 생성, 여신 초과 시 거부
8. next build 통과

## 수정 금지 구역
- prisma/schema.prisma (타 세션 WIP 존재 — 본 태스크는 스키마 불필요)
- design-audit/ (타 세션)
