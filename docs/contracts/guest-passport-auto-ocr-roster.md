# 계약서: 게스트 여권 업로드 즉시 자동 OCR 명단 생성 (guest-passport-auto-ocr-roster)

- 상태: 착수 (2026-07-13)
- 담당: BE (Opus) / QA 독립 검증 / 스키마 결정: 메인 세션(TDA)
- 발단: 테오 지시 — 여권 사진 필수화(PR #300) 후속. 게스트 업로드 즉시 OCR로 티켓 이용자 명단을 만들어, 운영자 체크인 확정 전에도 인원별 티켓 선택이 가능하게.

## 배경 (Triage)

- 현행: 게스트 사진 → GuestCheckinToken.passportPhotoUrls 누적. OCR·명단(CheckInRecord.passportOcrJson)은 운영자 completeCheckIn에서만 생성.
- CheckInRecord는 확정 시점에만 생성 가능(ALREADY_CHECKED_IN 방어) → 게스트 셀프 서명과 동일하게 **토큰에 잠정 보관 후 확정 시 채택** 패턴 채택.
- 명단 소비처 4곳: app/g/[token]/options/page.tsx · app/api/g/[token]/service-orders(route의 loadConfirmedGuests) · app/api/bookings/[id]/service-orders · app/(admin)/bookings/[id]/page.tsx — **UI와 서버 검증(TICKET_GUEST_MISMATCH)이 같은 원천을 봐야 하므로 공유 헬퍼 필수**.

## 설계 결정 (ADR 초안 포함 — 병합 직전 main에서 번호 재확인)

1. **스키마(additive)**: `GuestCheckinToken.passportOcrJson Json?` — 게스트 자동 OCR 잠정본(PassportOcrData[] 형태, 업로드 순 누적). 라이브 DB에 `ALTER TABLE "GuestCheckinToken" ADD COLUMN IF NOT EXISTS "passportOcrJson" JSONB;` 직접 적용 + prisma/migrations-manual/에 날짜 접두 파일 보존 + schema.prisma 반영 + prisma generate.
2. **업로드 라우트(app/api/g/[token]/passport)**: 파일 저장 성공 후 ocrPassport(base64) 동기 실행 — **실패(키 미설정·타임아웃·파싱 실패)여도 업로드는 201 성공**, 해당 장은 OCR 항목 미적재(치유=운영자 확정). OCR 내용 로그 금지(기존 원칙). 응답에 OCR 개인정보 미포함.
3. **명단 해석 공유 헬퍼(lib/checkin-roster.ts 신설)**: `CheckInRecord.passportOcrJson(운영자 확정본) 우선 → 비어 있으면 GuestCheckinToken.passportOcrJson(잠정본)`. 잠정본은 guestsFromPassportOcr 통과 후 ①name·birthDate 모두 null 항목 제거(비여권 사진·OCR 쓰레기) ②ticketGuestKey 중복 제거(재촬영 중복). 소비처 4곳 전부 이 헬퍼로 교체.
4. **운영자 확정본 = 정본 불변**: completeCheckIn 로직·검증 게이트(서명 필수 등) 무변경. 자동 OCR은 잠정 명단일 뿐 CheckInRecord에 자동 저장하지 않는다("ADMIN 확인·수정 확정본만 저장" 원칙은 CheckInRecord에 한해 유지).

## 수정 금지 구역

- lib/checkin.ts(completeCheckIn)·lib/ticket-order-validation.ts의 검증 순서·오류 코드, 운영자 체크인 UI.
- lib/gemini.ts ocrPassport 시그니처(호출만).
- 여권사진 URL·여권번호 등 화이트리스트(name·birthDate·heightCm) 밖 필드의 클라 노출 금지 — 명단 통로는 기존 guestsFromPassportOcr/whitelist 계열만.

## 완료 기준 (테스트 가능)

- [ ] 게스트 여권 업로드 → 토큰에 OCR 잠정본 누적(운영자 확정 없이) → /g/[token]/options에서 이름 칩 인원별 모드 활성.
- [ ] 같은 명단으로 티켓 주문 제출 시 서버 검증(loadConfirmedGuests)도 잠정본을 인정 — MISMATCH 미발생(코드 트레이스 가능).
- [ ] 운영자 확정본 존재 시 확정본이 항상 우선(잠정본 무시).
- [ ] OCR 실패·키 미설정에도 업로드 201 유지, 명단에 쓰레기 항목(전부 null)·중복 미유입.
- [ ] 스키마 additive만(기존 컬럼·데이터 불변), migrations-manual 파일 보존.
- [ ] 순수 로직(잠정본 정제·우선순위) 단위 테스트, `next build`·기존 테스트 통과.

## 검증 방법

QA: 코드 검토(누수·검증 대칭성 중심) + 단위 테스트 실행 + dev 실렌더(토큰 명단 모드 활성 확인 — 실주문 제출·실여권 업로드는 금지, OCR 잠정본은 스크립트로 라이브 대신 로컬 판정 또는 코드 트레이스).

## 후속 후보 (이번 범위 밖 — IDEAS/TASKS)

- 운영자 체크인 폼에 토큰 잠정 OCR prefill(운영자 재OCR 생략).
