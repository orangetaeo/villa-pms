# ADR-0018 — 정산 복식부기 LEDGER (정산 2차 P2-3)

- 상태: **Proposed** (설계 초안 — 테오 검토 후 구현)
- 일자: 2026-06-25
- 관련: [[settlement-finance-status]], ADR-0003(통화), P2-1 실수납(PR #13), P2-2 상태확장+환차(PR #16)
- 참조 패턴: `reference/exchange/server/services/trading/bithumbLedger.ts` (거래내역 캐시 + 분류 + 회계항등식 verify)

## 배경 / 문제

P2-1·P2-2로 **실수납(Payment)**·**지급 생애주기(Settlement 상태)**·**환차(fxAdjustmentVnd)**가 갖춰졌으나, 셋은 서로 다른 테이블에 흩어져 있고 **단식(single-entry)** 이다. 운영자가 "지금 우리 현금이 통화별로 얼마이고, 공급자에게 갚을 채무가 얼마이며, 환차 손익 누계가 얼마인가"를 한 장부에서 검증 가능한 형태로 보지 못한다. 회계 항등식(차변합 = 대변합)으로 데이터 무결성을 검증할 수단도 없다.

P2-3는 모든 자금 이동을 **복식부기 LEDGER**에 균형 분개로 적재해, ① 통화별 현금/채무/손익 잔액을 단일 소스에서 도출하고 ② 항등식으로 무결성을 검증한다.

## 결정 (제안)

### 1. 계정 과목 (Account)
| 계정 | 성격 | 의미 |
|---|---|---|
| `CASH_KRW` | 자산 | 우리가 보유한 KRW 현금(한국 계좌) |
| `CASH_VND` | 자산 | 우리가 보유한 VND 현금(베트남 계좌) |
| `SUPPLIER_PAYABLE` | 부채 | 공급자 지급 채무(VND) |
| `REVENUE` | 수익 | 숙박 판매 매출 |
| `FX_GAIN_LOSS` | 손익 | 환차 손익(수납 KRW환산 vs 지급 VND 차이) |

> COGS(공급자 원가)는 SUPPLIER_PAYABLE 적립으로 갈음. 보증금은 매출 아님 → LEDGER 제외(기존 Booking.deposit* 유지, P2-1 결정 일관).

### 2. 모델 (additive — 라이브 DB raw SQL ALTER, db push 금지)
```prisma
enum LedgerAccount { CASH_KRW CASH_VND SUPPLIER_PAYABLE REVENUE FX_GAIN_LOSS }
enum LedgerEntryType { COLLECTION PAYOUT FX_ADJUSTMENT REVENUE_RECOGNITION }

model LedgerTransaction {        // 한 묶음의 균형 분개(거래)
  id          String   @id @default(cuid())
  type        LedgerEntryType
  occurredAt  DateTime              // 자금 이동 실제 시각
  // 출처 역참조 — 멱등·추적용 (정확히 하나만 채움)
  paymentId   String?  @unique      // COLLECTION
  settlementId String?              // PAYOUT·FX_ADJUSTMENT (정산 1건에 복수 분개)
  memo        String?
  createdBy   String
  createdAt   DateTime @default(now())
  lines       LedgerLine[]
}

model LedgerLine {                 // 분개선 — 한 계정의 차변 또는 대변
  id            String   @id @default(cuid())
  transactionId String
  transaction   LedgerTransaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  account       LedgerAccount
  currency      Currency           // KRW·VND
  // 차변(+)·대변(−)을 부호로 표현. VND BigInt 동, KRW BigInt 원. float 금지.
  amount        BigInt             // 자산·비용 증가 = +(차변), 부채·수익 증가 = −(대변)
  @@index([transactionId])
  @@index([account, currency])
}
```
> 부호 규약: **차변 +, 대변 −**. 한 LedgerTransaction의 `sum(amount)`(통화별)이 **0** 이어야 균형(항등식). 통화가 섞이는 환차는 §4 참조.

### 3. 이벤트 → 분개 매핑
- **COLLECTION**(Payment 기록 시): 고객에게 KRW 1,000,000 수납
  - `CASH_KRW +1,000,000` (자산↑ 차변) / `REVENUE −1,000,000` (수익↑ 대변) → KRW 합 0 ✓
- **PAYOUT**(Settlement MARK_PAID): 공급자에게 VND 18,000,000 지급
  - `SUPPLIER_PAYABLE +18,000,000` (부채↓ 차변) / `CASH_VND −18,000,000` (자산↓ 대변) → VND 합 0 ✓
  - SUPPLIER_PAYABLE 적립(CONFIRM 시): `COGS/REVENUE 조정 −` / `SUPPLIER_PAYABLE +` (설계 시 확정)
- **FX_ADJUSTMENT**(Settlement ADJUST_FX): P2-2 fxAdjustmentVnd를 손익으로
  - `FX_GAIN_LOSS ∓` / `CASH_VND 또는 SUPPLIER_PAYABLE ±` (부호는 이익/손실에 따라)

### 4. 다통화 균형 처리
복식부기는 **통화별로** 균형을 본다(KRW 분개는 KRW끼리, VND는 VND끼리 합 0). 환차(KRW 수납 ↔ VND 지급의 차이)는 통화 경계를 넘으므로 **FX_GAIN_LOSS 계정(VND 기준)으로 단일통화 정산**한다 — 수납 KRW는 수납 시점 환율(Payment.fxRateToVnd)로 VND 환산해 비교, 차이를 FX_GAIN_LOSS에 적재. 즉 LEDGER 잔액 검증은 **(KRW 항등식) ∧ (VND 항등식)** 두 축으로 수행.

### 5. 멱등·검증
- COLLECTION은 `paymentId @unique`로 1:1 멱등. PAYOUT/FX_ADJUSTMENT는 settlementId+type으로 중복 방지.
- `verifyLedger()`: 통화별 `sum(amount)=0`(전체 균형) + 계정별 잔액 = 파생 기대값(예: SUPPLIER_PAYABLE 잔액 = 미지급 정산 합) 교차 검증. bithumbLedger.verify 패턴 차용.

## 구현 단계 (제안)
- **S0** 스키마(enum 2 + 모델 2) raw ALTER + generate.
- **S1** `lib/ledger.ts` 순수 분개 빌더(이벤트→LedgerLine[]) + 균형 단위테스트(통화별 합 0).
- **S2** 훅: Payment 생성 → COLLECTION 분개, Settlement MARK_PAID → PAYOUT, ADJUST_FX → FX 분개(각 트랜잭션 내 멱등).
- **S3** 백필 스크립트: 기존 Payment·PAID Settlement → LEDGER 분개 멱등 생성.
- **S4** `verifyLedger()` + /settlements 검증 배너(불균형 경고, ADMIN 전용).
- **S5(선택)** 계정별 잔액 대시보드(통화별 현금·채무·환차손익 누계).

## 미해결 / 테오 결정 필요
1. **SUPPLIER_PAYABLE 적립 시점** — CONFIRM(확정) vs COLLECTED? 매출 인식(REVENUE) 시점과 함께 회의 필요.
2. **REVENUE 인식 기준** — 수납 시(현금주의) vs 체크아웃 시(발생주의)? 현 파생 손익은 사실상 현금주의.
3. **백필 범위** — 데모 53행 Payment 제외, 실거래만.
4. **누수** — LEDGER 전체는 ADMIN(canViewFinance) 전용. 계정 잔액·매출·환차 공급자 미노출(기존 원칙 유지).

## 대안 (기각)
- **단식 유지 + 파생 집계만**: P2-1·P2-2 수준. 무결성 검증 불가, 통화별 현금 포지션 추적 불가 → 기각.
- **외부 회계 SW 연동**: 과도. Phase 2 범위 밖.

## 결과
구현은 본 ADR 승인 후 새 스프린트(P2-3)로. 스키마 1세션 전담 원칙 유지. 본 문서는 설계 합의용 초안이며 §"미해결" 4건 확정 전 코딩 금지.
