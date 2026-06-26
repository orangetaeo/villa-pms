# 계약서 — 부가서비스 원천 공급자 중계 (ADR-0023)

- 브랜치: `wt/addon-vendor` (격리 worktree)
- 정본: docs/decisions/ADR-0023-addon-source-vendor-brokerage.md / SPEC F11
- 상태: **착수 선점** (2026-06-26)

## 범위 (전체 4스프린트)

- **S1** — ServiceVendor 엔티티 + 카탈로그 연결 + 과일 시드 ← **이번 작업**
- S2 — 발주 게이트 + Zalo 발송
- S3 — `/vendor` 대시보드(vi)
- S4 — 채널 요청 + 공급자 통계 + 누수 QA

## S1 상세 범위 (이번 작업)

### 스키마 (additive raw SQL ALTER — `prisma db push` 금지)
1. `enum Role` += `VENDOR`
2. `enum ServiceType` += `FRUIT`
3. `enum ServiceRequestedVia` += `PARTNER`
4. `enum ServiceVendorStatus { PENDING_VENDOR | VENDOR_ACCEPTED | VENDOR_REJECTED }` (신규, S2서 사용 시작 — 정의만)
5. 신규 테이블 `ServiceVendor`
6. `ServiceCatalogItem` += `vendorId String?` (FK ServiceVendor), `audiences Json @default(["ADMIN"])`
7. `ServiceOrder` += `vendorId`·`vendorStatus`·`poSentAt`·`vendorRespondedAt`·`vendorRejectReason`·`vendorSettledAt`·`vendorSettleMethod`·`vendorSettleNote` (컬럼만 추가, 로직은 S2)

### API / 로직
- `GET/POST /api/vendors` · `PATCH/DELETE /api/vendors/[id]` — 운영자 전용(canManage), `writeAuditLog()` 필수
- 카탈로그 CRUD(기존 `/api/services` 계열)에 `vendorId`·`audiences` 입력 반영 + 서버 검증
- 과일 바구니·도시락 시드(prisma/seed 또는 별도 스크립트), 기존 서비스 `audiences` 기본 백필

### 화면
- `/settings/vendors` — 운영자 공급자 목록·생성·수정·비활성 (다크, ko, 반응형)
- `/settings/services` 폼에 원천 공급자 셀렉트 + 요청 가능 채널(audiences) 체크박스

### 완료 기준 (테스트 가능)
- [ ] 라이브 DB에 enum 4종·ServiceVendor 테이블·신규 컬럼 적용(`\d "ServiceVendor"` 확인) — additive, 기존 데이터 무손상
- [ ] `prisma generate` 통과, `npx next build` 통과, `npm run typecheck` 0 에러
- [ ] 운영자가 공급자 CRUD 가능(AuditLog 기록 확인)
- [ ] 카탈로그 항목에 공급자·audiences 저장/표시
- [ ] 과일 바구니(audiences=[ADMIN,PARTNER])·도시락(=[ADMIN,PARTNER,GUEST]) 시드 존재
- [ ] 누수 스캔: 비운영자 카탈로그 GET 응답에 `costVnd`·`vendorId`(공급자 신원)·`bankInfo` 미포함

### 검증 방법
- `lib/service-catalog`·`/api/vendors` 단위 테스트 + grep 누수 스캔(costVnd/bankInfo 화이트리스트) + next build

## 수정 금지 구역 (다른 세션 작업 보호)
- 격리 worktree(`wt/addon-vendor`)에서만 작업. 공유 메인 폴더 직접 커밋 안 함.
- 라이브 DB는 **additive ALTER만**(DROP·컬럼 변경·`db push` 금지 — [[db-schema-drift-villa-source]]).
- supplier-direct(ADR-0021)·partner-b2b(ADR-0022) 미커밋 작업 파일 비간섭.
