# ADR-0018 — 정산 복식부기 LEDGER (정산 2차 P2-3)

- 상태: **Accepted** (테오 결정 4건 확정 2026-06-25 → P2-3 구현)
- 일자: 2026-06-25
- 관련: [[settlement-finance-status]], ADR-0003(통화), P2-1 실수납(PR #13), P2-2 상태확장+환차(PR #16)
- 참조 패턴: `reference/exchange/server/services/trading/bithumbLedger.ts` (거래내역 캐시 + 분류 + 회계항등식 verify)

## 배경 / 문제

P2-1·P2-2로 **실수납(Payment)**·**지급 생애주기(Settlement 상태)**·**환차(fxAdjustmentVnd)**가 갖춰졌으나, 셋은 서로 다른 테이블에 흩어져 있고 **단식(single-entry)** 이다. 운영자가 "지금 우리 현금이 통화별로 얼마이고, 공급자에게 갚을 채무가 얼마이며, 환차 손익 누계가 얼마인가"를 한 장부에서 검증 가능한 형태로 보지 못한다. 회계 항등식(차변합 = 대변합)으로 데이터 무결성을 검증할 수단도 없다.

P2-3는 모든 자금 이동을 **복식부기 LEDGER**에 균형 분개로 적재해, ① 통화별 현금/채무/손익 잔액을 단일 소스에서 도출하고 ② 항등식으로 무결성을 검증한다.

## 결정 (확정)

### 0. 테오 확정 결정 (2026-06-25)
1. **REVENUE 인식 = 현금주의(수납 시)**. 기존 파생 손익과 일관. 발생주의(체크아웃) 기각 — 선수금/이연매출 추적 비용 과다, MVP 부적합.
2. **SUPPLIER_PAYABLE 적립 = 수납 시(COLLECTED)**. Settlement COLLECT 전이에서 원가 적립 → 매출 인식과 시점 일치, 미입금 예약에 채무 선반영 방지.
3. **백필 범위 = 실거래만** (데모 Payment·정산 제외).
4. **누수 = LEDGER 전체 ADMIN 전용** (계정잔액·매출·환차 공급자 미노출, 기존 원칙 유지).

### 1. 계정 과목 (Account) — 6계정
| 계정 | 성격 | 의미 |
|---|---|---|
| `CASH_KRW` | 자산 | 우리가 보유한 KRW 현금(한국 계좌) |
| `CASH_VND` | 자산 | 우리가 보유한 VND 현금(베트남 계좌) |
| `SUPPLIER_PAYABLE` | 부채 | 공급자 지급 채무(VND) |
| `REVENUE` | 수익 | 숙박 판매 매출(수납 통화 그대로) |
| `COGS` | 비용 | 공급자 원가(VND) — SUPPLIER_PAYABLE의 대차 상대 |
| `FX_GAIN_LOSS` | 손익 | 환차 손익(수납 KRW환산 vs 지급 VND 차이, VND) |

> **TDA 보강(초안 5계정 → 6계정):** 초안은 "COGS는 SUPPLIER_PAYABLE 적립으로 갈음"이라 했으나, 복식부기는 모든 분개가 **통화별로** 균형(합 0)을 이뤄야 한다. SUPPLIER_PAYABLE(부채↑=대변 −)의 대차 상대가 없으면 VND 분개가 균형 불가다. **COGS(비용↑=차변 +)** 계정을 둬 `COGS + SUPPLIER_PAYABLE = 0`(VND)을 만족시키고, 마진(REVENUE − COGS)을 장부에서 직접 도출한다. 보증금은 매출 아님 → LEDGER 제외(P2-1 결정 일관).

### 2. 모델 (additive — 라이브 DB raw SQL ALTER, db push 금지)
```prisma
enum LedgerAccount { CASH_KRW CASH_VND SUPPLIER_PAYABLE REVENUE COGS FX_GAIN_LOSS }
enum LedgerEntryType { COLLECTION COST_ACCRUAL PAYOUT FX_ADJUSTMENT }

model LedgerTransaction {        // 한 묶음의 균형 분개(거래)
  id           String   @id @default(cuid())
  type         LedgerEntryType
  occurredAt   DateTime              // 자금 이동 실제 시각
  // 출처 역참조 — 멱등·추적용 (정확히 하나만 채움)
  paymentId    String?  @unique      // COLLECTION 1:1 멱등
  settlementId String?               // COST_ACCRUAL·PAYOUT·FX (정산당 type별 1건)
  memo         String?
  createdBy    String
  createdAt    DateTime @default(now())
  lines        LedgerLine[]
  @@index([settlementId, type])
}

model LedgerLine {                 // 분개선 — 한 계정의 차변 또는 대변
  id            String   @id @default(cuid())
  transactionId String
  transaction   LedgerTransaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  account       LedgerAccount
  currency      Currency           // KRW·VND
  amount        BigInt             // 자산·비용 증가 = +(차변), 부채·수익 증가 = −(대변). float 금지
  @@index([transactionId])
  @@index([account, currency])
}
```
> 부호 규약: **차변 +, 대변 −**. 한 LedgerTransaction의 `sum(amount)`(통화별)이 **0** 이어야 균형(항등식).

### 3. 이벤트 → 분개 매핑 (부호: 차변 +, 대변 −)
- **COLLECTION**(Payment POST, `paymentId` 멱등): 고객이 통화 C로 amount 수납
  - `CASH_{C} +amount` / `REVENUE −amount` → C 통화 합 0 ✓ (매출은 수납 통화 그대로)
- **COST_ACCRUAL**(Settlement COLLECT, `settlementId` 멱등): 정산 totalVnd 만큼 원가·채무 인식
  - `COGS +totalVnd` / `SUPPLIER_PAYABLE −totalVnd` → VND 합 0 ✓
- **PAYOUT**(Settlement MARK_PAID, `settlementId` 멱등): 공급자에게 totalVnd 지급
  - `SUPPLIER_PAYABLE +totalVnd` / `CASH_VND −totalVnd` → VND 합 0 ✓
- **FX_ADJUSTMENT**(Settlement ADJUST_FX, 정산당 replace): fxAdjustmentVnd(+이익/−손실)
  - `CASH_VND +fxAdj` / `FX_GAIN_LOSS −fxAdj` → VND 합 0 ✓ (재조정 시 기존 FX 분개 삭제 후 재생성)

### 4. 다통화 균형 처리
복식부기는 **통화별로** 균형을 본다(KRW 분개는 KRW끼리, VND는 VND끼리 합 0). REVENUE는 수납 통화(KRW 수납이면 KRW)로 남고, COGS/PAYABLE/PAYOUT은 VND다. 마진(VND 기준)·환차는 수납 시점 환율(Payment.fxRateToVnd)로 REVENUE를 VND 환산해 도출하며, 실지급과의 차이를 **FX_GAIN_LOSS**(VND)로 정산한다. LEDGER 무결성 검증은 **(KRW 항등식) ∧ (VND 항등식)** 두 축.

### 5. 멱등·검증
- COLLECTION은 `paymentId @unique`로 1:1 멱등. COST_ACCRUAL/PAYOUT은 settlementId+type 존재 시 skip. FX는 settlementId+type 삭제 후 재생성.
- `verifyLedger()`: 통화별 `sum(amount)=0`(전체 균형) + 계정별 잔액 = 파생 기대값 교차검증(예: SUPPLIER_PAYABLE 잔액 = COLLECTED·미PAID 정산 totalVnd 합). bithumbLedger.verify 패턴 차용.

## 구현 단계
- **S0** 스키마(enum 2 + 모델 2) raw ALTER/CREATE + generate.
- **S1** `lib/ledger.ts` 순수 분개 빌더(이벤트→LedgerLine[]) + 균형 단위테스트(통화별 합 0).
- **S2** 훅: Payment POST → COLLECTION, Settlement COLLECT → COST_ACCRUAL, MARK_PAID → PAYOUT, ADJUST_FX → FX(각 기존 트랜잭션 내부 멱등).
- **S3** 백필 스크립트: 실거래 Payment·COLLECTED+ Settlement → LEDGER 분개 멱등 생성.
- **S4** `verifyLedger()` + /settlements 검증 배너(불균형 경고, ADMIN 전용).
- **S5(선택, 후속)** 계정별 잔액 대시보드(통화별 현금·채무·환차손익 누계).

## 대안 (기각)
- **단식 유지 + 파생 집계만**: P2-1·P2-2 수준. 무결성 검증·통화별 현금 포지션 추적 불가 → 기각.
- **외부 회계 SW 연동**: 과도. Phase 2 범위 밖.

## 결과
구현 P2-3 (브랜치 wt/settlement-ledger). 스키마 1세션 전담 원칙 유지. PR #17(초안)은 본 확정본으로 대체.
