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

`totalSaleKrw`/`totalSaleUsd`는 **"제안 시점 예상치(약)"로 재정의**(확정액 아님). 확정액은 실수납 `Payment`로.

> **★설계 교정 (2026-07-24 전수 점검):** 최초본은 신규 `BookingPayment` 모델을 제안했으나, **기존
> `Payment` 모델이 이미 결제별 다통화·결제 시점 FX·LEDGER 전기를 갖고 있다** — 재발명 금지. 아래 2개로 분리:

**(a) 실수납 = 기존 `Payment` 재사용 (신규 모델 금지).** `Payment`는 이미 보유:
`bookingId`·`currency`·`amount`·**`fxRateToVnd`(수납 시점 환율=결제 시점 FX 확정)**·`vndEquivalent`(VND
앵커 환산)·`purpose`(GUEST/DEPOSIT/BALANCE)·`method`·`receivedAt` + `postCollection`으로 LEDGER 전기.
→ **"각 결제 시점 환율로 확정"은 이미 네이티브 지원.** 계약금·잔금은 각각 `Payment` 1행(자기 `fxRateToVnd`).
⚠ **`purpose` 스코프 분리 필요:** 현재 `DEPOSIT`/`BALANCE`는 **파트너(B2B) 전용 의미** — B2C에 그대로 쓰면
receivable/ledger 로직이 파트너로 오인. **B2C 전용 purpose 값 신설**(예: `B2C_DEPOSIT`/`B2C_BALANCE`).

**(b) 진짜 갭 = B2C 청구 스케줄 (신규).** `Payment`는 "받은 기록"이지 "받을 예정"이 아니다. B2B는
`PartnerReceivable`(depositDueVnd·balancePaidVnd·dueDate)이 스케줄을 담당하나 **B2C엔 없다.** 신규 경량
스케줄(또는 PartnerReceivable의 B2C 확장): `bookingId`·`totalVnd`(앵커)·`depositDueVnd`·`balanceDueVnd`·
`depositDueDate`·`balanceDueDate`(=체크인 D-14)·`status`. 실입금은 (a) `Payment`로 매칭 소진.

**불변식:** `Σ Payment.vndEquivalent(B2C purpose, 취소 제외) → 스케줄 소진`, 스케줄 `depositDueVnd +
balanceDueVnd = Booking.totalSaleVnd`(앵커 보존).

## 4. 결제통화 불변식 개정 (ADR-0047 §6 assertSaleAmountColumns) — ⚠큰 블라스트 라디우스

- 기존: 청구통화 1컬럼만 채움(듀얼컬럼 방지). **4개 write 경로**(admin-booking·hold·booking-extend·
  booking-modify)가 `assertSaleAmountColumns`로 강제.
- **개정: VND는 앵커라 항상 채움 + 청구통화 실금액(확정)은 실수납 `Payment`로.** `Booking.totalSaleKrw/Usd`는
  "제안 예상치"로 완화.
- ⚠ **`totalSaleKrw/Vnd/Usd`를 읽는 소비처가 ~33곳**(revenue-ledger·settlement-finance·statistics·checkout·
  partner-portal·/p done·availability board 등). 특히 "총 판매가 ₩X" 표시부는 이제 **예상(약)** 이 되어야 함.
  → **불변식 완화 + 33개 소비처 감사가 이 스프린트의 최대 작업.** 백엔드 단독으로 끝나지 않음(표시부 포함).
- revenue-ledger는 VND 앵커(`totalSaleVnd`)를 항상 읽으면 통합환산매출이 **오히려 안정화**(현금주의 LEDGER와
  발생주의 뷰 둘 다 VND 기준). KRW/USD 원본 컬럼 읽는 표시부만 "약"으로 조정.

## 5. 마이그레이션 전략 (무중단)

1. B2C 청구 스케줄 테이블(§3-b) + Booking 신규 컬럼(billingCurrency·depositRatePct·totalSaleVnd 앵커)
   additive 추가(구코드 무참조). **신규 `Payment.purpose` 값(B2C_DEPOSIT/B2C_BALANCE)** 추가.
2. 기존 예약 백필: `totalSaleVnd` 없으면 `round(totalSaleKrw × fxVndPerKrw)`로 앵커 채움. 과거 확정분은
   그대로(단일 확정 = 계약금 없이 전액 수납한 것으로 간주, 스케줄 소급 생성 불필요).
3. 신규 예약부터 스케줄(계약금/잔금 2줄) 생성 + `Payment`로 소진. `prisma generate` 후 소비처 감사·전환.

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

## 11. 설계 검증 결과 (전수 점검 2026-07-24)

- ✅ **결제별 다통화·결제 시점 FX·LEDGER 전기 = 이미 있음**(`Payment.fxRateToVnd`·`postCollection`). 새
  모델 금지, 재사용(§3-a). 취소환불 "낸 통화 그대로"도 `Payment` 역분개로 깔끔(§8-3).
- ✅ **누수 경계 정합**: payments 라우트가 `canViewFinance` 전용 → STAFF는 결제·환율·마진 비노출(ADR-0013 §6.1).
- 🔴 **최대 작업 = §4** `assertSaleAmountColumns` 완화 + `totalSale*` 33개 소비처 감사(표시부 포함).
- 🔴 **`purpose` 스코프**: DEPOSIT/BALANCE는 B2B 전용 의미 → B2C 값 신설(§3-a).
- 🟡 **잔여 환리스크(운영자 정책)**: "VND 앵커=마진 보호"는 **받은 원화를 즉시 VND 환전할 때만** 완전 성립.
  원화를 보유하는 동안의 환차손익은 잔존 → 즉시환전 원칙 또는 마진 버퍼로 흡수(FIN 후속).
- 🟡 **잔금 원화 변동 공시(소비자 정책)**: 제안·동의 시 **"잔금은 D-14 환율로 확정되어 달라질 수 있음"**
  명시 필수. 취소·계약금·잔금·환불 조항을 **B2C 소비자 약관 + 동의 스냅샷(policyConsentJson 확장)**에 포함.
  현재는 취소규정(CANCELLATION_POLICY) 동의만 있어 계약금/잔금 약관이 없다 → 신설 필요.
- 🟡 **계약금 50%는 시장 상단**(B2C 통상 30%). 현금흐름 유리·전환율 저하 트레이드오프 — AppSetting이라 조정 가능.
