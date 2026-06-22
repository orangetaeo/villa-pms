# 빌라 "판매용 정보" 필드 확장 — 데이터 설계 초안 (검토용)

> **상태: 설계 확정 (구현 대기)** — 테오 결정 7건 전부 해소(§7). 아직 schema 변경·`prisma db push`·마이그레이션은 **수행하지 않았다**.
> 스키마 변경은 단일 세션(TDA) 전담 원칙. 구현 착수 시 별도 세션에서 마이그레이션한다.
> 작성: TDA / 2026-06-22 / 대상 Prisma schema v1.2c

## 0. 목적 & 범위

테오 팀이 빌라 데이터를 직접 취합한다. 현 `Villa` 모델은 내부 운영(원가·가용성·검수)에 치우쳐 한국 여행사·고객에게 팔 "판매용 정보"가 빈약하다. 아래 확정 필드를 MVP에 **추가(additive only)** 한다.

- ② 잠자리 구성(침실별 침대·수용·엑스트라베드)
- ③ 위치·접근성(구글맵·해변거리·전용면적·층수)
- ④ 이용규칙(체크인/아웃·흡연·반려동물·파티·주차·기준보증금·와이파이)
- ⑤ 셀링포인트 태그(뷰/BBQ/엘리베이터/발전기/골프인근/키즈풀 등 다중선택)
- ① 수영장은 **현행 `hasPool` Y/N 유지** (확장 안 함)

**입력 주체:** ADMIN 전용 신규 상세 폼 (한국인 팀 — 텍스트 제약 없음, 베트남 공급자 마법사 아님).
**표시:** `/p/[token]` 공개 제안페이지(최우선) · ADMIN `/villas/[id]` · 공급자 `/my-villas/[id]`.

### 누수(leak) 관점 사전 확인 — 중요
이 신규 필드들은 **마진·판매가가 아니므로 공급자에게 노출돼도 무방한 "누수 무관 필드"** 다 (사업 핵심 원칙 1·2 위반 없음). 빌라의 물리적·규칙적 사실일 뿐이다.

**단 하나의 예외: 와이파이 비밀번호(`wifiPassword`).** 보안 사실이므로 **공개 제안 페이지(`/p/[token]`)에 절대 노출 금지** — 체크인 화면 전용. (자세한 select 화이트리스트 주의 → §4.3)

---

## 1. 스키마 변경안 (additive only — 기존 컬럼 변경 0건)

### 1.1 `Villa`에 추가할 스칼라 컬럼

모두 `nullable` 또는 기본값 보유 → **기존 행 백필 불필요**. 기존 `Villa` 모델의 필드는 한 줄도 바꾸지 않는다.

```prisma
model Villa {
  // ... (기존 컬럼 전부 그대로) ...

  // ── 판매용 정보 확장 (v1.3 / ADR-0011) — additive only, 기존 컬럼 변경 없음 ──

  // ③ 위치·접근성 — 모두 정수 단위(부동소수점 금지). 미입력 허용(nullable)
  googleMapUrl   String? // 구글맵 공유 링크 (place URL). 길이 제약 없음 — ADMIN 입력
  beachDistanceM Int?    // 해변까지 거리(미터, 정수). 예: 350 = 350m. ㎞ 환산은 표시단에서
  areaSqm        Int?    // 전용면적(㎡, 정수). 소수점 면적은 반올림 입력 (근거 §1.4)
  floors         Int?    // 층수(정수). 단층=1, 복층=2

  // ④ 이용규칙
  checkInTime    Int     @default(840)  // 분 단위(0~1439). 840 = 14:00 (근거 §1.5)
  checkOutTime   Int     @default(660)  // 분 단위. 660 = 11:00
  smokingAllowed Boolean @default(false)
  petsAllowed    Boolean @default(false)
  partyAllowed   Boolean @default(false)
  parkingSlots   Int     @default(0)    // 주차 가능 대수
  baseDepositVnd BigInt? // 기준 보증금(VND BigInt, 동 단위). 부동소수점 금지. Booking.depositAmount와 별개(빌라 기본값)
  wifiSsid       String? // 와이파이 이름 — 공개 노출 가능
  wifiPassword   String? // ⚠ 와이파이 비번 — /p 공개페이지 절대 노출 금지(체크인 화면 전용). select 화이트리스트 §4.3

  // ⑤ 엑스트라베드 — 빌라 단위 토글(침실별 아님, 확정 요구사항)
  extraBedAvailable Boolean @default(false)

  // 역관계 추가
  bedrooms_       VillaBedroom[] // ② 침실별 잠자리 구성 (아래 ⚠ 네이밍 주의)
  features        VillaFeature[] // ⑤ 셀링포인트 태그 (사전 패턴)
}
```

> ⚠ **네이밍 충돌 주의:** 기존 `Villa.bedrooms` 는 **Int 컬럼**(침실 수)이다. 침실별 구성 역관계 이름으로 `bedrooms`를 쓸 수 없다. 본 초안은 역관계명을 **`bedroomDetails`** 로 제안한다(위 코드의 `bedrooms_`는 자리표시 — 확정 시 `bedroomDetails VillaBedroom[]`로 표기). 모델명은 `VillaBedroom`, 컬럼명 충돌 없음.

### 1.2 ② 침실별 잠자리 구성 — 별도 모델 `VillaBedroom` **(추천 1안)** vs JSON

**추천: 별도 모델 `VillaBedroom` (1안).** 근거는 §1.3.

```prisma
// 침대 종류 — 코드 사전(lib/bedding.ts)과 정합. enum으로 고정해 임의값 차단.
// 테오 확정(2026-06-22): 6종 (더블·트윈 추가). TWIN = 싱글 2개 구성 침실 표기용.
enum BedType {
  KING   // 킹
  QUEEN  // 퀸
  DOUBLE // 더블
  SINGLE // 싱글
  TWIN   // 트윈 (싱글 2개)
  BUNK   // 2층 침대
}

// ② 침실별 잠자리 구성 (ADR-0011). VillaPhoto / VillaAmenity 와 동일한 1:N 자식 패턴.
// 한 침실에 침대가 여러 종류면 행을 여러 개(같은 villaId·roomIndex, bedType만 다름) 둔다.
model VillaBedroom {
  id         String  @id @default(cuid())
  villaId    String
  villa      Villa   @relation(fields: [villaId], references: [id], onDelete: Cascade)
  roomIndex  Int     // 침실 번호(1-base). VillaPhoto.spaceLabel "침실1"과 의미 정합
  roomLabel  String? // 자유 라벨("마스터룸", "2층 침실") — 미입력 시 표시단에서 "침실N"
  bedType    BedType
  bedCount   Int     @default(1) // 이 종류 침대 개수
  capacity   Int?    // 이 침실 수용 인원(선택). 합산 검증은 BE에서 maxGuests와 대조(경고만)

  @@index([villaId, roomIndex])
}
```

- **침실별 수용인원** = `VillaBedroom.capacity` (침실 행 단위). 침실 1개에 침대 여러 종류여도 capacity는 침실 단위 1값이어야 하므로, **roomIndex별 capacity는 동일 값으로 입력**(BE 검증: 같은 roomIndex 행들의 capacity 일치). 또는 capacity를 별도 `VillaRoom` 모델로 정규화하는 방안이 더 깨끗하나 MVP 과설계 — §7 열린 질문 Q2.
- **엑스트라베드 가능 여부**는 확정대로 **빌라 단위 토글** `Villa.extraBedAvailable` (침실별 아님).

### 1.3 침대구성 모델링: 별도 모델 vs JSON — 비교 & 추천

| 기준 | 별도 모델 `VillaBedroom` **(추천)** | `Villa.bedrooms Json` |
|---|---|---|
| 기존 패턴 정합 | ✅ `VillaPhoto`·`VillaAmenity`·`VillaRate` 모두 1:N 자식 모델 — 프로젝트 컨벤션 | ❌ schema에 Json 구조 컬럼 전무, 이질적 |
| 쿼리·필터 | ✅ "킹베드 있는 빌라" 등 향후 검색/필터 인덱스 가능 | ❌ Json 내부 필터는 비표준·인덱스 불가 |
| 검증 | ✅ `BedType` enum + FK로 무결성 강제 | ❌ 앱단 zod 전적 의존, 깨진 데이터 유입 위험 |
| AuditLog 입자도 | ✅ 행 단위 변경 추적(`VillaBedroom`) | ⚠ Villa 단일 행 안에 묻힘 |
| 입력 폼 단순성 | △ 동적 행 추가 UI 필요 | ✅ 단일 Json 편집 |
| 마이그레이션 | ✅ 신규 테이블 1개 additive | ✅ 컬럼 1개 additive |

→ **추천: `VillaBedroom` 별도 모델.** 프로젝트가 이미 모든 빌라 부속정보를 1:N 자식 모델로 일관 관리(`VillaPhoto`/`VillaAmenity`/`VillaRate`/`VillaSeasonPeriod`)하고 있어 **컨벤션 정합·검증·향후 검색성**에서 우위. Json의 유일한 이점(폼 단순)은 ADMIN 전용 폼이라 동적 행 UI 부담이 작아 상쇄된다.

### 1.4 ⑤ 셀링포인트 태그 모델 — `VillaFeature` (사전 패턴 재사용, **추천**)

`VillaAmenity`의 **"사전(dictionary) + 코드상수 itemKey + i18n 라벨"** 패턴을 그대로 재사용한다. 태그는 수량·단가가 없으므로 `VillaAmenity`보다 단순하다(별도 모델로 분리해 의미 혼선 방지 — amenity=비치품목, feature=판매 셀링포인트).

```prisma
// 셀링포인트 분류 — 표시 그룹핑·필터용
enum FeatureCategory {
  VIEW      // 뷰 (바다/마운틴/시티 — 상호배타 아님, 다중 가능)
  FACILITY  // 시설 (BBQ·엘리베이터·발전기·키즈풀 등)
  LOCATION  // 입지 (골프장 인근 등)
}

// ⑤ 셀링포인트 태그 (ADR-0011). VillaAmenity 사전 패턴 재사용 — itemKey는 lib/features.ts 사전 키.
// 다중선택 = 체크된 featureKey마다 행 1개. itemKey 화이트리스트 검증은 isValidFeature()(lib/features.ts).
model VillaFeature {
  id         String          @id @default(cuid())
  villaId    String
  villa      Villa           @relation(fields: [villaId], references: [id], onDelete: Cascade)
  category   FeatureCategory
  featureKey String          // 사전 키 (코드 상수 → i18n: features.items.viewSea 등)

  @@unique([villaId, featureKey]) // 같은 태그 중복 방지
  @@index([villaId, category])
}
```

> `VillaAmenity`와의 차이: `quantity`·`unitPrice`·`customLabel` 없음(태그는 on/off만). custom 자유입력은 미허용(ADMIN이 사전에 키 추가). `@@unique([villaId, featureKey])`로 중복 태그 차단.

---

## 2. 마이그레이션 영향

- **additive only.** 기존 컬럼 타입·이름·기본값 변경 0건. 신규: `Villa` 스칼라 13개 + enum 2개(`BedType`·`FeatureCategory`) + 모델 2개(`VillaBedroom`·`VillaFeature`).
- **기존 행 백필 불필요.** 추가 스칼라는 전부 nullable 또는 `@default` 보유:
  - `checkInTime @default(840)`·`checkOutTime @default(660)`·`smokingAllowed/petsAllowed/partyAllowed @default(false)`·`parkingSlots @default(0)`·`extraBedAvailable @default(false)` → 기존 빌라는 합리적 기본값으로 채워짐.
  - 나머지(`googleMapUrl`·`beachDistanceM`·`areaSqm`·`floors`·`baseDepositVnd`·`wifiSsid`·`wifiPassword`)는 nullable → null.
  - 신규 자식 테이블(`VillaBedroom`·`VillaFeature`)은 빈 상태 시작.
- **`prisma db push` 1회로 가능** (데이터 손실 경고 없음 — 순수 add). 운영 마이그레이션은 `prisma migrate dev --name villa_sales_fields` 권장.
- **롤백 안전:** additive라 롤백 시 신규 컬럼·테이블 drop만, 기존 데이터 무영향.

---

## 3. lib 사전 파일 안

`lib/amenities.ts` 형식을 그대로 따른다(`itemKey` 코드상수 + 사전 + 검증 함수).

### 3.1 `lib/features.ts` (⑤ 셀링포인트 사전 — 신규)

```ts
// 셀링포인트 태그 사전 (ADR-0011) — lib/amenities.ts 패턴 재사용
// featureKey는 코드 상수 — 라벨은 i18n 키 `features.items.<featureKey>` (ko/vi)
// 아이콘은 Material Symbols Outlined 글리프명

export type FeatureCategoryKey = "VIEW" | "FACILITY" | "LOCATION";

export interface FeatureItem {
  featureKey: string;
  icon: string;
}

export const FEATURE_CATEGORIES: FeatureCategoryKey[] = ["VIEW", "FACILITY", "LOCATION"];

export const FEATURE_ITEMS: Record<FeatureCategoryKey, FeatureItem[]> = {
  VIEW: [
    { featureKey: "viewSea",      icon: "waves" },       // 바다뷰
    { featureKey: "viewMountain", icon: "landscape" },   // 마운틴뷰
    { featureKey: "viewCity",     icon: "location_city" }, // 시티뷰
  ],
  FACILITY: [
    { featureKey: "bbq",        icon: "outdoor_grill" }, // BBQ
    { featureKey: "elevator",   icon: "elevator" },      // 엘리베이터
    { featureKey: "generator",  icon: "bolt" },          // 발전기/정전대비
    { featureKey: "kidsPool",   icon: "pool" },          // 키즈풀
    { featureKey: "privatePool",icon: "pool" },          // 프라이빗풀(hasPool과 별개 강조 태그)
    { featureKey: "gym",        icon: "fitness_center" },
  ],
  LOCATION: [
    { featureKey: "golfNearby",  icon: "golf_course" },  // 골프장 인근
    { featureKey: "beachFront",  icon: "beach_access" }, // 해변 바로앞
    { featureKey: "marketNearby",icon: "storefront" },
  ],
};

/** 사전 검증 — API에서 임의 featureKey 주입 차단 (custom 미허용) */
export function isValidFeature(category: FeatureCategoryKey, featureKey: string): boolean {
  return FEATURE_ITEMS[category]?.some((f) => f.featureKey === featureKey) ?? false;
}
```

### 3.2 `lib/bedding.ts` (② 침대 종류 — 신규, 선택)

`BedType` enum과 i18n 라벨·아이콘 매핑. enum이 schema에 있으므로 사전은 표시용 메타만:

```ts
// 침대 종류 메타 (ADR-0011) — schema enum BedType과 1:1 (테오 확정 6종)
export const BED_TYPES = ["KING", "QUEEN", "DOUBLE", "SINGLE", "TWIN", "BUNK"] as const;
export type BedTypeKey = (typeof BED_TYPES)[number];

export const BED_TYPE_META: Record<BedTypeKey, { icon: string }> = {
  KING:   { icon: "king_bed" },
  QUEEN:  { icon: "bed" },
  DOUBLE: { icon: "bed" },
  SINGLE: { icon: "single_bed" },
  TWIN:   { icon: "single_bed" },
  BUNK:   { icon: "bunk_bed" },
};
// 라벨 i18n 키: bedding.<KING|QUEEN|DOUBLE|SINGLE|TWIN|BUNK> (ko/vi)
```

> i18n 키 추가(추가만): `features.items.*`, `features.categories.*`, `bedding.*`, `villaRules.*`(흡연/반려동물/파티/주차/체크인아웃 라벨). 공유파일 규칙대로 **키 추가만**·즉시 커밋.

---

## 4. API / 표시 영향 요약

### 4.1 영향받는 라우트·화면

| 영역 | 변경 | 비고 |
|---|---|---|
| ADMIN 입력 폼 (신규) | `/villas/[id]/edit` 또는 상세 내 "판매정보" 탭 — ②③④⑤ 입력 | **신규**. 한국어, 동적 침실 행·태그 체크박스 |
| API: Villa 갱신 | `PATCH /api/villas/[id]` 확장(스칼라), `VillaBedroom`·`VillaFeature` CRUD 라우트 | zod에 `isValidFeature`·`BedType` 검증. **AuditLog 필수**(§4.4) |
| `/p/[token]` 공개페이지 | ②③(맵·거리·면적·층수)④(규칙·체크인아웃·주차)⑤(태그) 표시 — **최우선** | ⚠ **wifiPassword·wifiSsid 제외** select |
| ADMIN `/villas/[id]` | 전체 표시(와이파이 포함 — ADMIN 운영용) | 누수 무관(ADMIN 전권) |
| 공급자 `/my-villas/[id]` | 전체 표시(와이파이 포함 가능) | 누수 무관 필드 — 사업원칙 위반 없음 |

### 4.2 표시 변환(저장 정수 → UI)

- `checkInTime` 840 → `"14:00"` (`Math.floor(m/60)`:`m%60`). 표시·입력 변환은 화면단, **저장은 분 단위 Int**.
- `beachDistanceM` 1200 → `"1.2km"` (≥1000m 시 km 환산 표시), 그 미만 `"350m"`.
- `baseDepositVnd` BigInt → 천단위 구분 표시(`Intl.NumberFormat`). 직렬화 시 BigInt→string 주의(기존 금액 컬럼 동일 이슈).

### 4.3 ⚠ select 누수 주의 — wifiPassword (가장 중요)

`/p/[token]` 응답을 만드는 BE는 **명시적 select 화이트리스트**로 `Villa`를 로드해야 한다. `findUnique({ where })` 같은 **전체 컬럼 로드 후 직렬화 금지** — `wifiPassword`·`wifiSsid`가 함께 새어나간다.

```ts
// /p/[token] 빌라 로드 — 화이트리스트 select (wifiPassword·wifiSsid 절대 미포함)
const villa = await prisma.villa.findUnique({
  where: { id },
  select: {
    id: true, name: true, complex: true, address: true,
    bedrooms: true, bathrooms: true, maxGuests: true, hasPool: true, breakfastAvailable: true,
    // 판매정보 (공개 OK)
    googleMapUrl: true, beachDistanceM: true, areaSqm: true, floors: true,
    checkInTime: true, checkOutTime: true,
    smokingAllowed: true, petsAllowed: true, partyAllowed: true, parkingSlots: true,
    baseDepositVnd: true, // 기준 보증금은 고객 안내용 — 공개 OK
    extraBedAvailable: true,
    // ⛔ wifiSsid·wifiPassword 제외 (체크인 화면 전용)
    bedroomDetails: { select: { roomIndex: true, roomLabel: true, bedType: true, bedCount: true, capacity: true } },
    features: { select: { category: true, featureKey: true } },
  },
});
```

- **체크인 화면(`/bookings/[id]/checkin`)만** `wifiSsid`·`wifiPassword`를 별도 select로 로드(ADMIN 권한 게이트 뒤). 
- QA leak-checklist에 항목 추가 권고: "`/p` 응답 JSON에 wifiPassword/wifiSsid 부재 확인" (qa 스킬 §교훈 축적).

### 4.4 AuditLog (글로벌 규칙 — 필수)

신규 변경 경로 전부 `writeAuditLog()` 동반:

| 변경 대상 | AuditLog `entity` | `action` |
|---|---|---|
| Villa 판매정보 스칼라(③④⑤토글·와이파이 등) | `"Villa"` | UPDATE |
| 침실 구성 추가/수정/삭제 | `"VillaBedroom"` | CREATE/UPDATE/DELETE |
| 셀링포인트 태그 추가/삭제 | `"VillaFeature"` | CREATE/DELETE |

> `entity` 문자열은 모델명과 일치(기존 `"Villa"`,`"VillaRate"` 관례). `wifiPassword` 변경도 AuditLog `changes`에 기록되나 — **AuditLog changes JSON에 평문 비번이 남는다**. 보안상 ZaloAccount.credentials 선례처럼 **`wifiPassword`는 changes에서 마스킹**(`{ old: "***", new: "***" }`) 권장 → §7 Q5.

---

## 5. SPEC.md F1 반영 초안 (그대로 붙일 수 있는 조각)

> 아래는 `docs/SPEC.md` F1 섹션에 추가할 마크다운. **이 문서에서는 SPEC.md를 수정하지 않음** — 승인 후 반영.

```markdown
### 판매용 정보 (v1.3 — ADR-0011, ADMIN 전용 입력)

빌라의 한국 판매를 위한 상세 정보. **입력 주체는 ADMIN**(테오 팀이 직접 취합 — 베트남 공급자 마법사 아님).
화면: ADMIN `/villas/[id]` 내 "판매정보" 편집 탭. 표시: `/p/[token]`(최우선)·`/villas/[id]`·`/my-villas/[id]`.

- **② 잠자리 구성(침실별)**: 침실마다 침대종류(킹/퀸/싱글/2층)·개수·수용인원. 엑스트라베드 가능은 빌라 단위 토글. (모델 `VillaBedroom`, `Villa.extraBedAvailable`)
- **③ 위치·접근성**: 구글맵 링크, 해변까지 거리(m), 전용면적(㎡), 층수. 모두 정수 저장.
- **④ 이용규칙**: 체크인/체크아웃 시간(분 단위 저장, 표시 "14:00"), 흡연·반려동물·파티 가능 토글, 주차 대수, 기준 보증금(VND), 와이파이 이름·비번.
- **⑤ 셀링포인트 태그**: 뷰(바다/마운틴/시티)·BBQ·엘리베이터·발전기·골프인근·키즈풀 등 다중선택. (사전 `lib/features.ts`, 모델 `VillaFeature`)
- ① 수영장은 현행 `hasPool` Y/N 유지(확장 안 함).

**누수 규칙**: 위 필드는 마진·판매가가 아니므로 공급자 노출 무방(누수 무관). **단 와이파이 비밀번호(`wifiPassword`)·이름(`wifiSsid`)은 `/p` 공개 제안페이지 노출 금지** — 체크인 화면 전용, select 화이트리스트로 차단.
```

---

## 6. ADR 초안 스케치 — **ADR-0011** (다음 순번 확인 완료)

> `docs/decisions/`에 ADR-0010까지 존재 → 신규 번호 **0011**. 파일명 제안: `docs/decisions/ADR-0011-villa-sales-fields.md`.

```markdown
# ADR-0011: 빌라 판매용 정보 필드 확장

## 상태
제안 (검토 중) — 2026-06-22

## 맥락
Villa 모델이 내부 운영(원가·가용성·검수)에 치우쳐 한국 판매용 정보가 부족. 테오 팀이 ADMIN 폼으로 직접 취합. 잠자리 구성·위치·이용규칙·셀링포인트 태그를 MVP에 추가.

## 결정
1. Villa에 판매정보 스칼라 13개 추가 (additive, 기존 컬럼 무변경).
2. ② 침실별 구성은 **별도 모델 `VillaBedroom`**(VillaPhoto/Amenity와 동일 1:N 패턴) — Json 아님.
3. ⑤ 셀링포인트는 **`VillaFeature` + `lib/features.ts` 사전**(VillaAmenity itemKey 패턴 재사용).
4. 단위 정수화: 해변거리=meter Int, 면적=㎡ Int, 층수 Int, 체크인/아웃=분 단위 Int(0~1439). 보증금=VND BigInt. **부동소수점 전면 금지**.
5. `wifiPassword`·`wifiSsid`는 `/p` 공개페이지 select 화이트리스트에서 제외(체크인 전용).
6. 변경 경로 전부 AuditLog(entity: Villa/VillaBedroom/VillaFeature). wifiPassword는 changes 마스킹.

## 근거
- 1:N 자식 모델: 기존 프로젝트 전 부속정보 관례와 정합 + 검증(enum/FK) + 향후 검색성.
- 분 단위 Int: "14:00" 문자열 대비 산술·검증 용이, DST 무관, 부동소수점 회피. @db.Time도 가능하나 프로젝트에 시간 타입 선례 없음·과설계.
- 정수 단위: 거리·면적은 표시 정밀도가 정수면 충분, 부동소수점 금지 원칙 준수.

## 대안 (기각)
- A. 침실 구성 Json: 검증·검색 불가, schema에 Json 구조 선례 없음 → 기각.
- B. 체크인 시간 String "14:00": 산술·검증 번거로움 → 기각.
- C. 셀링포인트를 VillaAmenity에 합침: 비치품목 vs 셀링포인트 의미 혼선, 불필요 quantity/unitPrice → 별도 모델로 분리.

## 영향
- additive 마이그레이션 1회(db push 무손실). 백필 불필요.
- 신규 ADMIN 편집 폼·VillaBedroom/VillaFeature CRUD 라우트·/p 표시·체크인 와이파이 표시.
```

---

## 7. 열린 질문 — **전부 해소 (2026-06-22 테오 확정 + TDA 기본값 확정)**

1. **Q1 — 침대 종류 범위:** ✅ **확정 — 6종** (KING·QUEEN·DOUBLE·SINGLE·TWIN·BUNK). 테오 결정(더블·트윈 추가). §1.2·§3.2 enum 반영 완료.
2. **Q2 — 침실 수용인원 모델링:** ✅ **확정 — 현 방식**(`VillaBedroom.capacity` 침대 행 단위, 같은 roomIndex 동일값 BE 검증). 별도 `VillaRoom` 정규화는 MVP 과설계로 보류(IDEAS 후보). TDA 결정.
3. **Q3 — 체크인/아웃 UI:** ✅ **확정 — 분 단위 Int 저장 + "14:00" 드롭다운(30분 단위)**. 자유입력 아님(오타 방지). TDA 결정.
4. **Q4 — 셀링포인트 사전:** ✅ §3.1 초기 12키로 시작. 사전이라 **ADMIN이 언제든 키 추가 가능**(custom 미허용·코드 추가). 테오 추가 태그 제안은 들어오는 대로 `lib/features.ts`에 반영.
4-b. **Q4-b — privatePool vs hasPool:** ✅ **확정 — `privatePool` 태그 유지**(강조 표시용, hasPool은 사실값으로 병존). 입력 폼에서 "수영장 있음=hasPool / 프라이빗 강조=태그"로 라벨 구분. TDA 결정.
5. **Q5 — wifiPassword AuditLog 마스킹:** ✅ **확정 — 마스킹 적용**(`changes`에 `{ old:"***", new:"***" }`, ZaloAccount.credentials 선례). TDA 결정.
6. **Q6 — googleMapUrl 검증:** ✅ **확정 — 최소 https URL 검증**(zod `.url()` + https 스킴). 도메인 화이트리스트는 과제약이라 미적용. TDA 결정.
7. **Q7 — 기준 보증금 통화:** ✅ **확정 — VND 고정**(`baseDepositVnd BigInt`). 테오 결정(달러 보증금 빌라 없음). 예외 발생 시 예약 단위 `Booking.depositCurrency`로 흡수 가능.

> **결론: 잔여 결정 0건. 설계 확정 — 구현 착수 가능 상태.**

---

## 부록 — 변경 요약 (additive 체크리스트)

- [ ] `Villa` 스칼라 +13 (googleMapUrl, beachDistanceM, areaSqm, floors, checkInTime, checkOutTime, smokingAllowed, petsAllowed, partyAllowed, parkingSlots, baseDepositVnd, wifiSsid, wifiPassword, extraBedAvailable) — 전부 nullable/default
- [ ] enum +2: `BedType`, `FeatureCategory`
- [ ] 모델 +2: `VillaBedroom`, `VillaFeature` (Villa 역관계 `bedroomDetails`, `features`)
- [ ] `lib/features.ts` 신규(사전+isValidFeature), `lib/bedding.ts` 신규(메타)
- [ ] i18n 키 추가(features.*, bedding.*, villaRules.*) — 추가만
- [ ] /p select 화이트리스트(wifi 제외), 체크인 화면 wifi 표시
- [ ] AuditLog: Villa/VillaBedroom/VillaFeature, wifiPassword 마스킹
- [ ] QA leak-checklist 항목 추가(/p에 wifiPassword 부재)
