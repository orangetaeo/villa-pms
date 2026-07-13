# ADR-0039 — 체크아웃 수납 결제수단 혼합(수단×통화 라인 원장)

- 날짜: 2026-07-13
- 상태: 승인 (TDA)
- 관련: ADR-0019 S4(게스트 통합정산), 2026-07-10 다통화 분할(settledVnd/Krw/Usd), 계약서 T-checkout-mixed-method-settlement

## 문제

체크아웃 게스트 정산(미니바+확정 부가옵션) 실수납은 현장에서 **현금/계좌이체가 섞여** 들어온다
(예: 현금 500만₫ + 계좌이체 20만₩). 기존 구조는 수납 **금액**만 통화별(₫/₩/$) 분할이고
**결제수단은 `CheckOutRecord.settlementMethod` 단일 enum**이라 혼합 수납을 사실대로 기록할 수 없다.
현금 시재·계좌 대사 각각을 맞추려면 수단별 금액이 필요하다.

## 결정

1. **수납 라인 원장 신설** — `CheckoutSettlementLine { checkOutRecordId, method: GuestSettlementMethod, currency: Currency, amount: BigInt }`.
   amount는 원본 통화 최소단위 정수(VND=동, KRW=원, USD=정수 달러) — 환산 저장 금지(기존 원칙 유지).
2. **비정규화 캐시 유지** — `settledVnd/settledKrw/settledUsd` = Σ라인(통화별). 기존 표시·감사·통계 하위호환.
   기록 경로는 `lib/checkout.ts completeCheckout` 단일 — 다른 경로에서 라인 생성 금지.
3. **`GuestSettlementMethod`에 `MIXED` 추가** — 라인의 수단이 2종 이상이면 `settlementMethod=MIXED`(1종이면 그 수단).
   MIXED는 **서버 파생 전용**: API가 클라의 MIXED 직접 지정을 거부(zod enum에서 제외).
4. **API 하위호환** — 구 shape(`settlement.method`+`amounts`)는 단일 수단 라인으로 서버 변환.
   금액 없이 수단만 기록하는 기존 동작도 보존. 신규 FE는 `settlement.lines[]`만 전송.
5. (method, currency) 중복 라인은 거부하지 않고 서버가 합산 병합(입력 관대, 저장 정규화).

## 대안 검토

- **통화별 수단 컬럼 3개**(settledVndMethod 등): 같은 통화를 두 수단으로 나눠 받는 경우(₫ 현금+이체) 표현 불가 — 기각.
- **수단 다중선택만 기록(금액 없이)**: 어느 수단으로 얼마인지 없으면 시재·대사 불가 — 기각.

## 마이그레이션

`prisma/migrations-manual/2026-07-13-checkout-settlement-lines.sql` — additive
(CREATE TABLE IF NOT EXISTS + `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'MIXED'`). Railway DB 적용 완료(2026-07-13).
구 레코드는 라인 없음 — 표시부는 라인 없으면 기존 settled* 폴백.
