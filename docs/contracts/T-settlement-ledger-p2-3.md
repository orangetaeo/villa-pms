# 계약서 — 정산 2차 P2-3 복식부기 LEDGER

- 태스크: P2-3 (ADR-0018)
- 담당 세션: wt/settlement-ledger
- 상태: 착수(선점)
- 선행: P2-1 Payment(머지), P2-2 상태확장+환차(머지, main 134b52d)

## 테오 확정 결정 (2026-06-25)
1. **REVENUE 인식**: 현금주의 — 수납 시. (Payment 기록 시점, 기존 파생 손익과 일관)
2. **SUPPLIER_PAYABLE 적립**: 수납 시(COLLECTED). Settlement COLLECT 전이에서 원가 적립.
3. **백필 범위**: 실거래만(데모 Payment·정산 제외).
4. **누수**: LEDGER 전체 ADMIN(canViewFinance/isSystemAdmin) 전용.

## TDA 구조 결정 (ADR 보강)
- **COGS 계정 추가(6계정)** — SUPPLIER_PAYABLE의 대차 상대. 없으면 VND 분개가 균형 불가·마진이 장부 비도출. 근거 ADR-0018 §1.
- 분개는 **통화별로 균형**(KRW끼리 합 0, VND끼리 합 0). REVENUE는 수납 통화(KRW/VND) 그대로, COGS/PAYABLE은 VND.

## 이벤트 → 분개 (부호: 차변 +, 대변 −)
| 이벤트 | 훅 | 분개 | 통화 |
|---|---|---|---|
| COLLECTION | Payment POST (멱등 paymentId) | CASH_{C} +amount / REVENUE −amount | 수납 통화 |
| COST_ACCRUAL | Settlement COLLECT (멱등 settlementId) | COGS +totalVnd / SUPPLIER_PAYABLE −totalVnd | VND |
| PAYOUT | Settlement MARK_PAID (멱등 settlementId) | SUPPLIER_PAYABLE +totalVnd / CASH_VND −totalVnd | VND |
| FX_ADJUSTMENT | Settlement ADJUST_FX (settlement당 replace) | CASH_VND +fxAdj / FX_GAIN_LOSS −fxAdj | VND |

> fxAdjustmentVnd: +이익/−손실. 재조정 시 기존 FX 분개 삭제 후 재생성(절대값 반영).

## 범위 (수정 파일)
- `prisma/schema.prisma` — enum LedgerAccount·LedgerEntryType + model LedgerTransaction·LedgerLine (additive). **이 세션 스키마 전담.**
- `prisma/migrations/` 또는 raw SQL — 라이브 DB additive CREATE (db push 금지)
- `lib/ledger.ts` (신규) — 순수 분개 빌더 + 잔액/검증 함수
- `lib/ledger.test.ts` (신규) — 통화별 균형·멱등·verify 단위테스트
- `app/api/bookings/[id]/payments/route.ts` — COLLECTION 훅(기존 tx 내부)
- `lib/settlement.ts` `transitionSettlement` — COST_ACCRUAL·PAYOUT·FX 훅(기존 tx 내부)
- `app/api/settlements/route.ts` 또는 view — verifyLedger 배너(ADMIN 전용, 선택)
- `scripts/backfill-ledger.ts` (신규) — 실거래 멱등 백필

## 수정 금지 구역 (타 세션 작업 중)
- 공유 메인 폴더 직접 커밋 금지(worktree 격리). messages/*.json은 키 추가만.

## 완료 기준 (테스트 가능)
1. 모든 LedgerTransaction은 **통화별 sum(amount)=0** (단위테스트로 강제).
2. COLLECTION/COST_ACCRUAL/PAYOUT/FX 각 멱등 — 중복 호출 시 분개 1세트만.
3. `verifyLedger()`: 통화별 전체 합 0 + SUPPLIER_PAYABLE 잔액 = COLLECTED·미PAID 정산 totalVnd 합.
4. 누수 0 — ledger.ts는 ADMIN 경로만 import. 공급자/STAFF·Zalo·공개링크에 계정잔액·매출·환차 미노출.
5. typecheck 0 + 기존 정산/Payment 테스트 무회귀 + ledger 신규 테스트 통과.
6. `next build` 통과(배포 게이트).

## 검증 방법
- `npx vitest run lib/ledger.test.ts lib/settlement.test.ts lib/payment.test.ts`
- `npm run typecheck` / `npx next build`
- QA 누수 점검(leak-checklist): grep ledger import 경로 + 공급자 응답 필드 확인
