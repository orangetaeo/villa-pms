# ADR-0024 — 파트너 청구서 수납 → LEDGER COLLECTION 연결

- 상태: **Accepted** (테오 확정 2026-06-26: D1~D4 전부 권장값 채택 → 구현 완료)
- 일자: 2026-06-26
- 관련: [[ADR-0018-settlement-double-entry-ledger]](복식부기 LEDGER·현금주의), [[ADR-0022-partner-receivables-credit]](파트너 AR·청구서), 메모리 [[partner-b2b-receivables-plan]]·[[settlement-finance-status]]
- 코드 근거: `lib/ledger.ts`(postCollection·reverseCollection·verifyLedger), `lib/partner-invoice.ts`(recordInvoicePayment), `app/api/bookings/[id]/payments/route.ts`(COLLECTION 적재 경로), `app/api/partner-invoices/[id]/payments/route.ts`(미연결 경로), `prisma/schema.prisma`(Payment.invoiceId 기존 존재)

## 배경 / 문제

ADR-0018로 모든 자금 이동을 복식부기 LEDGER에 균형 분개(현금주의, 수납 시 REVENUE 인식)로 적재한다. 수납(COLLECTION) 분개는 **Payment row 1건당 1:1 멱등**(`LedgerTransaction.paymentId @unique`)으로 `postCollection()`이 적재한다.

그런데 **수납 경로가 둘로 갈라져 있고, 한쪽만 장부에 들어간다:**

| 경로 | 함수 | Payment row | LEDGER COLLECTION |
|---|---|---|---|
| `POST /api/bookings/[id]/payments` (예약 직접수납·선금/잔금) | `tx.payment.create` + `postCollection` | ✅ 생성 | ✅ **적재됨** |
| `POST /api/partner-invoices/[id]/payments` (마감 청구서 수납) | `recordInvoicePayment` → `paidVnd` 누적만 | ❌ 없음 | ❌ **미적재** |

ADR-0022(PARTNER-3b)에서 채권이 **마감 청구서로 묶이면** 예약 직접수납이 `RECEIVABLE_INVOICED`(409)로 **차단**되고, 수납은 반드시 청구서 경로로만 가능하다(이중 인식 방지). 그 결과:

> **여행사·랜드사가 청구서로 결제한 B2B 객실료 매출 전액이 복식부기 LEDGER에서 누락된다.** CASH_VND·REVENUE 잔액이 과소 계상되고, `verifyLedger()`의 교차검증(현금 포지션·매출)이 청구서 수납 파트너에 대해 어긋난다. "지금 우리 현금이 통화별로 얼마인가"라는 ADR-0018의 본래 목적이 B2B 매출만큼 깨진다.

AR 잔액의 진실원천은 `PartnerReceivable`/`PartnerInvoice`(운영 테이블)로 유지하되(LEDGER는 현금주의·A/R 계정 없음, ADR-0018 결정 일관), **청구서로 들어온 실제 현금만 COLLECTION으로 장부에 반영**하는 것이 본 ADR의 범위다.

## 불변식 (위반 시 즉시 실패)

- **이중계상 0**: 한 번 들어온 현금은 LEDGER에 정확히 한 번만 COLLECTION으로 적재. 선금을 예약 경로로 이미 수납(장부 적재)한 뒤 잔금을 청구서로 수납해도 합계가 실제 입금액과 일치.
- **현금주의 유지(ADR-0018)**: 청구서 *발행*은 분개 없음. *수납*(실제 입금) 시점에만 COLLECTION. A/R(미수금) 계정 신설 금지 — 미수 진실원천은 AR 운영테이블.
- **통화별 균형**: COLLECTION은 `CASH_{C} +amount / REVENUE −amount` 통화별 합 0(ADR-0018 §3).
- **멱등**: 같은 수납 이벤트 재처리·재시도가 분개를 중복 생성하지 않음.
- **누수 0(ADR-0018 #4)**: LEDGER·COLLECTION은 ADMIN(canViewFinance) 전용. 공급자·파트너·게스트 비노출.

## 결정 (핵심)

### 통화

마감 청구서(`PartnerInvoice`)는 **VND 표시**(`totalVnd`·`paidVnd` BigInt VND)이고 수납 API는 `amountVnd`만 받는다. 따라서 청구서 COLLECTION은 **VND 단일 통화**:

```
CASH_VND  +amountVnd   (차변, 자산↑)
REVENUE   −amountVnd   (대변, 수익↑)
→ VND 합 0 ✓
```

KRW 직접 입금 추적은 본 ADR 범위 밖(현 청구서가 VND 표시이므로). → **D1**.

### 멱등 키 / 수납 이벤트 식별 — 두 안

현 청구서 수납은 `paidVnd`를 **누적 증분**만 할 뿐 수납 *이벤트당 행(row)*이 없다. COLLECTION은 `paymentId @unique` 1:1 멱등이 필요하므로, 수납 이벤트마다 안정적 식별자가 있어야 한다.

#### 안 A — 기존 `Payment` 모델 재사용 (★ 권장)

근거: **`Payment.invoiceId String?` 필드가 스키마에 이미 존재**한다("마감 청구서 수납 시" 주석). 즉 Payment를 청구서 수납에도 쓰도록 설계는 이미 돼 있고, `recordInvoicePayment`가 그 행 생성을 빠뜨린 것뿐이다.

- 유일한 스키마 변경: `Payment.bookingId`를 **nullable화**(현재 NOT NULL). 청구서는 여러 예약에 걸치므로 단일 bookingId에 못 묶는다. raw SQL `ALTER TABLE "Payment" ALTER COLUMN "bookingId" DROP NOT NULL`(additive·무손상, db push 금지 — [[db-schema-drift-villa-source]]). 무결성은 앱 레벨에서 "bookingId·invoiceId 중 정확히 하나" 보장(+ 선택적 CHECK 제약).
- `recordInvoicePayment`가 `tx.payment.create({ invoiceId, partnerId, currency: VND, amount: amountVnd, vndEquivalent: amountVnd, purpose: BALANCE, receivedAt, bookingId: null })` 생성 → 곧바로 `postCollection(tx, { paymentId: created.id, currency: VND, amount, occurredAt, createdBy })`.
- 멱등·역분개·검증 **전부 기존 기계(postCollection / reverseCollection / verifyLedger) 그대로 재사용**. 신규 분개 타입·신규 LedgerTransaction FK 불필요.
- 부수효과(개선): 현재 청구서 수납은 누적값만 남아 *개별 수납 이력*이 소실되는데, Payment row가 생기면 청구서별 수납 내역·감사추적이 생긴다.

#### 안 B — 신규 `PartnerInvoicePayment` 모델

- 청구서 수납 이벤트 1건 = 1행(id·invoiceId·amountVnd·method·receivedAt·createdBy). COLLECTION 멱등 키로 `LedgerTransaction.invoicePaymentId String? @unique` **신규 FK** 추가.
- 장점: Payment(예약 귀속)와 의미적으로 분리. 단점: 신규 모델 + 신규 LEDGER FK + postCollection 분기 → 변경면 큼. Payment.invoiceId 기존 필드와 중복.

→ **권장 = 안 A.** 기존 필드(`Payment.invoiceId`)가 이미 그 의도를 드러내고, LEDGER 멱등/역분개/검증을 한 줄도 새로 안 짜도 된다. **D4**로 확정.

### 이중계상 방지

- 선금이 예약 경로로 이미 수납(Payment + COLLECTION 적재)된 채권이 이후 청구서로 묶이면, 청구서 `totalVnd`는 **잔금만** 집계(`recordInvoicePayment`/billable 로직: "잔금>0 누적"). 따라서 청구서 COLLECTION은 *새로 들어온 잔금*만 적재 → 선금과 중복 없음.
- 예약 직접수납 엔드포인트는 청구서에 묶인 채권을 이미 `RECEIVABLE_INVOICED`로 차단 → 한 채권의 잔금이 두 경로로 동시에 적재될 수 없음.
- COLLECTION은 **수납 이벤트의 증분 amountVnd**만 적재(누적 paidVnd 총액 아님) → 매 수납이 1회 적재.

### 역분개 (정정)

청구서 수납 오기록 정정 시 해당 Payment 삭제 → `reverseCollection(tx, paymentId)`(기존 함수)로 COLLECTION 제거 + `paidVnd` 차감·상태 재계산. 정정 API 신설 여부는 **D3**.

### 백필

`paidVnd > 0`인 **실거래 청구서**(데모 제외, ADR-0018 #3)는 개별 수납 이벤트 행이 없어 재구성 불가 → 청구서당 현재 `paidVnd` 1건을 단일 Payment(invoiceId, receivedAt=paidAt 또는 issuedAt) + COLLECTION으로 멱등 생성. 멱등 키 = invoiceId 기준 백필 Payment 1건(중복 실행 시 skip). → **D2**.

## 결정 (테오 확정 2026-06-26 — 전부 권장값)

- **D1 통화**: VND 단일. 청구서가 VND 표시 → COLLECTION은 CASH_VND/REVENUE(VND). KRW 직접입금은 범위 밖(후속).
- **D2 백필**: 실거래만(데모 `demo-` 접두 제외). 시점 = `paidAt ?? issuedAt ?? createdAt`. 이중계상 방지 = 이미 Payment row로 적재된 금액을 뺀 부족분만.
- **D3 정정**: 후속. 이번 범위는 적재만. 안전장치로 청구서 연결 Payment(`invoiceId`)는 `DELETE /api/payments/[id]` 차단(409, paidVnd·채권 정합 보호).
- **D4 모델**: 안 A — 기존 `Payment` 재사용(`bookingId` nullable). 신규 모델·LEDGER FK 없음.

## 구현 (완료)

- **S0** 스키마: `Payment.bookingId` → `String?`(+ relation optional). raw ALTER `prisma/migrations-manual/2026-06-26-invoice-payment-ledger.sql`. 파급 측정: `payment.bookingId` 직접 읽는 커밋 코드는 DELETE 감사로그 1곳뿐(안전).
- **S1** `recordInvoicePayment(tx, {…, createdBy})`: `add>0`이면 Payment(VND·invoiceId·partnerId·bookingId 없음) 생성 → `postCollection(paymentId 멱등)`. 동일 트랜잭션. `app/api/partner-invoices/[id]/payments` 가 `createdBy=session.user.id` 전달.
- **S2** `scripts/backfill-invoice-collections.ts`: 실거래 청구서 `paidVnd` 누락분만 합성 Payment(`bf-invpay-{id}`)+COLLECTION 멱등 생성.
- **S3 — 불필요(확인됨)**: `verifyLedger`는 COLLECTION을 통화별 균형으로만 보고 SUPPLIER_PAYABLE만 교차검증 → 청구서 COLLECTION 추가로 깨지지 않음. 변경 0줄.
- **S4** D3 후속(미구현). DELETE 가드만 선반영.
- **검증**: typecheck0 · next build 통과 · vitest 1847 그린(partner-invoice COLLECTION 적재·균형·add=0 미생성 신규 2건 포함).

## 배포 순서

1. 라이브 DB raw ALTER 적용(`2026-06-26-invoice-payment-ledger.sql`) + `prisma generate`.
2. 코드 머지·배포.
3. `npx tsx scripts/backfill-invoice-collections.ts` 백필(멱등, 재실행 안전).

## 대안 (기각)

- **발생주의 + A/R 계정 신설**: 청구서 발행 시 A/R 차변·매출 대변, 수납 시 CASH/A/R. 미수를 장부에서 직접 추적 가능하나 ADR-0018가 현금주의를 확정(선수금·이연 추적비용 과다)했고 AR 운영테이블이 이미 진실원천 → 일관성 위해 기각.
- **현 상태 유지(청구서 수납 장부 미반영)**: B2B 매출·현금이 영구 누락 → ADR-0018 목적 훼손, 기각.

## 결과

브랜치 `wt/ledger-collection`에서 D1~D4 권장값으로 구현 완료(typecheck0·build·1847테스트). 배포 시 위 3단계 순서 준수. D3(청구서 수납 정정 흐름)은 후속.
