# ADR-0008 — 빌라별 시즌 기간(VillaSeasonPeriod) 도입

- 상태: **승인(Accepted)** — 2026-06-16 TDA 검토·확정. 스키마 적용 완료(`prisma db push`).
- 날짜: 2026-06-16
- 관련: ADR-0003(통화·요율), SPEC F2(가용성)·F3(가격), lib/pricing.ts, lib/availability.ts
- 영향 대상: `SeasonPeriod`(전역), `lib/pricing.ts`, `app/api/seasons/*`, `prisma/seed.ts`

> **적용 노트(2026-06-16 TDA):** 본 ADR로 함께 적용된 Phase 1 빌라 관리자 업그레이드 부수 스키마:
> ① `VillaSeasonPeriod` 신규 모델 — Villa 역관계 필드명은 **`seasonPeriods`**(초안 D1의 `villaSeasonPeriods` 대신 확정).
> ② `VillaAmenity.unitPrice BigInt?` 추가 — 미니바 고객 청구 단가, **VND 고정**(통화 컬럼 없음, 동 단위, 부동소수점 금지).
> ③ `NotificationType` enum에 `RATE_CHANGED_DURING_PROPOSAL` append — 제안 진행 중 원가/요율 변경 운영자 통지.
> 적용 방식: 프로젝트 표준인 **`prisma db push`**(migrations 디렉터리 없음). 전부 additive(신규 테이블 + nullable 컬럼 + enum append) — 기존 데이터 무손실, 백필 없음.

## 맥락

현재 시즌 날짜 범위는 **전역 단일 `SeasonPeriod`** 테이블로 관리한다.
모든 빌라가 동일한 LOW/HIGH/PEAK 달력을 공유한다.

- `lib/pricing.ts`의 `resolveSeason(date, periods)`가 박별로 시즌을 판정하고,
  `quoteStayForVilla`가 `db.seasonPeriod.findMany`(전역)로 기간을 로드한다.
- 가격·가용성 단일 소스 원칙(SPEC F2/F3): 시즌 판정 로직은 `resolveSeason` 하나뿐이어야 한다.

Phase 1 빌라 관리자 업그레이드 기획에서 **시즌 날짜를 빌라별로 공급자가 직접 지정**하기로 확정됐다.
단지·위치·계약에 따라 성수기 구간이 다르기 때문이다(예: 특정 빌라만 연말 장기 블록).

## 결정

### D1. 신규 모델 `VillaSeasonPeriod` 추가 (전역 `SeasonPeriod`는 **폴백으로 유지**)

```prisma
model VillaSeasonPeriod {
  id        String     @id @default(cuid())
  villaId   String
  villa     Villa      @relation(fields: [villaId], references: [id], onDelete: Cascade)
  season    SeasonType
  startDate DateTime   @db.Date   // 포함 (UTC 자정)
  endDate   DateTime   @db.Date   // 제외 — [start, end) half-open, 프로젝트 날짜 규약
  label     String?
  createdAt DateTime   @default(now())

  @@index([villaId, startDate, endDate])
}
```

Villa 모델에 역관계 추가: `seasonPeriods VillaSeasonPeriod[]` (확정 필드명)

### D2. 시즌 판정 우선순위 — **빌라별 우선 + 전역 폴백 (날짜 단위 X, 빌라 단위)**

판정 규칙(한 빌라의 견적 시):

1. 해당 빌라에 `VillaSeasonPeriod`가 **하나라도 존재**하면 → 그 빌라의 기간 집합만 사용.
   전역 `SeasonPeriod`는 무시한다.
2. 해당 빌라에 `VillaSeasonPeriod`가 **전혀 없으면** → 전역 `SeasonPeriod` 폴백.
3. 어느 집합에서도 매칭 안 되는 날짜 → 기존대로 **LOW**(`resolveSeason`의 기본값).

> **빌라 단위 폴백을 채택**한 이유: 날짜 단위(빌라 기간에 없는 날만 전역에서 보충)는
> 같은 예약 안에서 두 출처가 섞여 디버깅·분쟁 증빙이 어렵고, 공급자가 "이 빌라는 내가 정한 달력대로"
> 라는 멘탈 모델과 어긋난다. 빌라가 자기 달력을 갖기 시작하면 그 빌라는 **완전히** 자기 달력으로 본다.

`resolveSeason(date, periods)` **순수 함수 시그니처는 불변** — 호출부가 어떤 집합(빌라 or 전역)을
넘길지 결정한다. 겹침 우선순위(PEAK>HIGH>LOW)도 그대로. **단일 소스 원칙 유지**.

### D3. DB 래퍼(`quoteStayForVilla`)만 폴백 분기 — 순수 함수층 무변경

```ts
// 의사코드 — 빌라 기간 우선, 없으면 전역
const villaPeriods = await db.villaSeasonPeriod.findMany({
  where: { villaId, startDate: { lt: range.checkOut }, endDate: { gt: range.checkIn } },
  select: { season: true, startDate: true, endDate: true },
});
const seasonPeriods = villaPeriods.length > 0
  ? villaPeriods
  : await db.seasonPeriod.findMany({ /* 기존 전역 쿼리 */ });
```

> ⚠️ **주의**: 폴백 판정 기준은 "구간과 겹치는 기간 존재 여부"가 아니라
> "이 빌라가 VillaSeasonPeriod를 보유했는가"여야 한다. 위 쿼리는 *구간 교차분*만 가져오므로,
> 빌라가 시즌을 지정했지만 이번 숙박 구간과 겹치는 게 없을 때 `length === 0`이 되어
> **잘못 전역으로 폴백**한다. 따라서 보유 여부는 별도 `count` 또는 `where: { villaId }` 존재 확인으로
> 판정하고, 기간 로드는 교차분만 가져오는 **2단계**로 구현한다. (구현 시 BE 계약서에 명시)

### D4. 전역 `SeasonPeriod` deprecate 하지 않음 (당분간 유지)

- 시즌을 지정하지 않은 기존·신규 빌라의 **합리적 기본 달력** 역할.
- `app/api/seasons/*`와 `/settings` 시즌 관리 UI는 그대로 운영자 전역 달력으로 존속.
- Phase 2에서 전 빌라가 자기 달력을 갖게 되면 그때 전역 deprecate 재검토(IDEAS).

## 마이그레이션·백필 전략

- **신규 테이블 추가만** — 기존 컬럼 변경·삭제 없음 → **기존 데이터 무손실**.
- 백필 **하지 않는다**: 마이그레이션 직후 모든 빌라는 `VillaSeasonPeriod` 0건 →
  D2 규칙에 의해 자동으로 전역 폴백 → **기존 견적 결과 100% 동일**(회귀 0).
- 공급자가 빌라별 시즌을 입력하기 시작하면 그 빌라만 자기 달력으로 전환된다.
- 마이그레이션 이름(확정 후 실행): `add_villa_season_period`.

## 위험·완화

| 위험 | 완화 |
|---|---|
| D3 폴백 오판정(구간 비교차 시 전역으로 새는 버그) | 보유 여부를 count로 분리 판정 — BE 계약·테스트 필수 |
| 같은 예약에 두 출처 혼합 | D2 빌라 단위 폴백으로 원천 차단 |
| 빌라 시즌 미지정 날짜 견적 실패 | LOW 폴백 유지 — `MissingRateError`는 VillaRate 부재 시에만(불변) |
| 시즌 경계 겹침 | 기존 `SEASON_PRECEDENCE` 그대로 — 변경 없음 |
| 공급자가 시즌만 지우고 요율은 남김 | 빌라 시즌 0건이면 전역 폴백 — 견적은 계속 동작 |

## 대안 (기각)

- **A. 전역 즉시 deprecate + 전 빌라 백필**: 모든 빌라에 전역 달력을 복제 → 데이터 폭증,
  전역 변경 시 동기화 지옥. 기각.
- **B. 날짜 단위 폴백**: D2 근거대로 디버깅·분쟁 증빙 불리. 기각.

## INDEX.md 등록 (도서관 규칙)

`docs/INDEX.md`의 핵심 매핑 표에 아래 행 추가 권고:

```
| 빌라별 시즌·가격 판정 | docs/decisions/0008-per-villa-season-periods.md + lib/pricing.ts(resolveSeason·quoteStayForVilla) |
```
