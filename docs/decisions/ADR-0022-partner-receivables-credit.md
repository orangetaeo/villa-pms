# ADR-0022 — 여행사·랜드사(B2B) 결제조건·미수(여신) 관리

- 상태: **Proposed** (테오 정책 4건 확정 2026-06-26 → 구현 합의 대기)
- 일자: 2026-06-26
- 관련: ADR-0003(채널별 결제통화 — TRAVEL_AGENCY·LAND_AGENCY→VND), ADR-0018(복식부기 LEDGER), ADR-0019(게스트 체크아웃 통합정산), [[settlement-finance-status]]
- 참조 패턴: `reference/exchange/` LEDGER, lib/settlement.ts(월 집계 생애주기), lib/hold.ts(예약 게이트)

## 배경 / 문제

여행사·랜드사를 통해 온 손님은 **숙박료를 본인이 내지 않는다** — 여행사/랜드사가 우리에게 객실료를 지급한다. 그런데 현재 시스템은 여행사/랜드사를 **`BookingChannel` enum + `Booking.agencyName` 텍스트로만** 다룬다. 정식 파트너 엔티티·결제조건·미수 추적·청구서가 **전혀 없다.** 정산(Settlement)·LEDGER는 **공급자↔우리(지급/AP)** 쪽만 있고, **여행사↔우리(수금/AR)** 쪽이 비어 있다.

여행사/랜드사는 **주/15일/30일 마감 정산(여신)**을 요구하는 경우가 많고, 특히 랜드사는 **미수를 남기고 도망(default)**하는 사고가 잦다. 통제 장치 없이 외상을 허용하면 손실이 직접 발생한다.

→ 누락된 **매출채권(AR) + 여신관리** 모듈을 신설한다. 핵심은 "우리 표준 결제정책을 등급으로 고정"하고 "시스템이 미수를 강제로 통제"하는 것.

## 핵심 원칙: 돈의 흐름 2분리 (절대 위반 금지)

| 흐름 | 주체 | 내용 | 결제 시점 | 미수 위험 | 관할 |
|---|---|---|---|---|---|
| **① 숙박료 (B2B)** | 여행사/랜드사 ↔ 우리 | 순수 객실료 | 선금+잔금(등급 A) / 주·15·30일 마감(등급 B) | **있음 ← 본 ADR** | PartnerReceivable / PartnerInvoice |
| **② 현장 청구 (B2C)** | 게스트 ↔ 우리 | 보증금·미니바·부가서비스 | 게스트가 체크아웃 시 직접 | 없음(현장수납) | ADR-0019 (CheckOutRecord) |

> 여행사 손님이라도 **보증금·미니바·부가서비스는 손님 본인이 현장에서 직접 지급**(기존 `/g/[token]` 흐름 그대로). 여행사가 내는 건 **객실료뿐**. 두 흐름의 금액·장부·화면을 절대 섞지 않는다.

## 결정 (테오 확정 2026-06-26)

### 0. 정책 4건
1. **신규 파트너 기본 = 등급 A 의무(선불)**. 거래 실적·신뢰가 쌓이면 ADMIN이 등급 B로 승격. 미수 위험을 처음부터 0으로.
2. **선금 기준 = 객실료의 30%**. 등급 B 외상에서도 **최소 30% 선수금 필수**(전액 외상 금지) → 도망 시에도 30%까지 회수. (`Partner.depositRatePct` 기본 30, 파트너별 상향 가능)
3. **Phase 1 = ADMIN 전담**. 파트너 셀프 포털 없음. 운영자가 모든 미수·청구를 관리, 청구서는 Zalo/PDF로 발송. 포털은 Phase 2.
4. **보증예치금(Guarantee) 미도입**. 미수 통제는 **신용한도 + 선금 30%**만으로. (회수력 = 선금 한도까지)

### 1. 회사 표준 결제정책 — 등급제

| 등급 | 대상 | 조건 | 여신 | 미수 위험 |
|---|---|---|---|---|
| **A — 선불** | 신규·미검증 파트너(기본) | 예약 시 선금 30% → CONFIRMED, **체크인 전 잔금 100%** 입금. 미입금 시 체크인 차단·예약 해제 | 없음 | **0** |
| **B — 단기여신** | 검증된 파트너(ADMIN 승격) | 주/15일/30일 마감. **선금 30% 필수** + **신용한도 내**에서만 | 한도 내 | 한도까지 |
| **C — 특별계약** | 대형 파트너 개별 | 개별 계약(기록만) | 협의 | 협의 |

영업은 "선불이냐 마감이냐"를 매번 고민하지 않고 **"어느 등급으로 모실지"만 협상**한다.

### 2. 미수·도망 방지 통제 (시스템 강제)

1. **파트너별 신용한도(`creditLimitVnd`)** — 미수 잔액(선금 제외 외상분)이 한도 도달 시 **신규 가예약/확정 자동 차단**(lib/hold.ts·확정 게이트에 통합).
2. **선금 30% 의무** — 등급 B도 예약 확정 전 선금 수납 없으면 CONFIRMED 불가(전액 외상 차단).
3. **여신 Aging 대시보드** — 파트너별 미수 연령(0–7 / 8–15 / 16–30 / 30일+) + 연체·한도초과 경보.
4. **연체 자동 제재** — `dueDate` 경과 미수 발생 시 ①신규 예약 차단 ②Zalo 알림 ③등급 강등 후보 플래그.
5. **체크인 게이트** — 등급 A는 잔금 미입금이면 체크인 화면 차단(검수 게이트 패턴 재사용, ADR-0006).

### 3. 데이터 모델 (additive — 라이브 DB raw SQL ALTER, `db push` 금지 — [[db-schema-drift-villa-source]])

```prisma
enum PartnerType   { TRAVEL_AGENCY LAND_AGENCY }          // BookingChannel과 정합
enum CreditTier     { A B C }                              // A=선불, B=단기여신, C=특별
enum PartnerStatus  { ACTIVE SUSPENDED BLOCKED }           // BLOCKED=신규예약 전면차단
enum ReceivableStatus { PENDING PARTIAL PAID OVERDUE WRITTEN_OFF }
enum PartnerInvoiceStatus { DRAFT ISSUED PARTIAL PAID OVERDUE VOID }
enum PaymentPurpose { GUEST DEPOSIT BALANCE INVOICE }      // 기존 고객입금=GUEST

model Partner {                          // 여행사·랜드사 정식 엔티티 (enum+text 승격)
  id              String   @id @default(cuid())
  type            PartnerType
  name            String                 // 표시명
  nameVi          String?                // 베트남어 병기 ([[villa-name-bilingual]] 정합)
  contactPhone    String?
  contactZaloUid  String?                // Zalo 알림 발송 대상
  contactEmail    String?
  creditTier      CreditTier   @default(A)
  creditLimitVnd  BigInt       @default(0)   // 등급 B 외상 한도(0=여신없음)
  depositRatePct  Int          @default(30)  // 선금율(%) — 정책 기본 30
  paymentTermDays Int          @default(0)   // 마감 후 지급기한(0=선불, 7/15/30)
  billingCycle    String?                    // "WEEKLY"|"BIWEEKLY"|"MONTHLY"|null(선불)
  status          PartnerStatus @default(ACTIVE)
  contractUrl     String?                    // 계약서 스캔(비공개 파이프라인)
  memo            String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  bookings        Booking[]
  receivables     PartnerReceivable[]
  invoices        PartnerInvoice[]
}

model PartnerReceivable {                // 예약 1건의 객실료 채권 (B2B 숙박료)
  id               String   @id @default(cuid())
  partnerId        String
  partner          Partner  @relation(fields: [partnerId], references: [id])
  bookingId        String   @unique
  booking          Booking  @relation(fields: [bookingId], references: [id])
  totalVnd         BigInt                  // 객실료 총액(= Booking.totalSaleVnd 스냅샷)
  depositDueVnd    BigInt                  // = total * depositRatePct
  depositPaidVnd   BigInt   @default(0)
  balancePaidVnd   BigInt   @default(0)
  dueDate          DateTime @db.Date       // 잔금 기한(등급A=체크인일, B=마감+termDays)
  status           ReceivableStatus @default(PENDING)
  invoiceId        String?                 // 등급B 마감청구서에 묶이면 연결
  invoice          PartnerInvoice? @relation(fields: [invoiceId], references: [id])
  createdAt        DateTime @default(now())
  @@index([partnerId, status])
  @@index([dueDate, status])
}

model PartnerInvoice {                   // 등급B 주/15/30일 마감 청구서 (receivable 묶음)
  id           String   @id @default(cuid())
  partnerId    String
  partner      Partner  @relation(fields: [partnerId], references: [id])
  periodStart  DateTime @db.Date
  periodEnd    DateTime @db.Date
  dueDate      DateTime @db.Date          // periodEnd + paymentTermDays
  totalVnd     BigInt
  paidVnd      BigInt   @default(0)
  status       PartnerInvoiceStatus @default(DRAFT)
  statementUrl String?                    // 청구서 PDF(vi) — react-pdf, Settlement PDF 패턴 재사용
  issuedAt     DateTime?
  paidAt       DateTime?
  receivables  PartnerReceivable[]
  createdAt    DateTime @default(now())
  @@unique([partnerId, periodStart, periodEnd])
}
```

**기존 모델 확장:**
- `Booking.partnerId String?` + relation 추가 (`agencyName` 텍스트는 마이그레이션 후에도 폴백 유지 → dual-read).
- `Payment` 확장: `partnerId String?`, `receivableId String?`, `invoiceId String?`, `purpose PaymentPurpose @default(GUEST)`. 기존 고객 입금은 `GUEST`.

### 4. LEDGER 처리 — **현금주의 유지(ADR-0018 정합)**

ADR-0018은 **REVENUE = 현금주의(수납 시 인식)**로 확정했다. B2B 외상도 이를 유지한다:

- **PartnerReceivable / PartnerInvoice = AR 운영 추적의 진실원천**(미수 잔액·Aging·한도판정). 형식 장부(LEDGER) 밖.
- 파트너 입금(선금·잔금·청구서 수납)이 실제 들어올 때 **기존 COLLECTION 분개**(`CASH_VND +amount / REVENUE −amount`) 생성 — Payment.purpose∈{DEPOSIT,BALANCE,INVOICE}도 COLLECTION으로 처리(통화 VND).
- 공급자 원가·채무(COGS/SUPPLIER_PAYABLE) 적립은 ADR-0018대로 **Settlement COLLECT 시점**(파트너 입금 여부와 독립 — 우리는 공급자에게 갚을 의무가 있음).
- **대손(write-off)**: `ReceivableStatus.WRITTEN_OFF`로 운영 처리. 형식 LEDGER 대손 분개(`BAD_DEBT`)는 Phase 2(발생 빈도·규모 보고 후 도입).

> 발생주의 AR 분개(예약 확정 시 REVENUE/AR_PARTNER 인식)는 ADR-0018과 동일 사유(선수금·이연매출 추적비용 과다)로 **기각**. AR은 운영 테이블로 충분.

### 5. 정책 헬퍼 (lib/partner.ts — 단일 소스)
- `computeDepositDue(totalVnd, depositRatePct)` — 선금액 산출(BigInt, 올림).
- `computeDueDate(tier, checkInDate, periodEnd, termDays)` — 잔금/청구 기한.
- `outstandingForPartner(receivables)` — 미수 잔액(선금 제외 외상분) 집계.
- `canCreateBookingFor(partner, currentOutstanding, addVnd)` — 신용한도·status 게이트(여신 초과/BLOCKED/연체 차단). lib/hold.ts·확정 API에서 호출.
- `agingBuckets(receivables, asOf)` — 0-7/8-15/16-30/30+ 분류.

## 화면 (Phase 1 — ADMIN 전담)

| 화면 | 경로 | 내용 |
|---|---|---|
| 파트너 관리 | `/partners` | 목록(등급·미수·한도·status 배지), 신규 등록 |
| 파트너 상세 | `/partners/[id]` | 신용정보 편집, 미수 현황, 예약 이력, 입금 이력, Aging |
| 미수/여신 대시보드 | `/receivables` | 전체 파트너 미수 Aging, 연체·한도초과 경보 |
| 마감 청구서 | `/partners/[id]/invoices` (또는 `/invoices`) | 주/15/30일 청구서 생성·발행·수납 기록·PDF·Zalo 발송 |
| (수정) 예약 확정 | 기존 `/bookings/[id]` | 채널=파트너면 선금/잔금·신용한도 체크 통합, 입금 기록 |
| (수정) 체크인 게이트 | 기존 `/bookings/[id]/checkin` | 등급 A 잔금 미입금 시 차단 |

> 누수 가드: 파트너 관련 금액(미수·신용한도·청구서)은 전부 **ADMIN(canViewFinance) 전용**. 공급자·게스트·공개 라우트 절대 비노출 — [[admin-statistics-status]] leak-checklist 적용.

## 구현 단계 (스프린트)

- **PARTNER-1 (토대, TDA/BE)**: 스키마 raw ALTER(Partner·PartnerReceivable·PartnerInvoice·enum 6종, Booking·Payment 확장) + generate, lib/partner.ts 정책 헬퍼 + 단위테스트, Booking↔Partner dual-read.
- **PARTNER-2 (운영화면, FE/BE)**: `/partners`·`/partners/[id]` 파트너 관리, 예약 확정 흐름에 선금/잔금·신용한도 게이트 통합, Payment.purpose 입금 기록, 체크인 게이트(등급 A).
- **PARTNER-3 (미수·청구, FE/BE/INTEG)**: `/receivables` Aging 대시보드 + 경보, PartnerInvoice 마감 청구서(주/15/30일) 생성·PDF(vi)·Zalo 발송, 연체 자동 제재 cron(신규예약 차단·알림).
- **PARTNER-4 (선택, Phase 2)**: 파트너 셀프 포털(토큰 링크 또는 B2B 로그인) — IDEAS.

## 대안 (기각)
- **현행 유지(enum+text, ADMIN 수기)**: 미수 추적·한도 통제 불가 → 도망 손실 직접 노출. 기각.
- **발생주의 AR 분개**: ADR-0018 현금주의 결정과 충돌, 추적비용 과다. 기각(운영 테이블로 대체).
- **보증예치금 도입**: 영업 진입장벽 → 테오 미도입 결정.
- **파트너 포털 즉시 구축**: 범위 과다, 출시 지연 → Phase 1 ADMIN 전담으로 축소.

## 결과
Phase 1 = PARTNER-1~3. 스키마는 1세션 전담 원칙(TDA). 구현 전 docs/contracts/PARTNER-1.md QA 합의 필요.
