# ADR-0041 — 체크아웃 보증금 상계(가감산) 정산

- 날짜: 2026-07-13
- 상태: 승인 (TDA)
- 관련: ADR-0039(수납 라인), ADR-0019 S4(게스트 통합정산), ADR-0003(보증금·미니바), 계약서 T-checkout-deposit-offset

## 문제

1. **프로세스 오류 (테오 지적)** — 보증금(예: 3,000,000₫)을 쥐고 있는데도 체크아웃 화면은
   "청구(미니바+부가서비스) 전액을 현금/이체로 수납"과 "보증금 별도 환불"을 각각 수행하게 한다.
   현장 관행은 **보증금에서 파손·청구를 가감산하고 잔액만 환불(부족하면 차액만 수납)**.
2. **미니바 이중 계상 버그** — 미니바 소모분이 게스트 청구(guestChargeVnd)에도 들어가고,
   FE가 damageFound=true로 deductionVnd(보증금 차감)에도 합산 전송해 보증금에서도 빠졌다.
   화면 안내("수납 완료" + "차감 후 환불 승인")대로 조작하면 미니바를 두 번 수취한다.
   부수 오염: 파손이 없어도 damageFound=true로 저장됨.

## 결정

1. **`GuestSettlementMethod`에 `DEPOSIT`(보증금 차감) 추가** — 보증금 상계를 별도 메커니즘이 아니라
   ADR-0039의 **수납 라인(CheckoutSettlementLine)의 한 수단**으로 표현. currency=VND 전용(보증금이 VND).
   재사용: 라인 원장·MIXED 파생·settledVnd 캐시(DEPOSIT 포함 = "청구가 얼마나 커버됐나" 의미).
2. **미니바 보증금 자동 차감 제거** — deductionVnd=파손 차감만, damageFound=실제 파손만.
   미니바는 게스트 청구로만 1회 계상. 보증금으로 받으려면 DEPOSIT 라인으로 상계(FE가 자동 제안).
3. **서버 검증(클라 신뢰 금지)**: DEPOSIT 라인은 depositStatus=HELD·보증금 VND일 때만,
   Σ상계 ≤ 보증금 − 파손차감. 위반 시 400 구분 코드(DEPOSIT_OFFSET_EXCEEDS / DEPOSIT_NOT_HELD / DEPOSIT_NOT_VND).
4. **`depositDeductVnd` = 파손 + Σ상계** (보증금에서 빠진 총액 — 기존 표시·통계 하위호환). 상세는 라인 원장.
   DepositStatus: (파손+상계)>0 → PARTIAL_DEDUCTED / 0 → REFUNDED (NONE 규칙 기존 유지).
5. **화면 순서(테오 지시)**: 파손·손실 리포트(최상단) → 미니바 → 부가서비스 청구 → **가감산 요약**
   (보증금 − 파손 − 총청구 환산 = 환불 예정액 or 추가로 받을 금액) → 수납 라인(DEPOSIT 자동 제안) → 승인 버튼.
6. `narrowVendorSettleMethod`는 화이트리스트(CASH|BANK_TRANSFER|OTHER)로 변경 —
   공유 enum 값 추가 시 벤더 정산 소비처 회귀(PR #276에서 실증) 원천 차단.

## 대안 검토

- **보증금 상계를 deductionVnd에 계속 합산(현행 미니바 방식 확장)**: 수단·금액 내역이 없어 시재·대사 불가,
  damageFound 오염 지속 — 기각.
- **가감산 자동 강제(수납 라인 없이 서버가 알아서 상계)**: 현장에서 손님이 "보증금은 그대로 돌려받고
  청구는 현금으로" 선택하는 경우를 막는다 — 기각. 자동 제안 + 운영자 편집으로 유연성 유지.

## 마이그레이션

`prisma/migrations-manual/2026-07-13-checkout-deposit-offset.sql` — `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'DEPOSIT'`.
Railway DB 적용 완료(2026-07-13). 구 레코드(미니바 합산 deductionVnd·damageFound 오염)는 역사적 기록으로 보존 —
표시 하위호환 유지, 백필 없음.
