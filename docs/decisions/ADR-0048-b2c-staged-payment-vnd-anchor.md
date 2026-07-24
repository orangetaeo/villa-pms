# ADR-0048 — B2C 계약금/잔금 분할 + VND 앵커 다통화 결제 (결제 시점 FX)

- 상태: **Accepted (설계 확정)** — 테오 확정 2026-07-24. 구현은 별도 스프린트.
- 관련: ADR-0047(통화 3분리·이 ADR가 Q1 정본), ADR-0022(파트너 선금/잔금 여신), ADR-0027(파트너 인보이스·결제 LEDGER), ADR-0018(복식 LEDGER 현금주의), ADR-0031(소비자 직판가), ADR-0003(결제 통화)
- 메모리: [[proposal-currency-3way-principle]]

## 1. 배경

ADR-0047 최초본은 "한국인 = KRW 완전 고정(오퍼 동결)"이라 했다. 그러나 **계약금(선금)과 잔금이
시차를 두고 나뉘면** 잔금 낼 때 환율이 달라져 KRW 완전 고정이 성립하지 않는다.

테오 교정(2026-07-24): **VND가 진실(앵커)이고, 각 결제 시점에 그 시점 환율로 원화(또는 달러)를 확정한다.**
우리 원가가 VND라, VND를 앵커로 두고 결제 때마다 필요한 원화를 받아야 마진이 지켜진다.

기존 시스템 현황(확인 완료): 한국인 개인 예약은 `Booking`에 단일 통화 총액 + FX 스냅샷 1개뿐이고,
계약금/잔금 분할·결제 시점별 환율 확정이 **없다**. 분할은 파트너(B2B `PartnerReceivable`)에만 있고
그것도 전부 VND(결제 시점 KRW 환산 없음). → **B2C 다통화 분할 결제를 신설한다.**

## 2. 핵심 결정

1. **객실료의 진실 = VND 총액.** `Booking.totalSaleVnd`를 **앵커로 항상 저장**(KRW/USD 청구여도).
2. **결제는 이벤트별로 통화·금액·FX를 각자 확정**한다: `DEPOSIT`(계약금) → `BALANCE`(잔금).
3. **계약금 원화** = 계약금 VND 몫 × 계약금 시점 FX. 홀드 창(24~48h)이 짧아 **제안/청구 시 확정**해 받는다.
4. **잔금 원화** = (총VND − 계약금VND) × **잔금 청구 시점 FX**(다를 수 있음). 그때 확정.
5. 합산 = 전체 VND를 블렌디드 FX로 회수 → **우리 VND 마진 보호**(환리스크는 고객의 원화 총액 변동으로).
6. USD도 동일: **VND 앵커**, 달러는 결제 시점 FX로 확정(USD 계좌 미운영 이슈는 별개, 현행 수동).

## 3. 데이터 모델 (additive, 라이브는 raw SQL — [[db-is-railway-postgres]])

**Booking (기존 확장):**
| 컬럼 | 의미 |
|---|---|
| `totalSaleVnd` | **앵커로 필수화**(NOT NULL 지향). 기존 KRW 예약 백필 = `round(totalSaleKrw × fxVndPerKrw)` |
| `billingCurrency` | 고객이 입금하는 통화(KRW/VND/USD) = 어느 계좌인가 |
| `depositRatePct` | 계약금율(**기본 50**, §8-1 AppSetting `B2C_DEPOSIT_RATE_PCT`에서 해석) — 예약별 오버라이드 가능 |

`totalSaleKrw`/`totalSaleUsd`는 **"제안 시점 예상치(약)"로 재정의**(확정액 아님) 또는 폐지하고
확정액은 아래 `BookingPayment`로 이관한다(마이그레이션 §5).

**신규 `BookingPayment` (결제 이벤트 1건 = 1행):**
| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` / `bookingId` | | 예약 귀속 |
| `kind` | enum DEPOSIT·BALANCE·ADDITIONAL | 계약금·잔금·추가 |
| `amountVnd` | BigInt | **이 결제가 정산하는 VND 몫 = 앵커** |
| `billingCurrency` | Currency | 이 결제의 청구 통화 |
| `amountBilled` | BigInt/Int | 청구통화 실금액(원=Int, 동=BigInt, $=Int) — **결제 시점 확정값** |
| `fxVndPerBilling` | Decimal(14,4) | **이 결제의 FX 스냅샷**(1 청구단위 = x VND). VND 청구면 1 |
| `status` | enum DUE·PAID·CANCELLED | |
| `dueAt` / `paidAt` | DateTime? | 청구·확정 시각 |
| `note` | String? | |

**불변식:** `Σ amountVnd(취소 제외) = Booking.totalSaleVnd`(앵커 보존). PartnerReceivable/Payment
(ADR-0022/0027) 패턴 재사용하되 **다통화·B2C**. DEPOSIT은 예약당 1건 권장, BALANCE는 분납 허용(ADDITIONAL).

## 4. 결제통화 불변식 개정 (ADR-0047 §6 assertSaleAmountColumns)

- 기존: 청구통화 1컬럼만 채움(듀얼컬럼 방지).
- **개정: VND는 앵커라 항상 채움 + 청구통화 실금액은 `BookingPayment.amountBilled`에.** `Booking`의
  단일 통화 총액 불변식은 "제안 예상치"로 완화되고, **확정 금액의 원천은 결제 레코드**로 이동한다.
- `Proposal`(제안 단계)은 아직 결제 전이라 종전대로 견적 스냅샷 유지(청구통화 예상 총액 + `fxVndPerKrw`).

## 5. 마이그레이션 전략 (무중단)

1. `BookingPayment` 테이블 + Booking 신규 컬럼 additive 추가(구코드 무참조).
2. 기존 예약 백필: `totalSaleVnd` 없으면 `totalSaleKrw × fxVndPerKrw`로 앵커 채움. 과거 확정 입금은
   단일 `BookingPayment(kind=BALANCE, status=PAID, amountBilled=기존총액, fxVndPerBilling=fxVndPerKrw)`로 이관.
3. 신규 예약부터 계약금/잔금 2행 생성. `prisma generate` 후 소비처 전환.

## 6. /p 표시 (ADR-0047 §5 정합)

- **제안 단계:** VND 총액(앵커) + **"계약금 ₩Y (확정, 24h 내 입금)"** + **"잔금 약 ₩Z (잔금 청구 시 그날
  환율로 확정)"**. (KRW 청구라도 잔금은 "약" — ADR-0047 개정과 일치.)
- **계약금 입금 후:** 계약금 확정 표기, 잔금은 청구 때 확정.
- 마진·원가·소비자가·Net·FX 원본은 운영자 전용(원칙2). 공개엔 확정/예상 금액만.

## 7. 정산 (LEDGER, ADR-0018)

각 `BookingPayment` PAID → **LEDGER에 VND로 전기**(자기 `fxVndPerBilling`로 환산). 다통화·다시점 입금을
VND 기준으로 합산 → 매출·마진·정산 전부 VND 단일 기준(현금주의 유지). 공급자 정산은 VND 그대로.

## 8. 확정 정책 (테오 2026-07-24)

업계 벤치마킹(B2C 빌라/휴양지 렌탈: 계약금 30~50%, 잔금 도착 14~90일 전, 임박예약 100% 선결제)을
근거로, 푸꾸옥 한국인 여행객(짧은 리드타임)에 맞춰 확정:

1. **계약금율 = 50%** (기본값). **편집 가능한 AppSetting**으로 신설(예: `B2C_DEPOSIT_RATE_PCT=50`) —
   배포 없이 운영자가 조정. (B2B 파트너 30%와 별개. 빌라·시즌별 오버라이드는 후속.)
2. **잔금 청구 = 체크인 D-14 자동 청구.** 그 시점 환율로 잔금 원화/달러 확정(FX 확정 트리거).
   **예약이 체크인 14일 이내면 분할 없이 100% 선결제**(계약금=전액).
3. **취소·환불 = "낸 통화·낸 금액 그대로 반환".** 각 `BookingPayment`의 `amountBilled`(낸 실금액)를 그
   통화로 반환, LEDGER는 그 결제의 VND 전기를 **역분개**(재환산 없음 → 장부 정합). 부분환불=낸 금액의
   취소규정 %만큼(§7). 신규 결제행 `kind=REFUND`(음수 amountVnd) 또는 원 결제행 status=REFUNDED 처리.
4. **USD 처음부터 포함.** VND 앵커·결제 시점 FX 모델을 KRW/VND/USD 동일 적용. 단 **USD는 전용 계좌
   미운영이라 입금 확인이 수동**(운영자가 USD 입금 기록) — `fxVndPerBilling`(1 USD = x VND)로 확정·전기.

## 9. 잔여 (구현 스프린트에서 다룸)

- D-14 자동 청구 크론 + 고객 알림(Zalo/Kakao) 문구·재청구·연체 처리.
- 계약금 미납 시 홀드 만료·취소 연동(기존 hold 만료 로직과 정합).
- 취소규정(CANCELLATION_POLICY) 단계별 환불율과 §8-3 반환 로직 접합.

## 10. 범위

- **이번:** 설계·정책 확정(이 ADR). 원칙·모델·스키마 골격 + §8 정책 4종.
- **다음 스프린트:** 계약 초안(docs/contracts) → BE(스키마·결제 API·D-14 크론·LEDGER)·FE(/p·확정 UX)·FIN(정산 검증) 구현.
