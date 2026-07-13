# ADR-0043 — 게스트 여권 업로드 즉시 자동 OCR 잠정 명단

- 상태: 채택 (2026-07-13)
- 관련: ADR-0019 v2(게스트 셀프 체크인), ADR-0036(티켓 이용자 정보 화이트리스트), PR #300(여권 사진 필수화)
- 계약: docs/contracts/guest-passport-auto-ocr-roster.md

## 배경

여권 사진 필수화(PR #300) 이후, 게스트가 업로드한 여권으로 **운영자 체크인 확정 전에도** 티켓 이용자 인원별
선택(연령·신장 구분 발권, ADR-0036)이 가능해야 한다는 요구가 생겼다. 현행은 OCR·명단(CheckInRecord.passportOcrJson)이
운영자 `completeCheckIn`에서만 생성되므로, 게스트는 확정 전까지 인원별 모드를 쓸 수 없었다.

핵심 제약: `CheckInRecord`는 체크인 확정 시점에만 생성 가능하다(`completeCheckIn`이 기존 레코드 없음을 요구 — ALREADY_CHECKED_IN
방어). 따라서 게스트 단계에서 만든 명단을 CheckInRecord에 미리 넣을 수 없다.

## 결정

1. **토큰 잠정본 패턴** — 게스트 자동 OCR 결과를 `GuestCheckinToken.passportOcrJson`(신설, Json?, PassportOcrData[])에
   업로드 순으로 누적한다. 이는 게스트 셀프 서명(agreementSignedAt/signatureUrl을 토큰에 보관 후 확정 시 채택)과 동일한
   선례다 — CheckInRecord를 조기 생성하지 않고 토큰에 잠정 보관한다.
2. **확정본 우선** — 명단 해석은 `resolveRosterGuests(confirmedJson, tokenJson)`: 운영자 확정본
   (CheckInRecord.passportOcrJson)이 1명 이상이면 그것만 정본으로 쓰고 잠정본은 무시한다. 확정 전에만 잠정본을 쓴다.
   UI(옵션 화면·운영자 주문 폼)와 서버 검증(TICKET_GUEST_MISMATCH)이 **반드시 같은 명단**을 봐야 하므로,
   소비처 4곳을 공유 헬퍼 `lib/checkin-roster.ts`로 통일한다.
3. **실패 관용** — 업로드 라우트는 파일 저장·URL push 성공 후 `ocrPassport`를 동기 실행하되, 키 미설정·타임아웃·파싱
   실패 등 모든 예외를 흡수한다. 업로드는 항상 201(해당 장 OCR 미적재). **치유 경로 = 운영자 체크인 확정**(정본 재생성).
4. **원자 jsonb append** — Prisma Json은 `push`를 지원하지 않고, 동시 업로드 시 read-modify-write는 lost update를 낸다.
   따라서 `UPDATE ... SET passportOcrJson = COALESCE(passportOcrJson,'[]') || $1::jsonb`를 파라미터 바인딩으로 실행한다.
5. **"ADMIN 확정본만 저장" 원칙 유지** — 자동 OCR은 잠정 명단일 뿐이며 CheckInRecord에는 자동 저장하지 않는다.
   `completeCheckIn`·검증 게이트·오류 코드는 무변경.
6. **잠정본 정제** — 잠정본은 비여권 사진·OCR 쓰레기가 섞일 수 있으므로, guestsFromPassportOcr 통과 후
   ①name·birthDate 둘 다 null 항목 제거 ②ticketGuestKey(name+birthDate) 중복 제거(첫 등장 유지)를 적용한다.
   확정본은 운영자가 검수한 정본이므로 이 정제를 적용하지 않는다(기존 동작 불변).

## 누수 경계

명단 통로는 기존 `guestsFromPassportOcr`(name·birthDate 화이트리스트)만 통과 — 여권번호·국적·성별·만료일은 유입되지
않는다. 업로드 응답 body에 OCR 데이터를 넣지 않으며, OCR 결과·여권 내용을 console/AuditLog에 절대 로그하지 않는다
(ocrPassport 원칙 계승).

## 기각 대안

- **CheckInRecord 조기 생성**: 게스트 단계에서 CheckInRecord를 만들면 `completeCheckIn`의 ALREADY_CHECKED_IN 방어가
  깨진다(운영자가 정상 체크인 불가). 기각.
- **클라이언트 OCR**: 브라우저에서 OCR 후 명단 전송은 변조 가능(가격 조작·PII 주입). 서버 검증 원천을 신뢰할 수 없어 기각.

## 영향 파일

- prisma/schema.prisma: GuestCheckinToken.passportOcrJson 추가 (additive raw SQL — prisma/migrations-manual/2026-07-13-*.sql)
- lib/checkin-roster.ts(신설): provisionalGuestsFromTokenOcr / resolveRosterGuests / loadCheckinRoster
- app/api/g/[token]/passport/route.ts: 업로드 후 즉시 OCR + 원자 append(실패 관용)
- 명단 소비처 4곳: app/g/[token]/options/page.tsx · app/api/g/[token]/service-orders · app/api/bookings/[id]/service-orders · app/(admin)/bookings/[id]/page.tsx
