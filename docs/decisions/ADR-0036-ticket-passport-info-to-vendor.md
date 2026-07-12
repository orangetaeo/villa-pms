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

## 개정 (2026-07-12) — 연령/신장 구분(variant)별 인원 배정 + 전체명단 폴백 제거

배경(테오 실측, demo-rbk-277): 차일드/어덜트/시니어 티켓은 가격이 다른데 단일가 묶음 구매라 연령별 구매·티켓별
인원 배정이 안 됐다. 또 §4의 "체크인 전체명단 폴백"이 미선택 주문에 전체 명단을 노출해 "1장 티켓에 소비자 3명"
오해를 유발했다.

### R1. 벤더 전체명단 폴백 제거 (표시 정합)
- 벤더 GET `guests` = **주문 스냅샷(`ticketGuests`)만**. 체크인 명단 배치조회(`checkInRecord.findMany`) 삭제.
- 스냅샷 없는 TICKET 주문(구주문·미선택)은 빈 배열 → 화면 "이용자 미지정 — 주문 시 선택되지 않음"(문구 갱신).
- §4의 "비어있으면 체크인 전체로 폴백" 규칙은 **철회**한다(수량≠명단 오해 제거). admin 표시는 원래 스냅샷만이라 불변.

### R2. 구분(variant)별 분리 구매 + 인원 배정
- 티켓 품목의 연령/신장 구분 = 카탈로그 `options.variants`(가격 포함, 운영자 설정).
- 게스트 폼(TICKET + 체크인 명단 + variants): 인원마다 구분을 지정하고, **variant별 그룹으로 주문을 분리 생성**
  (그룹당 1 주문, `quantity`=그룹 인원수, `ticketGuests`=그 그룹만, `variantKey`=그 구분). 가격은 서버 재계산(§9.5 불변).
- 서버 생성 API: 주문 내 **중복 인원** 400 `TICKET_GUEST_DUPLICATE`(name+birthDate 중복). 기존 명단대조·수량검증 유지.

### R3. 데이터 주도 자동 판정 (카테고리 하드코딩 금지)
- variant마다 규칙 필드를 저장하고, 존재하는 필드만 **순서대로** 평가한다 — "차일드/시니어/무료"를 코드에 박지 않는다.
  1. `bornBeforeYear`: 여권 출생년도 < 값 → 매칭(자동, 고정 컷오프. "만 나이"가 아니라 출생년도라 이용일 무관).
  2. `ageMin`/`ageMax`(선택): 이용일 기준 만 나이 범위.
  3. `heightMaxCm`: 소비자 자가신고 신장 < 값(낮은 임계 먼저 = 무료→어린이). 여권에 없어 게스트가 입력.
  4. 규칙 없는 variant = **기본(성인)**.
- 자동 판정 결과는 소비자가 변경 불가. 매칭 실패(기본 없음)면 수동 선택 폴백. 순수 로직 = `lib/ticket-variant-rules.ts`.
- 서버는 제출 `variantKey` 규칙을 재검증(가격 조작 방지) — 위반 시 400 `TICKET_GUEST_RULE_MISMATCH`.
  출생년도·나이 규칙은 `birthDate` null이면 통과(자가신고 폴백), 신장 규칙은 `heightCm` 필수+상한 미만.
- ★규칙 있는 variant는 **이용자 명단(`ticketGuests`) 필수** — 명단을 생략하고 규칙 variant 단가로 POST하면 재검증을
  우회할 수 있으므로 명단 없으면 400 `TICKET_GUESTS_REQUIRED`(QA). 규칙 없는 기본 variant·비TICKET은 현행(명단 없이 가능).
- **신장 허위신고 방지**: 게스트 폼에 "현장 재측정·초과 시 차액" 고지. 신장은 자가신고이므로 벤더 보드에 "신고 Ncm"으로 표기(현장 검표가 정본).

### 기준표(테오 실측 — 운영자가 카탈로그에 규칙으로 입력, 예시)
| 시설 | 무료 | 어린이 | 성인 | 노인 |
|---|---|---|---|---|
| 빈사파리/빈원더스 | 신장<100cm | 신장<140cm | 기본 | (출생년도 컷오프 선택) |
| 혼똔 케이블카 | — | 신장 기준 또는 수동 | 기본 | — |
- 시설마다 기준(신장 vs 나이)·구간이 달라 자동 카테고리 매핑을 하드코딩하지 않는다(위 데이터 주도 원칙).

### 스냅샷 필드 확장
- `ServiceOrder.ticketGuests` 원소에 `heightCm?`(자가신고 신장) 추가 — 허용 필드는 name·birthDate·heightCm 3개뿐.
  additive JSON이라 스키마 마이그레이션 없음(값 있을 때만 부착). 화이트리스트(`whitelistTicketGuests`)가 유일 통로.
