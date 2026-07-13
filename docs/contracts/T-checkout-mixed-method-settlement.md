# T-checkout-mixed-method-settlement — 체크아웃 수납 결제수단 혼합(분할) 지원

- 상태: 착수 (2026-07-13)
- 담당: TDA(스키마) + BE + FE, QA 검증
- 배경: 테오 지적 — 체크아웃 정산 실수납이 현금/계좌이체 등 **수단이 섞여** 들어올 수 있는데,
  현재 구조는 수납 금액만 통화별(₫/₩/$) 분할이고 결제수단은 `CheckOutRecord.settlementMethod`
  단일 값이라 "현금 500만₫ + 계좌이체 20만₩" 같은 혼합 수납을 기록할 수 없다.

## 설계 (TDA 결정)

### 스키마 (additive — raw SQL, Railway DB 직접 적용)
- 신규 모델 `CheckoutSettlementLine` — 수납 라인(수단×통화×금액):
  - `id`, `checkOutRecordId` FK(Cascade), `method GuestSettlementMethod`, `currency Currency`(기존 enum 재사용),
    `amount BigInt`(원본 통화 최소단위 정수: VND=동, KRW=원, USD=정수 달러 — 환산 저장 금지), `createdAt`
  - `@@index([checkOutRecordId])`
- `GuestSettlementMethod`에 `MIXED` 추가(`ALTER TYPE ... ADD VALUE IF NOT EXISTS`) —
  레거시 단일 컬럼 표시 호환: 라인 수단이 2종 이상이면 `settlementMethod=MIXED`, 1종이면 그 수단.
- **비정규화 유지**: `settledVnd/settledKrw/settledUsd` = Σ라인(통화별). 기존 표시·감사로그·통계 하위호환.
  기록 경로는 lib/checkout.ts 단일(다른 경로에서 라인 생성 금지).

### API (POST /api/bookings/[id]/checkout)
- `settlement.lines[]` 신규: `{ method: CASH|BANK_TRANSFER|OTHER, currency: VND|KRW|USD, amount: 숫자문자열 }`
  - 검증: 라인 ≤ 12, amount 정수 > 0. (수단, 통화) 중복 라인은 서버가 합산 허용(거부하지 않음)
- **하위호환**: 기존 shape(`method` + `amounts{vnd,krw,usd}`)도 계속 수용 — 서버가 단일 수단 라인들로 변환
- `settlementFx` 스냅샷 로직 불변(실수납 존재 시 서버 조회 동봉)
- 클라가 보낸 `method=MIXED` 직접 지정은 거부(서버 파생 전용)

### FE
- 체크아웃 폼: [수단 라디오 1개 + 통화 3입력] → **수납 라인 rows**([수단][통화][금액], 추가/삭제 버튼)로 교체.
  청구액 대비 환산 합계·잔액 표시는 기존 로직 유지(라인 합산으로 대체)
- 예약 상세: 수납 섹션에 수단별 라인 표시. 라인 금액은 `showFinance` 게이트 안에서만 select/노출.
  `settlementMethods.MIXED` i18n 키 추가(ko/vi)

## 완료 기준 (테스트 가능)
1. 혼합 수납(현금 VND + 이체 KRW) 저장 → 라인 2건 + `settlementMethod=MIXED` + `settledVnd/Krw` 합계 일치
2. 구 payload(`method`+`amounts`) 200 + 라인 변환 저장 (하위호환)
3. amount 0·음수·비정수·13라인↑·`method=MIXED` 직접 지정 → 400
4. 상세 페이지 수단별 라인 표시, `showFinance=false`에서 라인 금액 미노출(select 자체 게이트)
5. lib/checkout.test.ts 단위테스트 + `next build` 통과

## 수정 금지 구역
- `design-audit/`, 루트 `*.png` (다른 세션·사용자 산출물)
- `messages/ko.json`·`vi.json`은 키 추가만
