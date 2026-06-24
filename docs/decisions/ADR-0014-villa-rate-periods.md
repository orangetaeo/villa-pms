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

### 구현 현황 (2026-06-24)
- [x] 1 스키마+엔진(df3bd16) · 2 관리자 API(9e51fc4) · 3 관리자 편집기(8d855f1·ae04e74)
- [x] 후속1 공급자 자가 다기간 원가 입력 — `/api/villas/[id]/rate-periods/cost` + 공급자 모바일 편집기(589c07c·31b0afb)
- [x] 후속2 일괄 변환 스크립트 `scripts/migrate-rate-periods.ts`(멱등·dry-run, a8cd71d)

## 구 모델 Deprecate 검토 (후속 3/3)

`VillaRate`·`VillaSeasonPeriod`는 dual-read 폴백 경로라 **즉시 제거 금지**. 아래 전제 충족 후 단계적으로만.

### 제거 전제조건 (전부 충족 시에만)
1. **전 ACTIVE 빌라가 `VillaRatePeriod` 보유**(base 1행 필수). 변환 스크립트(후속2) + 신규 편집기로 도달.
2. **전역 `SeasonPeriod` 폴백 빌라 0** — 변환 스크립트는 전역폴백 빌라를 SKIP하므로, 이들은 운영자가 신규 편집기로 개별 전환 필요.
3. **코드에서 구 모델의 가격 참조 0** — `quoteStayForVilla`의 dual-read 구(舊) 분기 제거(신규 경로 단일화), 구 API/편집기(`/rates`·`/cost`·`/seasons`·`rate-editor`·`cost-seasons-editor`) 제거 또는 신규로 리다이렉트.
4. 제안·예약 스냅샷은 이미 구 모델 미참조(SPEC F3) → 무관.

### 단계 (각 단계 독립 배포·검증)
- **Phase A (완료)**: dual-read 공존. 신규 입력 경로 라이브, 구 편집기 잔존.
- **Phase B (완료 2026-06-24, 커밋 ddf2274)**: 전 빌라(11건) VillaRatePeriod 전환(전제 1·2 충족, 전역폴백 9건은 전역 비-LOW 기간 복제, scripts/migrate-rate-periods.ts·inspect-rate-state.ts) → `quoteStayForVilla` 구 분기 제거(신규 경로 단일, base 없으면 MissingBaseRateError). 구 API(rates·cost·seasons)·구 편집기(rate-editor·cost-seasons-editor) 제거. 쓰기(생성/수정/시드)는 `buildRatePeriodRowsFromSeasonCosts`, 표시/경보/공유는 `representativeRatesBySeason`. `MissingBaseRateError extends MissingRateError`로 proposal/candidates catch 호환. typecheck0·격리build0·테스트 통과·독립 QA PASS. **유지**: SeasonType·전역 SeasonPeriod(생성 날짜 템플릿)·등록 마법사 UX·VillaRate/VillaSeasonPeriod 테이블(Phase C 대상).
- **Phase C (완료 2026-06-24, ADR-0015·커밋 0616127)**: 구 테이블 `VillaRate`·`VillaSeasonPeriod` DROP(백업 후, `prisma db push --accept-data-loss`). VillaRatePeriod 단일 소스 확정. FK안전·코드참조0·스냅샷무영향. 상세·롤백 절차는 ADR-0015. **요율 다기간화 에픽 종결.**

### 검증 쿼리 (Phase B 진입 게이트)
```sql
-- ① base 미보유(미전환) ACTIVE 빌라 수 = 0 이어야 함
SELECT count(*) FROM "Villa" v
WHERE v.status = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM "VillaRatePeriod" rp WHERE rp."villaId"=v.id AND rp."isBase"=true);

-- ② 전역 SeasonPeriod 폴백 의존 빌라(VillaRatePeriod 0 AND VillaSeasonPeriod 0) = 0 이어야 함
SELECT count(*) FROM "Villa" v
WHERE NOT EXISTS (SELECT 1 FROM "VillaRatePeriod" rp WHERE rp."villaId"=v.id)
  AND NOT EXISTS (SELECT 1 FROM "VillaSeasonPeriod" sp WHERE sp."villaId"=v.id);
```

### 권고
현 시점은 **Phase A 유지**가 적정(라이브 빌라 소수, 테오팀 점진 전환). 전 빌라 전환 완료가 확인되면 Phase B ADR을 신규 작성해 구 분기/편집기 제거를 한 스프린트로 진행. Phase C(테이블 DROP)는 충분한 안정화 기간 후, 백업 전제로만.

## dual-read 비인지 소비처 (디버깅 발견 2026-06-24 — Phase B 정리 대상)

`quoteStayForVilla`는 dual-read로 전환됐지만, **`VillaRate`/`VillaSeasonPeriod`를 가격·원가 표시로 직접 읽는 다른 소비처**는 신규 경로(VillaRatePeriod) 빌라에서 **stale/부재 값**을 보인다. 견적(제안·예약)은 `quoteStayForVilla`를 거치므로 영향 없음 — 아래는 "대표 가격/원가 표시"에 한함.

| 소비처 | 현재 | 신규경로 빌라 영향 | Phase B 조치 |
|---|---|---|---|
| Zalo 빌라 공유 (`app/(admin)/messages/page.tsx` 약 444–465) | `v.rates.find(LOW) ?? rates[0]` 대표가격 | VillaRate stale/부재 → 공유 가격 틀림/누락 | dual-read 인지 대표가격 헬퍼(있으면 VillaRatePeriod base 사용) |
| STAFF 원가 읽기뷰 (`app/(admin)/villas/[id]/page.tsx` costOnlyRows) | `villa.rates`(VillaRate) 시즌 원가 | 신규경로 빌라는 원가 stale/empty | STAFF용 VillaRatePeriod 원가 읽기뷰 |

> **현 시점(Phase A) 영향 잠복**: 변환된 빌라가 거의 없어 실사용 영향 미미. 변환 진행 전 위 2건을 **dual-read 인지 공통 헬퍼**(예: `lib/pricing.ts`에 `representativeRateForVilla(villaId)`)로 일원화하면 근본 해소. 일괄 변환(후속2) 실행 **전에** 처리 권장.
>
> ⚠️ messages/page.tsx는 타 세션(Zalo) 활성 구역 — 수정 시 조율 필요(직접 충돌 회피).

## 디버깅 (2026-06-24, Phase C 후 4영역 병렬 조사)

생성/시드(A)·cost-alerts(B)·표시(C)·견적통합(D) 4영역을 병렬 점검. **누수 불변식 전 경로 PASS, 견적/제안/예약/스냅샷 무결성 정상.**

### 수정 완료
- **[표시 버그] `representativeRatesBySeason` HIGH/PEAK가 기간 부재 시 base(LOW) 폴백** (커밋 2fadafa): 비수기 원가를 "성수기" 라벨로 오표시 + cost-alerts가 HIGH/PEAK 원가변경 마진을 base(LOW) 판매가로 오산. → 해당 시즌 실제 기간 있을 때만 반환(없으면 키 미포함), LOW=base 유지. 단위테스트 4건 신규(기존 0건이라 미검출됐음).

### 잠복·설계 한계 (현 데이터 미발현 — 후속 검토)
- **[A·설계] 마법사 3원가(LOW/HIGH/PEAK) → N기간 사상은 손실적**: 전역 PEAK가 2개(설·연말)면 단일 `costs.PEAK`가 두 기간에 동일 복제 → 기간별 다른 원가는 생성 시 불가, ADMIN이 `rate-periods` PATCH로 분리해야 함. (구 모델도 시즌당 1행이라 동일 제약 — 회귀 아님.)
- **[A·잠복] HIGH/PEAK 원가 유실**: 전역 SeasonPeriod에 해당 시즌 창이 없으면 마법사 입력 HIGH/PEAK 원가가 어디에도 저장 안 됨(base만 생성). 현 전역시즌은 HIGH+PEAK 보유라 미발현. 신규 환경/연도 전환 시 위험 → 생성 시 경고 또는 UX 안내 검토(TDA).
- **[A·잠복] 생성 경로 기간 겹침 미검증**: `rate-periods` PATCH는 겹침 거부하나 생성(`buildRatePeriodRowsFromSeasonCosts`)은 전역시즌이 겹치면 겹친 기간 생성(견적은 `resolveRatePeriod` precedence로 결정적 처리). 겹침 검증 헬퍼 공유 권장.
- **[A·구조] base 단일성 DB 제약 부재**: villa당 isBase=true 1행을 코드 규율(deleteMany→create)로만 보장. Postgres partial unique index 검토(TDA).
- **[A·기존] 마진 0 placeholder 견적 위험**: 승인 전 빌라(margin0·krw0)가 견적되면 0원/마진0 판매가 산출 가능(구 생성도 동일). isSellable 게이트로 대부분 차단되나 가격 가드 부재.
- **[B·기존] cost-alerts 같은시즌 다중기간**: 둘째 PEAK 원가변경 알림도 첫 PEAK 판매가로 마진 표시(season 단위 한계, ADMIN 정보 패널). 근본 해소는 payload가 기간 id/판매가 운반 필요.
- **[D·테스트] `quoteStayForVilla` 교차로드 where 회귀 방어 약함**: 테스트 mock이 where 조건식을 손으로 복제 → 실 DB 통합테스트 1건 권장.

## 디버깅 라운드2 (2026-06-24, 추가 4렌즈: cost-alerts·수정후 UX·동시성/무결성·E2E)

representativeRatesBySeason 수정 후 재조사 + 새 렌즈. **누수 불변식 재PASS, 견적/스냅샷 무결성 재확인.**

### 수정 완료
- **[G HIGH] 미책정(0원) 빌라 후보 노출** (커밋 후속): 생성 placeholder(margin0·sale=cost·krw0)인 빌라가 KRW 채널에서 0원 판매가로 제안/고객공유될 수 있음(실 DB `,ㅏㅏㅏㅏ` ACTIVE·전행 krw0 확인, 현재 isSellable=false로 차단되나 승인 시 노출). → `app/api/proposals/candidates/route.ts`에 판매가 0 가드 추가(MissingRate와 동일하게 "판매가 미책정" warning + 후보 제외). 고객 노출 진입점(제안 후보) 차단.

### 잠복·정책 (현 데이터 미발현 또는 정책 결정 필요 — 미수정·추적)
- **[F HIGH] base 단일성 DB 제약 부재**: villa당 isBase=true 1행을 코드 규율(deleteMany→create)로만 보장. base-부재 빌라에 동시 쓰기 2건이면 base 2행 가능 → `quoteStayForVilla` findFirst 비결정. **현재 전 빌라 base 보유 + POST가 단일 트랜잭션 생성이라 실현 거의 불가.** 근본해소=partial unique index `CREATE UNIQUE INDEX ... ON "VillaRatePeriod"("villaId") WHERE "isBase"`, 단 **db push 워크플로에선 schema 미표현 인덱스가 다음 push에 사라짐** → prisma migrate 전환 시 도입 권장(TDA).
- **[F HIGH/정책] rate-periods PATCH status 가드 부재 + PUT 재제출이 관리자 책정 삭제**: REJECTED/PENDING 빌라에 관리자가 미리 마진·판매가 책정 후 공급자 PUT 재제출하면 deleteMany로 소멸. 또 ACTIVE 빌라 전체교체에 RATE_CHANGED 알림 없음. "REJECTED는 미승인이라 리셋 안전" 주석 전제를 PATCH가 보장 안 함. **정책 결정 필요**(PATCH에 status 가드 vs PUT을 원가만 갱신) — TDA/PM.
- **[B MED] base.season LOW 미강제**: 편집기가 base 행도 season 선택 UI 공유 → base.season=HIGH 저장 가능. representativeRatesBySeason는 base→LOW 슬롯 고정이라 cost-alerts payload.season(=base.season)과 어긋나 마진 미표시 가능. 편집기 UX 깨짐 우려로 z.literal 강제 안 함 — 표시 영향만, 추적.
- **[B MED] cost-alerts 같은시즌 다중기간 마진 오산**: 둘째 PEAK 원가변경도 첫 PEAK 판매가로 마진 표시(payload에 기간 식별자 없음). ADMIN 정보 패널 한정, 가격 변경 아님. 근본해소=payload에 ratePeriodId 운반(계약 변경, TDA).
- **[G MED] fx=null 시 공급자 cost PATCH가 salePriceKrw=0 기록**: KRW 미책정 재고 발생원. 현재 FX 설정돼 미발현. fx 미설정 시 ADMIN 경고 검토.
- **[G LOW] suggestSalePriceKrw 오염 환율 시 500**: getFxVndPerKrw 형식 미검증. 환율 입력 UI 검증 있으면 무해.
- **[E LOW] 공급자 상세 원가카드 "성수기 미설정" 빈상태 안내 부재**: 수정으로 base만 표시 시(정직해짐) 미설정 안내 칩 추가 권고. 미관.
