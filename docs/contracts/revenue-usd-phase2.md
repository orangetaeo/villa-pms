# 계약서 — USD 예약 판매통화 지원 (Phase 2)

- 착수: 2026-06-27
- 브랜치: `wt/revenue-usd-phase2`
- 선행: Phase 1(PR #84, 통화 통합 환산 표시) main 머지 완료

## 목표
saleCurrency=USD(정수 달러) 예약을 생성·기록하고, /revenue·통계·정산에 잡히게 한다.
USD는 요율표(VillaRatePeriod)에 단가가 없어 **자동견적 불가 → ADMIN이 제안 생성 시 USD 총액을 수동 입력**한다.

## 설계 결정 (확정)
- USD 금액 = 정수 달러(Int). 부동소수점 금지.
- 스키마(additive): `ProposalItem.totalUsd Int?`, `Booking.totalSaleUsd Int?` + `Booking.fxVndPerUsd Decimal?(14,4)`, `Proposal.fxVndPerUsd Decimal?(14,4)`.
- fxVndPerUsd 스냅샷 = 제안 생성 시 오늘 USD→VND 환율(getDailyRates().vndPerUnit.USD)을 Decimal 문자열로 저장. 없으면 null(환산 불가=fxMissing).
- 환산 = `usdToVndSnapshot(usd, fxVndPerUsd)` (KRW 패턴 동형, half-up, 1e4 스케일). 환산값은 표시용 근사치.
- 마진(환산 후) = usd→vnd 환산 − supplierCostVnd. (Phase 1 정책 동일)

## 범위 (수정 파일)
- prisma/schema.prisma — 위 4개 컬럼 (additive)
- lib/pricing.ts — assertSupportedSaleCurrency(USD 허용)·assertSaleAmountColumns(3분기, usd 인자)·usdToVndSnapshot·quoteStayForVilla(USD는 원가만)
- lib/proposal.ts — createProposal USD 분기(item.totalUsd 사용, quote sale 생략, fxVndPerUsd 스냅샷)
- lib/hold.ts — Booking.totalSaleUsd·fxVndPerUsd 복사, assertSaleAmountColumns usd
- app/api/proposals/route.ts·candidates/route.ts — zod enum USD, items[].totalUsd, 후보 통화검증 USD
- app/(admin)/proposals/new/proposal-create.tsx — USD 통화 선택 + 빌라별 USD 총액 수동 입력 + payload totalUsd
- lib/revenue-ledger.ts — USD 활성화(saleUsd·usd환산 saleVndEquivalent, fxVndPerUsd select/주입)
- lib/settlement-finance.ts — bookingFinance USD 분기
- lib/payment.ts — computeVndEquivalent USD 분기(fxRateToVnd 필수)
- messages/ko.json·vi.json — USD 관련 키 추가만
- 테스트: pricing·revenue-ledger·settlement-finance·proposal 회귀 추가

## 완료 기준
1. USD 제안 생성→가예약→Booking.totalSaleUsd 저장(수동 총액)
2. /revenue 통합 환산·원본 USD 칸·환산 후 마진에 USD 반영
3. 정산 손익·수납 USD 처리, 누수 0(canViewFinance)
4. typecheck·vitest·build 통과 + 독립 QA PASS
5. 공유 Neon additive ALTER 적용(db push 금지)

## 수정 금지 구역
- 다른 세션 파일(prisma/seed-*, docs/usage-*), Phase 1 머지분 외 revenue 비관련 로직
