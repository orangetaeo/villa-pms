# 계약: 소비자 E2E 버그 5건+경미 2건 수정

- 브랜치: `wt/consumer-bugs` (worktree 격리)
- 근거: 2026-07-03 소비자 E2E 전수점검 (memory: consumer-e2e-audit-2026-07-03)
- 회의 요약: PM(전건 단일 PR — 전부 소비자 여정 결함으로 응집, 스키마 무변경) /
  TDA(#2는 저장 시점 채널 분기(requestedVia)로 해결 — 조회측 OR 분기보다 의미가 정확, 마이그레이션 불필요) /
  BE(#1 검증은 createHoldFromProposalItem 단일 소스에, 라우트는 409 사유 매핑만) /
  QA(정원검증·requestedVia 분기·체크아웃 게이트 단위테스트 + 라이브 스모크)

## 범위 (테스트 가능한 완료 기준)

- [ ] **#1 정원 초과 가예약 무검증**: createHoldFromProposalItem에서 guestCount > villa.maxGuests → HoldRejectedError(OVER_CAPACITY), /p hold 라우트 409 매핑. 폼 인원 셀렉트 1~maxGuests 상한 + 초과 에러 문구
- [ ] **#2 직판 소비자 부가서비스 뷰 분단**: /api/p/[token]/service-orders 저장 시 booking.channel=DIRECT면 requestedVia=GUEST(소비자 본인 신청) — /g 신청내역·정산 미리보기·셀프취소에 즉시 포함. 파트너 채널은 기존 PARTNER 유지
- [ ] **#3 셀프취소 라벨**: 게스트 주문 CANCELLED 전용 라벨 "취소됨"(5언어) — statusOther 폴백 제거
- [ ] **#4 셀프 여권 미채택**: 관리자 체크인 페이지가 GuestCheckinToken.passportPhotoUrls를 조회해 CheckinForm 슬롯에 프리필(서명 채택과 동일 조건 — CheckInRecord 없을 때)
- [ ] **#5 무보증금+미니바 체크아웃 잠김**: 보증금 미수취 시 미니바 소비가 있어도 체크아웃 완료 가능(미니바는 게스트 청구서로 정산 — 보증금 차감 아님). 보증금 있는 경우 기존 게이트 유지
- [ ] **#6 동의서 조항 절단 중복**: 가짜 제목(content 24자 절단) 제거 — 번호+전문 1회 표기

## 검증
- `npx tsc --noEmit` 0 / vitest 그린(신규: 정원검증·requestedVia 분기·체크아웃 게이트) / `npx next build` 통과
- 라이브 스모크: 정원초과 409·DIRECT 요청 /g 노출·무보증금+미니바 체크아웃 완료

## 수정 금지 구역
- prisma/schema.prisma(무변경), 파트너 포털, 벤더 통계, 청소 — 타 세션 활동 영역
