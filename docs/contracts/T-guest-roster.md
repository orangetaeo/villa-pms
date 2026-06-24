# 계약: T-guest-roster — 가예약 투숙객 명단(실명) 입력

## 배경 / 문제
랜드사·여행사 채널은 가예약(HOLD) 시점에 최종 투숙객("김학태 외 1명")을 모르는 경우가 정상이다(재고 선점 → 한국 판매 후 명단 확정). 현재 `Booking.guestName`(단일 문자열)은 **예약 식별명**으로만 쓰여, 실제 투숙객 명단을 담을 자리가 없다. 실명은 임시거주신고(tạm trú)·동의서·여권 대조에 필요하지만, 시스템상 **체크인 시 여권 OCR** 전까지 어디에도 기록되지 않는다.

## 결정 (기획 회의 — 테오 승인 2026-06-24)
- **입력 시점**: 가예약 시점 강제 금지(거짓 데이터 유입). 실제 명단은 **입금 확정 이후 ~ 체크인 전날**에 입력. 여권 OCR(`CheckInRecord.passportOcrJson`)이 최종 진실원천이므로, 그 전 명단은 "준비용 예고" 위상.
- **입력 주체 (Phase 1 = 안 A)**: 비로그인 여행사는 포털이 없으므로 **ADMIN(테오)이 예약 상세에서 입력**. (안 B = 토큰 기반 여행사 셀프 입력 페이지는 Phase 2 백로그)
- **데이터 모델 (경량)**: `Booking.guestRoster String?` 자유 텍스트. 구조화 `Guest` 자식 모델은 Phase 2.

## 범위 (이 PR — 격리 worktree `wt/guest-roster`)
1. **스키마**: `Booking.guestRoster String?` 추가 (additive, 데이터 손실 0). **`prisma db push`는 보류** — 테오가 트리 동기화 후 실행.
2. **PATCH `/api/bookings/[id]`**: 기존 `note` 전용 → `note`·`guestRoster` 선택 수용으로 확장. 둘 다 미지정이면 400. 빈 문자열 → null. AuditLog 기록. **상태·금액 필드는 여전히 절대 수정 불가**(전이 무결성은 confirm/cancel/expire 전용 경로만).
3. **예약 상세 `/bookings/[id]`**: 투숙객 명단 카드(`RosterBox`, MemoBox 패턴 재사용) — 보기·편집·저장. CONFIRMED 이상 + 명단 미입력 시 "미입력" 힌트.
4. **체크인 시트 `/bookings/checkin-sheet`**: 명단이 있으면 ① 예약 정보 섹션에 표시(tạm trú 준비용).
5. **i18n**: `adminBookings.detail.roster.*` ko/vi 동시 추가.
6. **테스트**: PATCH 검증(guestRoster only / note only / 둘 다 / 빈 입력 → null / 권한 401·403 / 상태 필드 주입 무시) + AuditLog.

## 수정 금지 구역 (다른 세션 점유 가능)
- `lib/hold.ts`·`lib/proposal.ts`·`lib/cleaning.ts` — 본 PR은 **읽기만**. HOLD 생성 시 명단 수집은 하지 않음(결정상 가예약 강제 금지).
- `messages/*.json`은 **키 추가만** (기존 키 수정·삭제 금지).

## 완료 기준 (테스트 가능)
- [ ] `npm run typecheck` 0 에러, `npm test` 신규 포함 전체 green
- [ ] PATCH가 `guestRoster`만/`note`만/둘 다 수용, 빈 입력은 null 저장, 둘 다 미지정 400
- [ ] PATCH로 `status`/`totalSaleKrw` 등 주입 시 무시(strip)됨을 테스트로 증명
- [ ] 비로그인 401 / SUPPLIER·CLEANER 403
- [ ] 예약 상세에서 명단 입력→저장→재조회 반영, AuditLog 1건(`guestRoster` old/new)
- [ ] 체크인 시트에 명단 표시(있을 때만), 마진·판매가 비노출 회귀 0
- [ ] `messages/ko.json`·`vi.json` 키 동등(누락 0)

## 배포 의존 (이 PR 밖)
- **`prisma db push`** (테오/TDA, 트리 동기화 후 단일 세션) — 그 전까지 `guestRoster` 런타임 미작동.
- **D-3 Zalo 명단 입력 리마인더 cron**: 별도 후속(OPS Railway cron 등록 필요). 본 PR은 데이터 기반만 마련.

## Phase 2 백로그 (IDEAS)
- 안 B: 예약별 토큰 링크로 여행사 셀프 명단 입력 + D-3 Zalo 리마인더.
- 구조화 `Guest` 모델(name·isLead·passportNo) → tạm trú 자동화·여권 OCR 사람 단위 매칭.
