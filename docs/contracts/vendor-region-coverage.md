# 계약: 업체 담당 지역(다중) 기반 지역 업체 자동 지정 (vendor-region-coverage)

- 상태: 착수 (2026-07-12)
- 담당: 메인 세션(설계) + BE/FE/QA 서브에이전트
- 관련: ADR-0037(빌라별 지역 지정 업체) 개정, [[region-filter-uses-villa-complex]]

## 배경 (테오 지시)

빌라×타입 1:1 수동 지정(VillaServiceVendor)은 빌라 수가 늘면 빌라마다 지정해야 해서 불편.
업체(ServiceVendor) 등록 시 **담당 지역을 다중 선택**하면, 그 지역의 빌라 주문에 자동 지정되게 한다.
지역 구분 = **빌라가 등록되어 있는 지역 = Villa.complex(단지명)** (2026-06-23 확정 기준 재사용, 새 필드 신설 금지).
추후 한 지역에 업체가 2~3개 생기면 기존 빌라별 수동 지정 방식으로 고르는 것도 유지.

## 범위

1. **스키마(additive)**: `ServiceVendorRegion { vendorId, serviceType, region }` — vendor×타입×지역(complex) 커버리지.
   raw SQL(`prisma/migrations-manual/`) + `prisma generate`. `prisma migrate dev`/`db push` 금지.
2. **해석기 3단계화** (`lib/regional-vendor.ts` resolveOrderVendorId):
   ① 빌라별 수동 지정(VillaServiceVendor) 최우선 → ② villa.complex와 일치하는 활성·승인 업체가 **정확히 1곳**이면 자동 지정
   → ③ 그 외(0곳 또는 2곳 이상)는 카탈로그 기본(item.vendorId) 폴백. 주문 생성 3경로 공유 유지, 스냅샷 원칙 유지.
3. **운영자 UI**: 업체 등록/수정 화면에 "담당 지역" 설정(마사지·이발 타입별 complex 다중 선택, distinct complex 옵션).
4. **게스트 자동 발주 연동**: 오버라이드 업체 재조회 판정(ADR-0037 §2) 그대로 — 해석기 결과만 달라짐.
5. ADR-0037 개정(또는 신규 ADR) + 테스트(`tests/regional-vendor.test.ts` 확장).

## 완료 기준

- 업체에 지역만 등록하면(수동 지정 없이) 해당 complex 빌라의 마사지·이발 주문 vendorId가 그 업체로 스냅샷됨
- 같은 지역·타입에 커버 업체 2곳이면 자동 지정하지 않고 카탈로그 기본 폴백(빌라별 수동 지정으로 해소 가능)
- 기존 빌라별 수동 지정이 지역 매칭보다 항상 우선
- 누수 0: 신규 API 응답에 bankInfo·원가·마진 없음. 권한 가드(isOperator)
- `next build` 통과, 기존 주문 소급 없음

## 수정 금지 구역

- 다른 계약서 진행 중 파일. 공유 파일(messages/*.json)은 키 추가만.
