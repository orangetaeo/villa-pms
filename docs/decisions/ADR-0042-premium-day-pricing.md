# ADR-0042 — 프리미엄일(요일·공휴일) 2단 요금

<!-- ⚠ ADR 번호는 병합 직전 main의 docs/decisions/ 최신 번호를 재확인할 것 (0039 충돌 재번호 사례). 작성 시점 main 최신 = 0041. -->

- 날짜: 2026-07-13
- 상태: 승인 (TDA)
- 관련: ADR-0014/0015(기간별 요금 단일 소스), ADR-0031(소비자 직판가 2단계), ADR-0021 §7(공급자 자기 판매가), 계약서 premium-day-pricing

## 문제

성수기 기간 안에서도 주말(금·토)·공휴일 밤에 웃돈을 받는 빌라가 있다. 현행 VillaRatePeriod는
기간(날짜 범위)당 단일 가격이라 표현 불가. "프리미엄 전용 겹침 기간 행 + 금액 큰 쪽 승리" 안은
가격 필드가 다축(원가/Net/소비자가 × VND/KRW)이라 **승자 정의가 불가**(원가는 A행이 크고 소비자가는
B행이 큰 경우 비결정적) → 기각(사용자 합의 완료).

## 결정

### 1. 박별 프리미엄 판정 (요일 ∨ 공휴일)

```
프리미엄 박 = (getUTCDay(박 날짜) ∈ Villa.premiumDays) ∨ (박 날짜 ∈ HolidayDate)
```

- `Villa.premiumDays Int[] @default([5,6])` — 0=일…6=토. 숙박일이 `@db.Date`(UTC 자정)이므로
  요일 판정은 반드시 `getUTCDay()`(로컬 타임존 오염 금지). 빈 배열 허용(공휴일만 프리미엄).
- `HolidayDate` — **전역** 날짜 목록(한국·베트남 공용, 빌라 무관). `date @db.Date @unique`, label, createdAt.
  전야 자동계산 없음 — 전야도 웃돈이면 운영자가 그 날짜를 명시 입력. ADMIN CUD 전용 + AuditLog 필수.
- 판정과 가격의 분리: HolidayDate·premiumDays는 "어느 박이 프리미엄인가"만 답한다. 얼마인가는
  그 박이 속한 VillaRatePeriod 행의 premium* 컬럼이 답한다.

### 2. 가격 = 기간 행 내부의 premium* 컬럼 (전부 nullable, 컬럼 단위 평일 폴백)

VillaRatePeriod에 additive 추가 (기존 6개 가격 축과 1:1 대응):

| 신규 컬럼 | 타입 | null일 때 폴백 (같은 행) |
|---|---|---|
| premiumSupplierCostVnd | BigInt? | supplierCostVnd |
| premiumSalePriceVnd | BigInt? | salePriceVnd |
| premiumSalePriceKrw | Int? | salePriceKrw |
| premiumConsumerSalePriceVnd | BigInt? | consumerSalePriceVnd |
| premiumConsumerSalePriceKrw | Int? | consumerSalePriceKrw |
| premiumSupplierSalePriceVnd | BigInt? | supplierSalePriceVnd |

- **폴백은 컬럼 단위**(행 단위 아님): 프리미엄 박에서 각 컬럼이 독립적으로
  `premiumX ?? X`로 해소된 "유효 행"을 만든 뒤, **기존 계층 로직(ADR-0031: CONSUMER = consumer ?? Net)을
  그 유효 행 위에서 그대로 적용**한다. 축 우선순위(프리미엄 vs 계층)를 새로 발명하지 않음 —
  프리미엄은 컬럼 오버라이드, 계층은 기존 규칙. 예: premiumConsumer=null·consumer=13만·premiumNet=11만
  → DIRECT 소비자는 13만(프리미엄 Net으로 내려가 평일 소비자가보다 싸지는 역전 방지),
  consumer 자체가 미설정이면 premiumNet 11만(정상 폴백).
- 전 컬럼 null(기존 전 빌라) → 모든 박이 평일가 → **견적 결과 완전 불변(무중단)**. premiumDays
  default가 [5,6]이어도 가격 컬럼이 null이라 무해.
- 공급자 자기 판매가 경로(ADR-0021 §7)도 동일 규칙: `premiumSupplierSalePriceVnd ?? supplierSalePriceVnd`,
  그 결과가 null이면 기존 MissingSupplierPriceError.

### 3. 프리미엄 전용 마진 컬럼은 두지 않는다 (쟁점 판단)

premiumMarginType/premiumMarginValue(및 premiumConsumerMargin*)를 **추가하지 않음**. 근거:

1. **견적 엔진은 마진 컬럼을 읽지 않는다** — quoteStayByPeriod의 판정 원천은 판매가 컬럼뿐이고,
   margin*은 UI 제안값·원가경보용 메타데이터다. 프리미엄도 동일하게 판매가 컬럼이 정본.
2. **행당 마진 정책 1개 유지** — 프리미엄은 consumer*처럼 "다른 마진 축(Net 위의 마크업)"이 아니라
   **같은 마진 축의 다른 원가 베이스**다. UI 제안은 같은 행의 marginType/marginValue를
   premiumSupplierCostVnd에 적용(`computeSalePriceVnd(premiumCost, marginType, marginValue)`)해 파생,
   ADMIN이 결과를 오버라이드한다(기존 시맨틱 그대로). 소비자 제안도 consumerMargin*을 프리미엄 Net에 적용.
3. **폴백 모호성 차단** — premiumMarginValue만 있고 premiumSalePriceVnd가 null인 행의 의미가 정의
   불가능해지는 상태 공간을 원천 제거. 실마진 표시가 필요하면 `premiumSale − premiumCost`로 파생.

### 4. 엔진 반영 지점 (단일 원천 유지)

- `quoteStayByPeriod` 박 루프 1곳에 프리미엄 판정 삽입. 호출부는 `quoteStayForVilla` 경유
  (Villa.premiumDays + 숙박 구간 교차 HolidayDate를 로드해 전달) — 견적·HOLD 스냅샷·저장·영수증이
  자동으로 동일 결과. **화면·API 중복 구현 금지.**
- `NightQuote`에 `premium: boolean`(+사유: WEEKDAY|HOLIDAY) 플래그 추가 — 박별 내역 뱃지·검증용.
- HolidayDate 조회는 `date >= checkIn AND date < checkOut`(half-open) — 숙박 박 날짜 집합과 동일 범위.

## 보안 (마진 비공개 — 사업 원칙 2)

- `premiumSalePriceVnd/Krw`·`premiumConsumerSalePriceVnd/Krw`는 **공급자(SUPPLIER)·공개(/p·/g) 라우트
  절대 비노출** — 기존 salePrice*·consumer*와 동일 등급. select 화이트리스트에 추가 금지,
  QA leak-checklist 대상.
- 공급자에게 허용되는 프리미엄 필드는 `premiumSupplierCostVnd`(자기 원가)·`premiumSupplierSalePriceVnd`
  (자기 판매 정가)뿐. `quoteSupplierSaleForVilla`의 SRP_SELECT 확장 시에도 이 두 필드만.
- HolidayDate·premiumDays 자체는 가격 정보가 아니므로 비밀 아님(공급자 화면 요일 설정에 노출 가능).

## 대안 검토 (기각)

- **프리미엄 전용 겹침 기간 행 + 큰 쪽 승리**: 다축 가격에서 승자 정의 불가 — 기각(사용자 합의).
- **요일별 7단 매트릭스**: MVP 과잉, 계약서 범위 제외(IDEAS.md행).
- **전야 자동계산**: 국가·명절별 규칙이 제각각 — 운영자 명시 입력이 단순·정확. 기각.
- **프리미엄 마진 컬럼 추가**: §3 근거로 기각.

## 마이그레이션

`prisma/migrations-manual/2026-07-13_premium_day_pricing.sql` — additive only
(ADD COLUMN IF NOT EXISTS × 7, CREATE TABLE IF NOT EXISTS). Railway DB 수동 적용 후
`npx prisma generate`. `prisma migrate dev`/`db push` 금지(프로젝트 규약). 백필 없음
(null=평일 폴백이 곧 하위호환).
