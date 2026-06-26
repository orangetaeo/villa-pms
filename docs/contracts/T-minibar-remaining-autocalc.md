# 계약서: 미니바 소모 자동계산 (F2)

## 범위
체크아웃 시 운영자가 품목별 **소비량**을 직접 세는 대신 **현재 남은 수량(remaining)** 만 입력하면, 시스템이 `소비량 = 비치목표(par) − 남은수량` 으로 자동 계산하여 차감·청구.

- 체크아웃 폼: 품목별 "남은 수량" 입력 UI (기본값 = par, 즉 소비 0). par/onHand 표시.
- 서버: remaining 입력을 받아 consumedQty 자동 산출 후 기존 `completeCheckout` 의 minibarLines 경로 재사용 (CONSUME 차감·CheckoutMinibarLine·minibarChargeVnd 기존 로직 유지).
- 음수 방지: remaining > par 이면 소비 0 (clamp), remaining < 0 거부.
- 순수 함수 `computeConsumptionFromRemaining(par, remaining)` 신설 → 단위테스트.

## 비범위 (수정 금지)
- 재고 차감 원장(MinibarStockMovement) 구조 변경 금지 — 이미 자동, 입력단만 변경
- RECOVER(전환 회수)·게스트 통합청구 로직 변경 금지
- 스키마 변경 없음

## 완료 기준
1. `computeConsumptionFromRemaining` 순수함수 + 경계 테스트(remaining=par→0, remaining=0→par, remaining>par→0 clamp, 음수 거부)
2. 체크아웃 API: remaining 기반 입력 수용, 기존 consumedQty 직접 입력과 호환(둘 다 허용 또는 remaining 우선)
3. 체크아웃 폼 UI: 남은 수량 입력 + 소비량/청구액 미리보기
4. par = effectivePar(VillaMinibarStock.qty ?? MinibarItem.stockQty) 정확 조회
5. ko+vi i18n, typecheck·build·테스트 무손상

## 수정 금지 구역
- 본 작업 wt/rev-minibar-bookmod 단독. lib/checkout.ts 의 RECOVER/게스트청구 블록 미접촉.
