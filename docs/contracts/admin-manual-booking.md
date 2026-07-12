# 계약서: 관리자 수동 예약 생성 (admin-manual-booking)

- 상태: 완료 (2026-07-12) — QA PASS(9/9), 완료 기준 1~8 충족
- 담당: BE + FE, QA 검증
- 브랜치: worktree-admin-manual-booking

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

## 후속 확장 (2026-07-12, 테오): 빌라 검색 필터

"빌라관리에 있는 검색 필터들이 거의 다 있어야 검색 후 예약 가능한 빌라를 예약" — 단순 셀렉터 → 검색 흐름 전환.

- BE: /villas page.tsx 인라인 필터→where 로직을 `lib/villa-search.ts`로 추출(동작 불변, /villas가 이를 사용하도록 리팩터) + `GET /api/villas/bookable`(isOperator) — 동일 필터 파라미터 + ci/co 시 `findFreeVillaIds(requireSellable)` 공실 교차. 응답은 표시 필드만(원가·판매가 미포함)
- FE: 폼 빌라 섹션을 검색 패널로 개편 — 폼의 체크인/아웃 날짜가 검색 조건으로 연동, 필터(q·지역·침실≥·인원≥·수영장·조식·침대종류·해변거리≤·셀링포인트), 디바운스 fetch, 결과 카드에서 선택. 인원 필터는 폼 guestCount와 연동
- 완료 기준 추가: ⑨ 날짜 입력 시 점유 빌라가 결과에서 제외 ⑩ /villas 필터 동작 회귀 없음(리팩터 검증)

## 후속 확장 2 (2026-07-12, 테오): 선택 빌라 견적 표시 + 판매가 자동 계산

"빌라를 선택 했을 경우 해당 가격을 전혀 확인할 수 없으며, 숙박 일수에 맞춰서 금액이 얼마인지 알 수 없다"

- BE: `GET /api/bookings/quote`(canViewFinance 게이트 — 원가·마진 포함) — quoteStayForVilla 재사용(제안 경로와 동일 엔진), villaId+checkIn+checkOut+saleCurrency+channel → 박수·요율구간별 브레이크다운(구간 라벨·박수·박당 판매가·박당 원가)·총 판매가·총 원가·예상 마진·환율. USD는 자동가 없음(제안 경로와 동일) → VND/KRW 참조 견적+manual 플래그. RATE_NOT_SET/VILLA_NOT_FOUND 대칭
- FE: 폼에 견적 카드 — 빌라+유효 날짜(+통화·채널) 변경 시 자동 조회, 총 판매가·박별 구성·원가/마진 표시, **판매가 입력칸 자동 채움**(사용자가 손대기 전) + "견적가 적용" 버튼(수정 후 재적용), 요율 미설정 시 판매정보 진입 안내, USD는 참조 환산+수동 입력 안내
- 완료 기준: ⑪ 빌라+날짜 선택 시 통화별 총액·박별 구성 표시 ⑫ 견적이 totalSale에 자동 반영 ⑬ 견적 API가 계산하는 값 = POST /api/bookings가 저장하는 스냅샷과 동일 엔진(드리프트 0)

## 수정 금지 구역
- prisma/schema.prisma (타 세션 WIP 존재 — 본 태스크는 스키마 불필요)
- design-audit/ (타 세션)
