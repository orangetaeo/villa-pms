# ADR-0038 — 업체 담당 지역(다중) 커버리지와 지역 업체 자동 지정

- 상태: 채택 (2026-07-12)
- 관련: ADR-0037(빌라별 지역 지정 업체 — 본 ADR이 해석 단계를 확장), ADR-0023, ADR-0033
- 계약: `docs/contracts/vendor-region-coverage.md`

## 배경

ADR-0037의 빌라×타입 1:1 수동 지정(`VillaServiceVendor`)은 빌라 수가 늘수록 운영자가 빌라마다
업체를 지정해야 해서 확장성이 없다(테오 지시, 2026-07-12). 반대로 업체 등록 시 **담당 지역을
다중 선택**해 두면, 그 지역 빌라의 주문은 자동으로 그 업체로 발주된다. 한 지역에 업체가 2~3곳
생기는 시점에는 기존 빌라별 수동 지정으로 특정 샵을 고르는 방식이 다시 유효하다 — 두 방식은
대체가 아니라 **우선순위 계층**으로 공존한다.

지역의 정의는 새 필드를 만들지 않고 기존 확정 기준을 재사용한다: **지역 = `Villa.complex`(단지명)**
(테오 확정 2026-06-23, 공실보드·검색 필터와 동일 기준).

## 결정

### 1. 스키마(additive): `ServiceVendorRegion` — 업체×타입×지역 커버리지

```prisma
model ServiceVendorRegion {
  id          String        @id @default(cuid())
  vendorId    String
  vendor      ServiceVendor @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  serviceType ServiceType   // REGIONAL_VENDOR_TYPES(MASSAGE·BARBER)만 API에서 허용
  region      String        // Villa.complex 값 (지역=단지명 정본)
  createdAt   DateTime      @default(now())

  @@unique([vendorId, serviceType, region])
  @@index([serviceType, region])
}
```

- raw SQL(`prisma/migrations-manual/2026-07-12-service-vendor-region.sql`)로 라이브 적용 + `prisma generate`.
- region은 자유 문자열이 아니라 **운영 빌라의 distinct complex 목록에서 선택**(UI 강제). 단지명 개명은
  드물고, 개명 시 커버리지 재선택으로 해소(FK 아님 — complex 자체가 Villa의 자유 문자열이므로 대칭).

### 2. 주문 벤더 해석 3단계 (lib/regional-vendor.ts 확장)

`resolveOrderVendorId` — 지역 타입(마사지·이발) + villaId 존재 시:

1. **빌라별 수동 지정**(`VillaServiceVendor`) 있으면 최우선 — 항상 지역 매칭을 이긴다.
2. 없으면 `villa.complex` 조회 → complex가 있고, `ServiceVendorRegion`에서
   `serviceType + region=complex` 이고 벤더가 `active && approvalStatus=APPROVED`인 업체가
   **정확히 1곳**이면 그 업체로 자동 지정.
3. 그 외(complex 없음, 매칭 0곳, 매칭 2곳 이상)는 카탈로그 기본(`item.vendorId`) 폴백 — 기존 동작.

- 매칭 2곳 이상을 자동 지정하지 않는 이유: 어느 샵인지의 판단은 운영자 몫(1단계로 해소). 임의
  선택(첫 번째 등)은 발주 오류가 되고 소급 불가(스냅샷 원칙).
- 주문 생성 3경로(운영자·파트너·게스트) 공유 해석기 유지, `ServiceOrder.vendorId` 스냅샷 원칙 유지,
  게스트 자동 발주 대상 교체(ADR-0037 §2) 로직 불변 — 해석 결과만 달라진다.

### 3. 운영자 UI·API

- 업체 관리 화면(`(admin)/settings/vendors`)에서 업체별 "담당 지역" 편집 — 마사지·이발 타입별로
  distinct complex 다중 선택(체크/칩). 옵션 목록은 운영 빌라의 distinct complex.
- `PUT /api/vendors/[id]/regions` body `{ coverage: [{ serviceType, regions: string[] }] }` —
  타입별 replace-set. 가드: isOperator, serviceType은 REGIONAL_VENDOR_TYPES만(400), 변경마다
  `writeAuditLog`(entity `ServiceVendorRegion`). 응답에 bankInfo·원가·마진 없음.
- 빌라 상세 "지역 지정 업체" 카드의 "지정 안 함(카탈로그 기본)" 문구를 "지정 안 함(지역 자동/카탈로그 기본)"으로
  갱신 — 실제 유효 업체가 지역 매칭으로 결정될 수 있음을 표기.

## 누수 경계

- 신규 API 응답은 serviceType·region 목록만. 후보 지역 목록은 complex 문자열만 — 금액·계좌 없음.
- 해석기 벤더 필터 select는 vendorId만(기존과 동일 최소 shape).

## 대안 검토

- (기각) `ServiceVendor.regions String[]` 단일 배열: 타입 구분(마사지 겸 이발 업체의 타입별 반경 차이)
  불가, 조회 인덱스 비효율. 테이블이 타입별 커버리지·감사 추적에 명확.
- (기각) 매칭 2곳 이상일 때 임의 자동 선택: 스냅샷 소급 불가 구조에서 오발주 위험 > 자동화 이득.
- (유지) ADR-0037의 빌라×타입 수동 지정 — 폐기하지 않고 1단계 오버라이드로 존치.
