# 계약서 — B2C 계약금/잔금 분할 결제 (VND 앵커 다통화)

- 근거: **ADR-0048**(정본) + ADR-0047(통화 3분리). 정책 확정(테오 2026-07-24).
- 상태: **P0·P1 완료** (2026-07-24). P2~P6 순차.
  - P0: 순수 로직 + 테스트 12건. P1: 스키마 라이브 적용 완료(B2cPaymentSchedule·PaymentPurpose B2C값·
    AppSetting 50%/D-14). 백필 대상 0건(기존 예약 전부 VND 앵커 보유 — no-op).
- 담당: 설계·병합=메인, 스키마=TDA, 로직=BE, 정산=FIN, 화면=FE, 검증=QA(작성자와 분리).

## 목표 (한 줄)

한국인·외국인 개인 고객에게 **VND를 앵커로 계약금(50%)/잔금(체크인 D-14) 분할 결제**를 제공하고,
각 결제를 **그 시점 환율로 원화/달러 확정**해 받는다. 우리 VND 마진은 앵커로 보호된다.

## 확정 정책 (테오, 변경 시 이 표 갱신)

| 항목 | 값 | 비고 |
|---|---|---|
| 계약금율 | **50%** | AppSetting `B2C_DEPOSIT_RATE_PCT`(편집가능). 예약별 오버라이드 가능 |
| 잔금 청구 | **체크인 D-14 자동청구** | AppSetting `B2C_BALANCE_LEAD_DAYS`(기본 14). 그 시점 FX로 확정 |
| 임박 예약 | 체크인 **14일 이내 = 100% 선결제**(분할 없음) | 계약금=전액, 잔금=0 |
| 취소·환불 | **낸 통화·낸 금액 그대로 역분개** | 재환산 없음(장부 정합). 부분환불=취소규정 %만큼 |
| USD | **처음부터 지원**(계좌 미운영 → 입금 확인 수동) | `Payment.fxRateToVnd`로 확정·전기 |

## 설계 정합 (ADR-0048 전수 점검 반영 — 절대 위반 금지)

1. **신규 결제 모델 만들지 말 것.** 실수납은 기존 `Payment`(bookingId·currency·amount·**fxRateToVnd**·
   vndEquivalent·purpose·postCollection LEDGER) 재사용. 계약금·잔금 = 각각 `Payment` 1행.
2. **`Payment.purpose` B2C 전용값 신설**(`B2C_DEPOSIT`/`B2C_BALANCE`) — 기존 DEPOSIT/BALANCE(파트너 B2B)와
   섞지 말 것(receivable/ledger 오인 방지).
3. **VND 앵커**: `Booking.totalSaleVnd` 항상 채움. `totalSaleKrw/Usd`는 "제안 예상치(약)"로 강등.
4. **누수 경계**: 결제·환율·마진은 `canViewFinance` 전용. STAFF·공급자·공개(/p)엔 확정/예상 금액만.

## 단계 (Phase)

### P0 — 순수 로직 + 계약서 (이번)
- `lib/b2c-payment.ts`: 스케줄 계산 순수함수(계약금/잔금 VND 분할·D-14 기한·100% 선결제 판정). VND 앵커 보존.
- 유닛 테스트로 고정. AppSetting 키 2종 정의(값은 P1에서 시드).
- **완료기준:** `deposit + balance = total`(반올림 손실 0), 14일 이내=full prepay, 테스트 그린.

### P1 — 스키마 (TDA, additive raw SQL — [[db-is-railway-postgres]])
- 신규 B2C 청구 스케줄(bookingId·totalVnd 앵커·depositDueVnd·balanceDueVnd·depositDueDate·balanceDueDate·status)
  또는 PartnerReceivable의 B2C 확장(택1, TDA 결정).
- `Booking`: `billingCurrency`·`depositRatePct` 추가, `totalSaleVnd` 앵커 필수화(백필 `round(totalSaleKrw × fxVndPerKrw)`).
- `PaymentPurpose`에 `B2C_DEPOSIT`·`B2C_BALANCE` 추가(`ALTER TYPE ... ADD VALUE IF NOT EXISTS`).
- AppSetting 시드: `B2C_DEPOSIT_RATE_PCT=50`, `B2C_BALANCE_LEAD_DAYS=14`.
- SQL은 `prisma/migrations-manual/`에 날짜 접두 보존. 적용 후 `prisma generate`.
- **완료기준:** additive만(파괴 0), 기존 예약 백필로 `totalSaleVnd` 100% 채움, generate 후 typecheck 그린.

### P2 — 불변식 완화 + 33개 소비처 감사 ⚠최대 작업
- `assertSaleAmountColumns` 완화(VND 앵커 항상 + 청구통화 예상). `totalSaleKrw/Vnd/Usd` 읽는 ~33곳 전수 감사:
  revenue-ledger·settlement-finance·statistics·checkout·partner-portal·/p done·availability board 등.
- "총 판매가 ₩X" 표시부 → 확정 결제 합계 또는 "예상(약)"으로 정정. revenue-ledger는 `totalSaleVnd`(앵커) 우선.
- **완료기준:** 33개 소비처 각각 "확정액이냐 예상액이냐" 판정·정정, QA가 매출·정산 수치 회귀 확인.

### P3 — 예약 생성 시 스케줄 + Payment 소진 + LEDGER (BE·FIN)
- 제안/예약 확정 시 스케줄 2줄(계약금/잔금) 생성(또는 100% 1줄). 실입금은 `Payment`(B2C purpose)로 매칭·소진.
- 각 Payment는 자기 `fxRateToVnd`로 VND 환산해 `postCollection`으로 LEDGER 전기.
- **완료기준:** 계약금 입금→스케줄 소진→LEDGER 전기, 잔금 동일. VND 앵커=Σ vndEquivalent 정합(FIN 검증).

### P4 — D-14 자동청구 크론 + 알림 (BE·INTEG)
- 매일 체크인 D-14 도달 예약의 잔금을 **그 시점 FX로 확정**(스케줄 balanceDueVnd → 청구통화 금액 산출) +
  고객 알림(Zalo/Kakao) 발송. 재청구·미납 처리.
- **완료기준:** 크론 멱등, 잔금 원화 확정 스냅샷 저장, 알림 1회 발송, 미납 시 상태 표시.

### P5 — /p 소비자 UX + 공시·동의 (FE·LOC)
- 제안/예약 화면: VND 앵커 + "계약금 ₩Y(확정)" + "잔금 약 ₩Z(D-14 확정)". **잔금 변동 명시 공시.**
- 계약금·잔금·환불 약관을 `policyConsentJson` 확장으로 동의 스냅샷에 포함(취소규정과 별개).
- **완료기준:** 잔금 변동 공시 문구 노출·동의 스냅샷 저장, 5언어, 누수 0(마진·FX 원본 비노출).

### P6 — 취소·환불 (BE·FIN)
- 취소 시 낸 통화·낸 금액 그대로 반환(`Payment` 역분개, `purpose=REFUND` 또는 상태 전이). 취소규정 % 접합.
- **완료기준:** 환불액=낸 금액×취소규정%(재환산 없음), LEDGER 역전기, 장부 정합(FIN 검증).

## ★테오 결정 대기 (코드 전 필요 — P5 착수 전)
- **소비자 약관 문구**: 계약금율·잔금기한·환불통화·**"잔금 원화는 D-14 환율로 확정되어 달라질 수 있음"** 공시.
- 미납 잔금의 취소·위약 처리(홀드 만료 로직과 접합).

## 검증 방법
- 각 Phase: 유닛/통합 테스트 + QA(작성자와 분리) 실사용 검증. 금액은 VND BigInt·부동소수점 금지.
- 릴리스 게이트: 마진·FX 누수 전수감사(공개/공급자/STAFF 경로), 매출·정산 수치 회귀.

## 수정 금지 구역 (다른 세션)
- 이 스프린트는 결제·정산 코어를 건드리므로, 착수 Phase의 파일을 계약서에 명시하고 그 외는 건드리지 않는다.
