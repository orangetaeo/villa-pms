# Contract: T-villa-cleaner-assign — 빌라별 청소 담당자 지정

## 배경
지역이 넓어 한 청소직원이 전 빌라를 못 함 → 빌라별 청소 담당(assignee)을 지정해야 함. 당분간은 빌라공급업체가 청소(현재 기본=supplier 폴백), 추후 회사 직원(CLEANER)으로 전환.

## 모델
- `Villa.cleanerId`(담당 CLEANER, nullable). 미지정이면 기존대로 공급자 담당.
- 청소 태스크 생성(체크아웃·정기) 시 `assigneeId = villa.cleanerId ?? null`. 알림도 `cleanerId ?? supplierId`.
- 담당 지정/변경 시 그 빌라의 미완료 청소(PENDING/REJECTED/PHOTOS_SUBMITTED) 즉시 재배정(APPROVED는 이력 보존).

## 범위 (수정/신규 파일)
- DB additive: `ALTER TABLE "Villa" ADD COLUMN "cleanerId" TEXT` (라이브 멱등)
- `prisma/schema.prisma`: Villa.cleanerId + cleaner User?@relation("VillaCleaner"), User.assignedVillas Villa[]@relation("VillaCleaner") + generate
- `lib/cleaning.ts`: createCheckoutCleaningTask·createPeriodicCleaningTasks — villa.cleanerId select, assigneeId·알림 대상 반영
- 신규 `app/api/villas/[id]/cleaner/route.ts` — PATCH: isOperator, cleanerId 설정(CLEANER·미삭제 검증), 미완료 재배정, AuditLog
- 신규 `app/(admin)/villas/[id]/cleaner-assign-editor.tsx` — 담당자 select(CLEANER 목록 + 미지정)
- 수정 `app/(admin)/villas/[id]/page.tsx` — CLEANER 목록 조회 + 카드 렌더
- i18n `messages/ko.json`·`vi.json` 키 추가만

## 수정 금지 구역
- prisma/* seed, 검수(approve/reject) 권한 로직, 누수 경계(고객정보·가격)

## 완료 기준 (테스트 가능)
1. 관리자가 빌라에 청소 담당자 지정 → 그 빌라 미완료 청소가 담당자 리스트에 즉시 노출, 신규 체크아웃 청소도 담당자에 배정·알림
2. 미지정(공급자 담당)으로 되돌리면 미완료 청소 assigneeId=null(공급자 노출)
3. cleanerId는 role=CLEANER·미삭제 사용자만 허용(검증)
4. 누수 0, 기존 supplier 폴백 동작 보존
5. typecheck·lint·build 0, 독립 QA PASS

## 검증
typecheck/lint/build + 독립 QA + (배포 후) 데모 확인
