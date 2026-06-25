# 계약: 정산 2차 P2-2 — Settlement 상태확장 + 환차조정

- 태스크: 정산 고도화 Phase 2, 2순위. 테오 2026-06-25 결정(지급 생애주기 확장).
- 브랜치: `wt/settlement-status` (origin/main 9697576 기준). 스키마 전담 세션.
- 선행: P2-1 실수납(PR #13) 배포. [[settlement-finance-status]]

## 결정 (테오 확정)
공급자 지급 생애주기를 확장: **DRAFT→CONFIRMED→COLLECTED→FX_ADJUSTED→PAID**.
- `COLLECTED` = 고객 실수납 완료(지급 재원 확보), `FX_ADJUSTED` = 환차(수납 KRW vs 지급 VND 차이) 수동 반영.
- 환차는 **선택 단계** — 환차 없는 정산은 건너뛰고 PAID 가능. 기존 CONFIRMED 정산도 그대로 PAID 가능(호환).

## 스코프 (IN)
1. **스키마(additive, 라이브 DB raw SQL ALTER — db push 금지)**: `SettlementStatus` enum + COLLECTED·FX_ADJUSTED. Settlement + `collectedAt`·`fxAdjustedAt` DateTime? + `fxAdjustmentVnd` BigInt?(+이익/−손실).
2. **전이표(lib/settlement.ts)**: CONFIRM/COLLECT/ADJUST_FX/MARK_PAID. from은 배열(MARK_PAID는 CONFIRMED·COLLECTED·FX_ADJUSTED 허용, ADJUST_FX 재조정 허용). 단계별 타임스탬프·fxAdjustmentVnd 영속, status 가드 updateMany(경합 1승).
3. **API(PATCH /api/settlements/[id])**: action enum 확장 + ADJUST_FX의 fxAdjustmentVnd 입력. GET에 신규 필드.
4. **UI(settlements-view)**: 상태 배지 5종, 단계별 액션 버튼(수납완료/환차조정/환차재조정/지급완료), 환차 금액 prompt 입력. i18n ko/vi.

## 스코프 (OUT)
- 복식부기 LEDGER(P2-3)·월정산서 PDF(P2-4). 마진 기준 실수납 전환(회계 결정).
- 환차 금액 자동계산(수동 입력만). 환차 행 표시 컬럼(후속).

## 누수 규칙
- COLLECTED·FX_ADJUSTED·fxAdjustmentVnd는 운영자 내부 상태. 공급자 /earnings는 기존대로 "PAID만 지급완료, 그 외 지급대기"(새 상태 자동 포섭, 환차액 미노출). dashboard 미지급=≠PAID 자동 포섭.

## 완료 기준 (테스트 가능)
1. 전이표: 정방향 4단계 + 환차 선택(MARK_PAID from 3상태) + 재조정 + 잘못된 전이 409. (단위)
2. transitionSettlement: COLLECT→collectedAt, ADJUST_FX→fxAdjustedAt+fxAdjustmentVnd(음수 손실·미지정 0n), MARK_PAID→paidAt+SETTLEMENT_READY. (mock db)
3. 라이브 DB enum 5값·컬럼 3개 실측. typecheck 0·전체 테스트 통과(+신규).
4. 누수 0: 공급자 표면에 새 상태·환차액 미노출.

## 검증
- vitest(settlement.test 전이표 + settlement-transition-p2 mock db). typecheck. 라이브 DB 실측(완료).
- QA 독립 평가 + 프로덕션 스모크.
