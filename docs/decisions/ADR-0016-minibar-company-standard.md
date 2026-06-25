# ADR-0016 — 미니바 회사표준 모델 전환 (#2b)

- 상태: 채택 (2026-06-25)
- 관련: #2a(공급자 미니바 노출 차단, d0de488), 원칙2(마진·판매가 공급자 비노출), [[db-schema-drift-villa-source]]

## 배경

미니바는 우리 회사가 직접 운영한다(공급자 미관여). 기존 모델은 미니바를 빌라별 `VillaAmenity(category=MINIBAR, unitPrice)`로 저장했다. `unitPrice`는 **고객 청구 단가 = 우리 판매가**인데, 공급자가 빌라별 amenities를 편집·열람하는 경로에 얹혀 있어 원칙2(마진 비공개) 위반 위험이 구조적으로 상존했다(#2a에서 입력·열람은 막았으나 데이터 형태는 그대로).

테오 결정(2026-06-25):
- **(a) 완전 통일 1세트** — 빌라별 오버라이드 없음. 전 빌라 동일 표준 미니바.
- **시드 없이 CRUD 먼저** — `/settings/minibar`에서 품목·단가 직접 입력.
- **체크아웃 = 소모 수량 직접 입력** — 표준 모델엔 빌라 비치수량이 없으므로 "남은 수량 역산"을 폐기.

## 결정

빌라별 미니바를 **회사표준 단일 세트 `MinibarItem`**으로 분리한다.

- `MinibarItem(id, itemKey @unique, nameKo, nameVi?, unitPriceVnd BigInt, sortOrder, active, timestamps)`.
- **`villaId` 없음** — 공급자 쿼리(빌라 스코프)가 구조적으로 도달 불가. 누수를 코드 규율이 아니라 데이터 형태로 차단.
- `unitPriceVnd` = 우리 판매가. 운영자(`canSetPrice`)만 읽기·쓰기. 공급자·공개(/p) 라우트는 일절 참조 금지.

## 변경 범위

- **DB**: `MinibarItem` 테이블 raw SQL CREATE(`prisma db push` 금지 — Villa.source 드리프트 드롭 회피). 기존 `VillaAmenity(MINIBAR)` 행은 백업(S0) 후 단계적 폐기(S3).
- **관리**: `/api/admin/minibar` CRUD(AuditLog 필수) + `/settings/minibar` UI.
- **체크아웃**: `MinibarItem(active)` 표준 목록 → 소모 수량 직접 입력. 차감액 = 소모 × `unitPriceVnd`(BigInt). **차감 BE(`lib/checkout.ts`·checkout route)는 최종 deductionVnd만 받으므로 무변경**(과거 기록 보존).
- **빌라 편집/생성**: amenities 편집기·마법사·`PATCH/POST /api/villas`에서 MINIBAR 분기 제거(누가 보내도 drop). zod enum의 MINIBAR는 유지(마법사 호환). 레거시 행은 비-MINIBAR 스코프 deleteMany로 S3까지 보존.
- **소비처**: 체크인 시트 미니바 표를 `MinibarItem` 표준 목록으로 전환. Zalo 빌라 공유 amenities select에 `category != MINIBAR` 필터(공급자 공유 명칭 누수 차단).

## 마이그레이션 순서 (엄수)

`S0 백업 → S1 CREATE TABLE → 코드 배포 → 검증 → 테오 표준 품목 입력 완료 → S3 DELETE`.
S3(`DELETE FROM VillaAmenity WHERE category='MINIBAR'`)는 **배포·검증·표준입력 후에만** 수동 실행. SQL: `prisma/migrations-manual/2026-06-25-minibar-company-standard.sql`.

## 대안 (기각)

- (b) 빌라별 미니바 차이 허용 / (c) 빌라별 오버라이드 — 테오 "완전 통일"로 기각.
- `AmenityCategory.MINIBAR` enum·`VillaAmenity.unitPrice` 컬럼 제거 — 다른 카테고리 무영향·enum drop 위험으로 이번 범위 밖(후속 cleanup). 행 DELETE까지만.
- 미니바 소모 구조화 저장(MinibarConsumption) — 현행 damageNote 텍스트 유지, 범위 밖.

## 결과

- 미니바 판매가는 `villaId` 없는 테이블에만 존재 → 공급자·공개 경로에서 구조적으로 도달 불가(원칙2 강제).
- 전 빌라 공통 1세트로 운영 단순화. 체크아웃은 소모 수량 직접 입력으로 통일.
- 단위테스트: CRUD 권한·AuditLog·BigInt 직렬화·누수 정적 가드(공급자·공개 트리 `minibarItem` 미참조).
