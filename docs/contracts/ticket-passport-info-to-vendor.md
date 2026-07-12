# 계약: 티켓 발주에 여권 정보(이름·생년월일) 벤더 전달

- 상태: 착수 (2026-07-11)
- 브랜치: wt/ticket-passport
- 배경(테오 지시): 티켓은 차일드/어덜트/시니어 구분이 있어 발주 티켓 업체가 여권 정보를 원하는 경우가 있다.
  결국 **생년월일/이름**이 필요 — 체크인 때 사용하는 여권 정보를 티켓 업체에 전달해야 한다.

## 설계 (회의 요약: TDA·BE·UX-VN·QA 합의 — ADR-0036으로 기록)

- **데이터 원천**: `CheckInRecord.passportOcrJson`(체크인 시 ADMIN이 확인·수정한 확정본, PassportOcrData[]).
- **최소화 원칙**: 벤더에는 **성명(surname+givenNames)·생년월일(birthDate)만**. 여권번호·국적·성별·만료일·여권사진 절대 미전달.
- **스코프**: `type=TICKET` 주문에만, 배정 벤더 본인 스코프 안에서만. 비TICKET 주문 응답 shape 불변.
- **시점**: 체크인 완료(OCR 확정) 후부터 표시. 그 전에는 "여권 정보 미등록(체크인 후 표시)" 안내 —
  티켓 발주가 체크인보다 먼저인 경우가 있으므로 발주 차단 게이트는 두지 않는다.
- **전달 채널**: 벤더 보드(인앱)만. Zalo 발주 문구에는 미포함(채팅 로그에 PII 잔존 방지).

## 범위 (수정 파일)

1. `app/api/vendor/orders/route.ts` — ROW_SELECT에 `bookingId` 추가, mapRows에서 TICKET 행의 bookingId를 모아
   `checkInRecord.findMany` 배치 조회 → `guests: [{name, birthDate}]` 필드를 **TICKET 행에만** 부착(화이트리스트 매핑)
2. `components/vendor/vendor-board.tsx` — TICKET 카드(발주함·예약현황)에 "이용자 여권 정보" 목록(이름·생년월일),
   없으면 안내 문구
3. `messages/ko.json` `vi.json` — vendor NS 키 추가만
4. `docs/decisions/ADR-0036-ticket-passport-info-to-vendor.md`
5. 테스트: 비TICKET 행에 guests 부재 / guests 원소에 passportNo·nationality 등 미포함(not.toHaveProperty) /
   체크인 전 빈 목록 / OCR null 필드 관용

## 수정 금지 구역
- prisma/schema.prisma(스키마 변경 없음), Zalo 발주 문구(lib/vendor-dispatch.ts), 타 세션 파일

## 추가 스코프 (테오 구체화 2026-07-12) — 소비자 이용자 선택 + 주문별 스냅샷

전체 여권 목록 표시(폴백 유지)에 더해, **소비자가 티켓 신청 시 체크인된 사람 중 누구의 티켓인지 선택**하고
그 선택이 벤더로 전달된다.

6. **스키마(TDA 완료)**: `ServiceOrder.ticketGuests Json?` additive(라이브 적용 + migrations-manual + generate 완료).
7. **소비자 선택 UI** `app/g/[token]/options`(page RSC + `_components/guest-options.tsx`·`option-card.tsx`):
   체크인 명단(`guestsFromPassportOcr`)을 prop 전달 → TICKET 품목에 인원 체크박스(선택 수 = quantity 동기화).
   명단 비면 기존 수량 입력. 라벨은 `lib/guest-i18n.ts` 5개 언어 `ticketGuestTitle`·`ticketGuestHint`.
8. **생성 API** `app/api/g/[token]/service-orders`: zod `ticketGuests` 수용, 체크인 확정본과 일치 검증
   (불일치 400 `TICKET_GUEST_MISMATCH`), 수량 일치 강제(400 `TICKET_GUEST_COUNT_MISMATCH`), TICKET만 저장,
   비TICKET·미제공이면 미저장(null). Zalo 문구 미포함.
9. **벤더 GET**: `guests` = 스냅샷(`ticketGuests`) 우선, 없으면 체크인 전체 폴백. 화이트리스트 재매핑.
10. **운영자 표시**: 예약 상세 service-orders-panel의 TICKET 셀에 선택 이용자(이름·생년월일).
11. **공용 lib** `lib/ticket-guests.ts` — 여권 OCR/스냅샷 화이트리스트 매퍼 단일 원천.

## 완료 기준 (QA)
- [ ] 티켓 업체 보드에서 TICKET 발주 카드에 투숙객 이름+생년월일 표시(체크인 완료 예약)
- [ ] 체크인 전 예약은 안내 문구, 발주 흐름은 차단되지 않음
- [ ] 소비자가 명단에서 티켓 이용자 선택 → 선택 수 = 수량 → 벤더에 선택분만 표시(스냅샷 우선), 미선택은 전체 폴백
- [ ] 서버 검증: 명단 불일치 400 `TICKET_GUEST_MISMATCH` / 수량 불일치 400 `TICKET_GUEST_COUNT_MISMATCH`
- [ ] ★누수: 여권번호·국적·성별·만료일·여권사진 URL 미노출(테스트 방어), 비TICKET 주문 shape 불변, 판매가·마진 불변, Zalo 문구에 PII 미포함
- [ ] ko/vi(+en/ru/zh 게스트) 키 쌍, next build 통과
