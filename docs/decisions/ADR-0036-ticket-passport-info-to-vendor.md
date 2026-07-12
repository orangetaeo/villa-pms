# ADR-0036 — 티켓 발주에 투숙객 여권 정보(이름·생년월일) 벤더 전달

- 상태: 채택 (2026-07-11)
- 관련: ADR-0034(티켓형 QR 발행), ADR-0023(원천 공급자 발주), ADR-0019(게스트 셀프 체크인·여권 OCR)
- 계약: `docs/contracts/ticket-passport-info-to-vendor.md`

## 배경

혼똔 케이블카·빈사파리·심포니쇼 같은 입장권형(TICKET) 부가서비스는 **차일드/어덜트/시니어** 연령 구분이
있어 티켓 업체가 발행 시 투숙객의 **이름·생년월일**을 요구하는 경우가 있다. 이 정보는 이미 체크인 단계에서
여권 OCR(Gemini) 후 ADMIN이 확인·수정한 확정본(`CheckInRecord.passportOcrJson`)으로 존재한다.
벤더가 별도로 다시 물어보게 하지 않고, 티켓 발주 카드에 바로 표시해 준다.

## 결정

### 1. 데이터 원천 = `CheckInRecord.passportOcrJson` (체크인 확정본)
- 별도 입력 폼을 만들지 않는다. 체크인 시 이미 확정된 `PassportOcrData[]`를 재사용한다.
- bookingId당 `CheckInRecord` 1건(@unique). 벤더 목록 조회 시 TICKET 행의 bookingId를 모아 **배치 1쿼리**
  (`checkInRecord.findMany({ where: { bookingId: { in } } })`)로 조인 — N+1 없음.

### 2. 최소화 = 이름·생년월일만
- 벤더에 노출하는 필드는 `name`(surname+givenNames) · `birthDate` **둘뿐**.
- 여권번호·국적·성별·만료일·여권사진 URL은 화이트리스트 매핑에서 **제외**(원천 JSON에는 있으나 미노출).
- 조인 키 `bookingId`도 응답 shape에는 넣지 않는다(내부 조인용).

### 3. 스코프·시점 = TICKET 주문에만, 체크인 후
- `type=TICKET` 발주 행에만 `guests` 필드를 부착. 비TICKET 응답 shape는 불변(키 자체 없음).
- 체크인 전(레코드 없음)에는 빈 배열 → 화면은 "체크인 후 표시" 안내. 티켓 발주가 체크인보다 먼저인
  경우가 있으므로 발주 흐름을 차단하는 게이트는 두지 않는다(ADR-0034와 동일 원칙).

### 4. 소비자 선택 = 주문별 스냅샷 우선, 체크인 전체는 폴백 (테오 구체화 2026-07-12)
- 티켓 신청 화면(`/g/[token]/options`)에서 소비자가 **체크인된 명단 중 이 티켓을 쓸 사람**을 체크박스로
  고른다(연령 구분 티켓이라 "누구 티켓인지"가 중요). 선택 인원 수 = 발권 수량(`quantity`)으로 동기화.
- 선택분은 주문 생성 시 `ServiceOrder.ticketGuests`(additive Json)에 **스냅샷**으로 저장. 벤더 보드는
  이 스냅샷을 우선 표시하고, **비어있으면**(구주문·미선택·체크인 전) 체크인 전체 명단으로 **폴백**한다.
- 체크인 전이거나 명단이 비면 선택 UI 대신 기존 수량 입력을 유지 — 발주 차단하지 않음.

### 5. 서버 검증 = 체크인 확정본과 정확히 일치 (PII 주입 방지)
- 소비자가 보낸 각 `ticketGuests` 원소(name+birthDate)는 그 예약의 `CheckInRecord.passportOcrJson`을
  화이트리스트 매핑한 확정 명단에 **정확히 존재**해야 한다(`ticketGuestKey` 대조). 불일치 → 400
  `TICKET_GUEST_MISMATCH`. 임의 PII를 주문에 주입하는 것을 차단한다.
- 제공된 인원 수 ≠ `quantity` → 400 `TICKET_GUEST_COUNT_MISMATCH`. TICKET 아닌 품목에 오면 무시(미저장).

### 4. 전달 채널 = 벤더 보드(인앱)만
- Zalo 발주 문구(`lib/vendor-dispatch.ts`)에는 **미포함**. 채팅 로그에 PII(이름·생년월일)가 영구 잔존하는
  것을 피한다 — 인앱 화면은 로그인·스코프 게이트가 있고, 필요 시점에만 조회된다.

## 누수 경계

- 판매가·마진·costVnd 등 기존 누수 경계 불변. `guests`는 이름·생년월일 2필드만 추가.
- 서버 응답 화이트리스트 매핑(`mapGuestPassports`)이 유일한 통로 — passportOcrJson을 그대로 spread하지 않는다.
- 테스트로 방어: passportNo·nationality·sex·expiryDate·bookingId 미노출(`not.toHaveProperty`).

## 대안 검토

- (기각) 벤더가 별도 입력 폼으로 투숙객 정보 재입력: 체크인에 이미 확정본이 있는데 이중 입력 부담 + 오기 위험.
- (기각) Zalo 발주 메시지에 이름·생년월일 동봉: 채팅 로그에 PII 영구 잔존(삭제·스코프 통제 불가).
- (기각) 여권 전체 필드 전달: 최소권한 위반 — 연령 구분에 필요한 건 이름·생년월일뿐.

## 결과

- `app/api/vendor/orders` GET이 TICKET 행에 `guests: [{name, birthDate}]`를 부착
  (주문 스냅샷 `ticketGuests` 우선, 없으면 체크인 전체 명단 폴백).
- 벤더 보드 TicketPanel(발주함·예약현황 공통)에 "이용자 여권 정보" 섹션 표시 — 연령 판단은 업체 몫, 우리는 표기만.
- `/g/[token]/options`에서 소비자가 체크인 명단으로 티켓 이용자 선택(선택 수 = 수량). 생성 API가 확정본과
  대조 검증 후 `ticketGuests` 스냅샷 저장. 운영자 예약 상세(service-orders-panel)의 TICKET 셀에도 선택 이용자 표시.
- 화이트리스트 통로 단일화: `lib/ticket-guests.ts`(`guestsFromPassportOcr`·`whitelistTicketGuests`·`ticketGuestKey`).
- 스키마: `ServiceOrder.ticketGuests Json?` additive(migrations-manual `2026-07-11-service-order-ticket-guests.sql`).
