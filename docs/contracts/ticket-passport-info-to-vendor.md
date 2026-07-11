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

## 완료 기준 (QA)
- [ ] 티켓 업체 보드에서 TICKET 발주 카드에 투숙객 이름+생년월일 표시(체크인 완료 예약)
- [ ] 체크인 전 예약은 안내 문구, 발주 흐름은 차단되지 않음
- [ ] ★누수: 여권번호·국적·성별·만료일·여권사진 URL 미노출(테스트 방어), 비TICKET 주문 shape 불변, 판매가·마진 불변
- [ ] ko/vi 키 쌍, next build 통과
