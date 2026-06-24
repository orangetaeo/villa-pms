# ADR-0014 — 빌라 기간별 요금(VillaRatePeriod) 도입

- 상태: **승인(Accepted)** — 2026-06-24 사용자(테오) 승인. 구현 스프린트 착수.
- 날짜: 2026-06-24
- 관련: ADR-0003(통화·요율), ADR-0008(빌라별 시즌 기간), SPEC F3(가격), `lib/pricing.ts`
- 영향 대상: `VillaRate`·`VillaSeasonPeriod`(공존/마이그레이션), `lib/pricing.ts`, `app/api/villas/[id]/rates`·`seasons`·`cost`, 공급자 원가·시즌 편집기, 관리자 요율 편집기
- 구현: 본 ADR 승인 후 **별도 스프린트**(스키마 `db push` 한 세션 전담). 본 문서는 설계만.

## 맥락 (현재 한계)

현재 요율은 **시즌당 정확히 1개**로 고정된다.

- `VillaRate`: `@@unique([villaId, season])` → 빌라당 LOW/HIGH/PEAK 각 1행. 가격 키 = 시즌.
- `VillaSeasonPeriod`(ADR-0008): 빌라별 시즌 **날짜 범위**만 보유(가격 없음), 같은 빌라 내 겹침 거부.
- `lib/pricing.ts`: 박별로 `resolveSeason(date) → season → rateBySeason.get(season)` → 그 시즌의 **단일 가격**.

→ "극성수기를 여러 기간으로 나눠 **기간마다 다른 소비자가**"가 **불가능**하다. 같은 PEAK를 여러 가격으로 둘 수 없다(시즌 자체가 가격 키).

### 사업 요구 (회의 확정 2026-06-23)
1. 공급자가 **같은 시즌을 여러 기간**으로 나눠 입력할 수 있어야 한다(예: 극성수기 = 설 + 여름 + 추석, 각각 다른 날짜).
2. 관리자가 **각 기간마다 소비자가를 다르게** 책정한다(공급자 원가 ≥ 위로 마진, 기간별 상이).
3. 모델: **비수기 = 기본요금 1개** + 성/극성수기(및 필요 시 비수기) **웃돈 기간 N개**. 기간 밖 날짜는 기본요금.
4. 시즌 분류(LOW/HIGH/PEAK)는 **라벨로 유지**(표시·정렬·색).

## 결정

### D1. 신규 모델 `VillaRatePeriod` — 날짜 범위 + 가격을 한 행에 통합

`VillaSeasonPeriod`(날짜만)와 `VillaRate`(시즌 가격)를 **기간 단위 요금 행**으로 합친다. 각 행 = 가격이 매겨진 1개 기간.

```prisma
model VillaRatePeriod {
  id              String      @id @default(cuid())
  villaId         String
  villa           Villa       @relation(fields: [villaId], references: [id], onDelete: Cascade)
  season          SeasonType  // 분류 라벨 (LOW/HIGH/PEAK) — 표시·정렬용. 가격 키 아님
  isBase          Boolean     @default(false) // true = 비수기 기본요금(날짜 무관·폴백). villa당 정확히 1개
  startDate       DateTime?   @db.Date  // isBase=false일 때 필수. 포함
  endDate         DateTime?   @db.Date  // isBase=false일 때 필수. 제외 — [start,end) half-open
  label           String?     // "2026 설", "여름 성수기 1차"
  supplierCostVnd BigInt      // 공급자 입력 — 이 기간 원가/박
  marginType      MarginType  @default(PERCENT)
  marginValue     BigInt      // 관리자 — PERCENT: %, FIXED_VND: 동
  salePriceVnd    BigInt      // 관리자 책정 — 이 기간 판매가/박 (VND 채널: 여행사·랜드사)
  salePriceKrw    Int         // 관리자 책정 — 이 기간 판매가/박 (KRW 채널: 직접 소비자)
  updatedAt       DateTime    @updatedAt

  @@index([villaId, startDate, endDate])
  @@index([villaId, isBase])
}
```

Villa 역관계: `ratePeriods VillaRatePeriod[]`.

- **기본요금(isBase=true)**: 날짜 없음. 빌라당 **정확히 1개**(비수기 기준가 + 폴백). 어떤 기간에도 안 걸린 날짜는 이 가격.
- **웃돈 기간(isBase=false)**: `startDate`·`endDate` 필수. season은 HIGH/PEAK가 일반적이나 LOW도 허용(예: 더 싼 비수기 특가).
- **금액 컬럼은 `VillaRate`와 동일 의미** — 공급자=`supplierCostVnd`, 관리자=margin·salePriceVnd·salePriceKrw(ADR-0003 듀얼 통화 그대로).

### D2. 가격 판정 — "기간 우선, 없으면 기본요금" (시즌 precedence 대체)

박별 판정 규칙(한 빌라):
1. 그 날짜를 포함하는 **웃돈 기간**(isBase=false)을 찾는다 → 그 기간의 가격.
2. 어떤 기간에도 안 걸리면 → **기본요금**(isBase=true)의 가격.
3. 기본요금이 없으면 → `MissingRateError`(기존과 동일, 견적 불가).

`lib/pricing.ts` 변경:
- `VillaRateLike`(시즌 가격) + `SeasonPeriodLike`(날짜) → **`RatePeriodLike`**(날짜+가격) 단일 타입으로 통합.
- 신규 순수 함수 `resolveRatePeriod(date, periods, base) → RatePeriodLike`(기간 우선, 폴백 base). `resolveSeason`은 구 경로 전용으로 잔존.
- `quoteStay`: 박별로 `resolveRatePeriod` 결과의 가격을 합산(시즌→rateBySeason.get 대체).

> **단일 소스 원칙 유지**: 가격 판정 순수 함수는 여전히 한 곳(`resolveRatePeriod`). 화면·API 중복 구현 금지.

### D3. 겹침 금지 → 날짜당 기간 1개 (결정적 가격)

같은 빌라 내 웃돈 기간끼리 **날짜 겹침을 입력 단계에서 거부**(409) — `VillaSeasonPeriod`의 현행 정책(ADR-0008) 계승. 결과: 한 날짜를 덮는 기간은 최대 1개 → 가격 결정적, precedence 불필요.

> 방어적 tie-break(데이터에 겹침이 있을 경우): `SEASON_PRECEDENCE` 높은 것 → 같으면 `startDate` 늦은 것. 정상 입력에선 발생 안 함.

### D4. Dual-read 폴백 — 신규/구 경로 공존 (ADR-0008 패턴 재사용, **무중단·무백필**)

`quoteStayForVilla`에서 빌라의 `VillaRatePeriod` **보유 여부(count)**로 분기:
1. `VillaRatePeriod`가 **1건이라도 있으면** → 신규 기간별 경로(D2). 구 `VillaRate`·`VillaSeasonPeriod`·전역 `SeasonPeriod` 무시.
2. **0건이면** → **기존 경로 그대로**(`VillaRate` + `VillaSeasonPeriod`/전역 폴백, ADR-0008). 변경 없음.

```ts
// 의사코드 — ADR-0008 D3의 count/load 2단계 원칙 동일 적용 (교차분 length로 폴백 판정 금지)
const periodCount = await db.villaRatePeriod.count({ where: { villaId } });
if (periodCount > 0) {
  const base = await db.villaRatePeriod.findFirst({ where: { villaId, isBase: true } });
  const periods = await db.villaRatePeriod.findMany({
    where: { villaId, isBase: false, startDate: { lt: range.checkOut }, endDate: { gt: range.checkIn } },
  });
  return quoteStayByPeriod({ ...range, saleCurrency, base, periods }); // 신규
}
return /* 기존 quoteStay(VillaRate+SeasonPeriod) 경로 그대로 */;
```

→ **마이그레이션 직후 회귀 0**: 아무 빌라도 `VillaRatePeriod`를 안 가지므로 100% 기존 경로. 빌라가 신규 편집기로 저장하면 그 빌라만 기간별 경로로 전환(빌라 단위, ADR-0008 멘탈모델 일치).

### D5. 기본요금 불변식 (isBase 1개)

- 신규 편집기는 **base 1행 + periods N행**을 단일 `$transaction` 전체 교체(deleteMany→createMany, 판매정보 폼 패턴).
- 빌라당 isBase=true 정확히 1개를 **앱 레벨에서 보장**(저장 시 base 누락이면 거부). Prisma는 partial unique 미지원 → 필요 시 db push 후 Postgres partial unique index(`WHERE is_base`) 수동 추가를 구현 스프린트에서 검토.
- `VillaRatePeriod` 보유 빌라는 base가 **필수**(없으면 기간 밖 날짜 견적 불가 = MissingRateError).

### D6. UI 변경 계약 (범위만 — 구현은 별도 스프린트)

| 화면 | 현재 | 변경 |
|---|---|---|
| 공급자 원가·시즌(`cost-seasons-editor`) | 시즌 3카드, 시즌당 원가 1 + 기간 1 | **기본요금 원가 1 + 기간 N개 추가**(기간마다 날짜·원가). 텍스트 입력 최소·터치 우선 유지 |
| 관리자 요율(`rate-editor`) | 시즌 3카드, 시즌당 마진·판매가 | **기간 목록**, 기간마다 마진·salePriceVnd·salePriceKrw 책정(자동제안 그대로) |
| API | `PUT rates`(시즌별), `seasons` CRUD | `VillaRatePeriod` 전체 교체 PATCH(공급자=원가, 관리자=판매가 권한 분리). 누수 0(공급자에 판매가·마진 금지) |

> 권한 분리 유지: 공급자는 `supplierCostVnd`만 입력·조회, 관리자(`canSetPrice`)만 margin·salePrice. 한 모델의 컬럼 단위 권한은 API select/입력 화이트리스트로 강제(ADR-0003·RBAC 패턴).

## 마이그레이션·백필 전략

- **신규 테이블 추가만**(additive) — 기존 `VillaRate`·`VillaSeasonPeriod` 컬럼 무변경 → 무손실.
- **백필 안 함**: D4에 의해 즉시 회귀 0(모든 빌라 구 경로). 마이그레이션 이름: `add_villa_rate_period`.
- **선택적 데이터 이전(나중)**: 기존 빌라를 기간별로 전환하려면 변환 스크립트로 LOW VillaRate→base, HIGH/PEAK VillaSeasonPeriod+VillaRate→기간행 생성. 일괄 강제 아님(빌라가 신규 편집기 저장 시 자연 전환). 전역 폴백 빌라는 전역 기간 복제 필요 → 그 시점에 검토.
- `VillaRate`·`VillaSeasonPeriod`는 **deprecate 하지 않음**(미전환 빌라의 활성 경로). 전 빌라 전환 후 제거 재검토(IDEAS).
- **제안·예약 무영향**: `ProposalItem`·`Booking`은 생성 시 가격을 **스냅샷**(ADR-0003) → 이후 요율 모델 변경과 무관. 진행 중 제안의 원가 변경 통지(`RATE_CHANGED_DURING_PROPOSAL`)만 신규 경로에도 동일 적용.

## 위험·완화

| 위험 | 완화 |
|---|---|
| Dual-read 폴백 오판정 | ADR-0008 교훈 — 보유는 `count`, 기간 로드는 교차분 **2단계 분리**(교차분 length로 폴백 판정 금지) |
| 기간 밖 날짜 가격 없음 | base(isBase) 필수 불변식(D5). 신규 경로 빌라는 base 없으면 저장 거부 |
| 같은 날짜 다중 기간(모호) | 입력 겹침 거부(D3) + 방어적 tie-break |
| 공급자에 판매가 누수 | 컬럼 단위 권한 — 공급자 API는 supplierCost만 select/입력(ADR-0003·RBAC) |
| 두 경로 혼합으로 디버깅 난해 | 빌라 단위 분기(ADR-0008과 동일) — 한 빌라는 전적으로 한 경로 |
| isBase 2개 이상 데이터 깨짐 | 앱 트랜잭션 보장 + (선택) Postgres partial unique index |

## 대안 (기각)

- **A. 빅뱅 — 구 모델 즉시 폐기 + 전 빌라 일괄 변환**: 라이브 데이터 위험·전역폴백 빌라 변환 복잡. dual-read(D4)가 무중단·무회귀로 우월. 기각.
- **B. `SeasonType` enum에 PEAK_1·PEAK_2… 추가**: 기간 수만큼 enum 증식·확장성 0. 기각.
- **C. `VillaRate`에 startDate·endDate만 추가(기간별 행 허용)**: `VillaSeasonPeriod`와 날짜가 이원화돼 정합 깨짐. 통합 모델(D1)이 단일 출처. 기각.

## INDEX.md 등록 (도서관 규칙)

`docs/INDEX.md` 핵심 매핑 표에 추가 권고:
```
| 기간별 요금·가격 판정 | docs/decisions/ADR-0014-villa-rate-periods.md + lib/pricing.ts(resolveRatePeriod·quoteStayForVilla) |
```

## 승인 후 구현 스프린트 분해 (참고, 본 ADR 범위 밖)

1. 스키마 `VillaRatePeriod` + `db push`(한 세션 전담) + `lib/pricing.ts` 신규 경로·dual-read.
2. API: `VillaRatePeriod` 전체교체 PATCH(공급자 원가 / 관리자 판매가 권한 분리) + 겹침 거부.
3. 공급자 편집기(기본요금+기간 N) · 관리자 요율 편집기(기간별 판매가).
4. 테스트: 신규 경로 박별 합산·base 폴백·겹침 거부·dual-read 분기·누수 0·스냅샷 무영향.
