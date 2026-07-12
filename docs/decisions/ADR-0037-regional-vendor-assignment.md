# ADR-0037 — 마사지·이발 주문의 빌라별 지역 지정 업체

- 상태: 채택 (2026-07-12)
- 관련: ADR-0023(원천 공급자 발주 게이트), ADR-0033(게스트 직접 발주), ADR-0019(부가서비스 카탈로그)
- 계약: `docs/contracts/guest-options-category-tabs-regional-vendor.md` (§2 지역 업체 자동 지정)

## 배경

BBQ·티켓·가이드·차량·조식 등 대부분의 부가서비스 업체는 푸꾸옥 섬 전체를 커버한다. 카탈로그 항목 1개에
원천 공급자(`ServiceCatalogItem.vendorId`) 1곳을 붙여 두면 어느 빌라의 주문이든 그 업체로 발주하면 된다.

그러나 **마사지·이발은 지역 분포 업체**다 — 출장·방문 반경이 좁아, 발주가 들어온 빌라에서 **가까운 샵**으로
지정돼야 한다(테오 지시). 한 마사지 카탈로그 항목이 섬 전역의 모든 빌라 주문을 한 업체로 몰면 이행이 불가능하다.
"빌라 → 가까운 샵" 구분자가 필요하다.

## 결정

### 1. 빌라×타입 매핑 테이블 + 생성 시 해석·스냅샷

- **스키마(additive)**: `VillaServiceVendor { id, villaId, serviceType, vendorId, createdAt }`,
  `@@unique([villaId, serviceType])`. 빌라·타입당 지정 업체 1곳. villaId·vendorId 모두 Cascade.
  raw SQL(`prisma/migrations-manual/2026-07-12-villa-service-vendor.sql`) + `prisma generate`로 라이브 반영.
- **해석기**: `lib/regional-vendor.ts`
  - `REGIONAL_VENDOR_TYPES = ["MASSAGE", "BARBER"]` — 지역 분포 타입 단일 상수(그 외 타입은 섬 전체 커버).
  - `resolveOrderVendorId({ itemType, itemVendorId, villaId })`:
    지역 타입이 아니거나 villaId가 없으면 **조회 없이** `itemVendorId` 그대로.
    지역 타입이면 `VillaServiceVendor` 조회 → 있으면 그 vendorId, 없으면 `itemVendorId` 폴백.
- **적용 지점 = 주문 생성 3경로**(벤더 스냅샷 저장 경로 전부):
  운영자 `bookings/[id]/service-orders`, 파트너 `p/[token]/service-orders`, 게스트 `g/[token]/service-orders`.
  해석 결과를 `ServiceOrder.vendorId` 스냅샷으로 저장한다(기존 주문 소급 없음 — 스냅샷 원칙).

### 2. 게스트 자동 발주 대상도 함께 교체 (ADR-0033 연동)

게스트 경로는 카탈로그 벤더의 승인·활성·Zalo 연결로 자동 발주(PENDING_VENDOR + Zalo)를 판정한다.
지역 업체로 오버라이드된 경우, **그 업체 엔티티를 같은 select로 재조회**해 자동 발주 판정과 발송 대상을 함께
교체한다(카탈로그 기본 벤더로 판정·발송하면 잘못된 업체에 발주됨). 재조회 select는 `bankInfo`·마진 미포함.

### 3. 운영자 지정 UI = 빌라 상세

빌라 상세(admin)에 "지역 지정 업체" 카드(cleaner-assign 패턴) — 마사지·이발 2행, 각 행 업체 select +
"지정 안 함(카탈로그 기본)". API `PUT /api/villas/[id]/service-vendors`는 role 가드(isOperator) +
serviceType은 `REGIONAL_VENDOR_TYPES`만 허용(400) + vendorId는 APPROVED·active 검증, null=해제(delete).
upsert/delete마다 `writeAuditLog`(entity `VillaServiceVendor`). 응답·후보 목록은 id·name만(누수 0).

## 누수 경계

- 신규 API 응답은 `serviceType`·`vendorId`만. 후보 목록은 `id`·`name`만 — bankInfo·판매가·마진 없음.
- 게스트 경로의 벤더 재조회 select는 자동 발주 판정에 필요한 최소 필드(id·userId·approvalStatus·active·
  user.zaloUserId·locale)만 — 기존 카탈로그 벤더 select와 동일 shape.
- Zalo 발주 문구 불변(발송 대상 vendor만 교체).

## 대안 검토

- (기각) **complex(단지) 단위 매핑**: 같은 단지라도 빌라별로 가까운 샵이 다를 수 있어 정밀도 부족.
  빌라 단위가 발주 이행의 최소 단위.
- (기각) **벤더에 담당 지역 목록을 두고 역방향 조회**: 주문마다 빌라 위치 → 벤더 커버리지 매칭이 복잡하고,
  운영자가 "이 빌라는 이 샵" 직관과 어긋난다. 명시적 빌라×타입 매핑이 단순·명확.

## 결과

- `lib/regional-vendor.ts`(해석기·상수), 주문 생성 3경로 vendorId=해석 결과, 게스트 자동 발주 대상 교체.
- 운영자 빌라 상세 "지역 지정 업체" 에디터 + `PUT /api/villas/[id]/service-vendors`(감사로그).
- 기존 주문 소급 없음. 벤더 화면·발주 문구 변경 없음. 비지역 타입은 로직 무영향(조회 생략, 카탈로그 기본 그대로).
