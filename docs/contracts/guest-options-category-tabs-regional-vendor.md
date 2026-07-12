# 계약: 소비자 옵션 페이지 카테고리 탭 + 마사지·이발 지역 업체 자동 지정

- 상태: 착수 선점 (2026-07-12) — ★선행 의존: ticket-passport-info-to-vendor PR 머지 후 착수
  (guest-options.tsx·g/service-orders route를 공유하므로 순차 진행)
- 브랜치(예정): wt/options-tabs-regional-vendor
- 배경(테오 지시):
  1. 소비자 부가 옵션 신청 페이지에 카테고리 탭 필요(운영자 카탈로그 화면과 같은 전체/BBQ/티켓/... 구조).
  2. 마사지·이발은 지역 분포 업체라, 발주가 들어온 **빌라에서 가까운 샵으로 자동 지정**돼야 함.
     나머지 서비스 타입은 푸꾸옥 전체 커버라 해당 없음. "빌라 → 가까운 마사지/이발소" 구분자 필요.

## 설계 (TDA)

### 1. 카테고리 탭 (게스트 UX)
- `/g/[token]/options`에 ServiceType 탭(전체 + 카탈로그에 실존하는 타입만, 건수 뱃지). 라이트 테마·모바일.
- 타입 라벨은 GUEST_LABELS(lib/guest-i18n.ts) 전 언어. 클라 필터(카탈로그는 이미 전량 로드됨 — 추가 API 없음).

### 2. 지역 업체 자동 지정 (MASSAGE·BARBER만)
- **스키마(additive)**: `VillaServiceVendor { id, villaId, serviceType, vendorId, createdAt }`
  `@@unique([villaId, serviceType])`. 빌라별·타입별 지정 업체 1곳. raw SQL + migrations-manual 보존.
- **판정 상수**: `REGIONAL_VENDOR_TYPES = ["MASSAGE","BARBER"]` (lib) — 그 외 타입은 조회 자체 생략.
- **해석 규칙**: 주문 생성 시 `resolveOrderVendor(item, villaId)` = 지정 매핑 있으면 그 업체,
  없으면 카탈로그 기본 `item.vendorId` 폴백. 적용 지점 3곳(벤더 스냅샷 생성 경로 전부):
  - `app/api/bookings/[id]/service-orders/route.ts` (운영자)
  - `app/api/g/[token]/service-orders/route.ts` (게스트 — ★자동 발주 판정도 해석된 업체 기준: 승인·활성·Zalo)
  - `app/api/p/[token]/service-orders/route.ts` (파트너)
- **운영자 지정 UI**: 빌라 상세(admin)에 "지역 지정 업체(마사지·이발)" 에디터 — cleaner-assign-editor 패턴.
  후보 = APPROVED·active 벤더. 해제(미지정=카탈로그 기본) 가능. API는 role 가드 + 감사로그.
- 기존 주문 소급 없음(스냅샷 원칙). 벤더 화면 변경 없음.

## 수정 금지 구역
- ticket-passport 작업 완료 전 guest-options.tsx·g/service-orders route 착수 금지(순차).
- Zalo 문구·판매가/마진 경계 불변.

## 완료 기준 (QA)
- [ ] 게스트 옵션 페이지 카테고리 탭 동작(타입 필터·건수·전체), 5언어 라벨
- [ ] MASSAGE/BARBER 주문 생성 시 빌라 지정 업체로 vendorId 스냅샷(3경로), 미지정 시 카탈로그 기본
- [ ] 게스트 자동 발주가 지정 업체의 승인·활성·Zalo 기준으로 판정
- [ ] 다른 타입(BBQ 등)은 지정 로직 미적용(카탈로그 기본 그대로)
- [ ] 운영자 빌라 상세에서 지정·해제 가능 + AuditLog
- [ ] 누수 0(벤더 응답 shape 불변), next build 통과
