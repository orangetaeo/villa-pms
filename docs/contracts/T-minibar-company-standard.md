# T-minibar-company-standard — 미니바 회사표준 모델 전환 (#2b)

## 배경 / 결정
테오 #2: 미니바는 우리 회사 직접 운영. #2a(d0de488)에서 공급자 입력·열람 차단 완료.
#2b는 미니바를 **빌라별(VillaAmenity.MINIBAR) → 회사 표준 1세트(MinibarItem)**로 재설계.
TDA 설계(ADR 신설 대상) + 테오 결정(2026-06-25):
- **(a) 완전 통일 1세트** — 빌라별 오버라이드 없음. 전 빌라 동일 표준 미니바.
- **시드 없이 CRUD UI 먼저** — 테오가 `/settings/minibar`에서 품목·단가 직접 입력.
- **체크아웃 입력 = 소모 수량 직접 입력** (표준 모델엔 빌라 비치수량 없음 → 역산 폐기).

## 핵심 실측 (재배선 범위 작음)
체크아웃 차감 BE(`lib/checkout.ts completeCheckout`·`/api/bookings/[id]/checkout`)는 **미니바 비의존** — 최종 `deductionVnd` 한 값만 받아 `CheckOutRecord`에 기록. 미니바 합산은 전부 클라(`checkout-form.tsx`). → **차감 API·lib·CheckOutRecord 무변경, 과거 기록 보존.**

## 범위
1. **스키마(additive)**: `MinibarItem` 모델 — `id·itemKey·nameKo·nameVi?·unitPriceVnd BigInt·sortOrder·active·createdAt·updatedAt`. **villaId 없음**(전 빌라 공통 → 공급자 쿼리 구조적 도달 불가). `@@index([active, sortOrder])`. **prod raw SQL CREATE TABLE**(db push 금지, 드리프트 드롭 회피).
2. **관리 API**: 신규 `GET/POST/PATCH/DELETE /api/admin/minibar` — 쓰기 `canSetPrice`(또는 `isOperator`), 읽기 `isOperator`. AuditLog 필수. unitPriceVnd=우리 판매가.
3. **관리 UI**: 신규 `app/(admin)/settings/minibar/page.tsx` — 표준 미니바 CRUD(품목·nameKo/Vi·단가·정렬·active 토글). i18n ko/vi.
4. **체크아웃 재배선**: `checkout/page.tsx` 쿼리를 `villa.amenities(MINIBAR)` → `minibarItem.findMany({active:true})`. `checkout-form.tsx`를 "소모 수량 직접 입력"으로(역산 제거). 라인 = 소모×unitPriceVnd. 합계는 현행대로 damageNote+deductionVnd 전송(**BE 무변경**).
5. **빌라 편집 미니바 제거**: `villas/[id]/amenities-editor.tsx` MINIBAR 탭 + `villas/[id]/page.tsx` MINIBAR prefill + `api/villas/[id]/amenities/route.ts` MINIBAR 분기 제거(미니바는 더 이상 빌라별 아님). zod enum의 MINIBAR는 유지(행 분기만 제거 — 마법사 호환).
6. **누락 소비처 2곳 처리 (QA 캐치 — 필수)**:
   - `app/(admin)/bookings/checkin-sheet/page.tsx` — 미니바 정산표가 `villa.amenities(MINIBAR, unitPrice)`를 읽음. **MinibarItem 표준 목록으로 전환**(빌라별→공통). S3 폐기 후 빈 표 회귀 방지.
   - `app/api/zalo/conversations/[id]/share/route.ts` — villa amenities를 **category 필터 없이** 읽어 공유 메시지 `amenityLabels`에 미니바 품목명 노출(공급자 공유 포함). **`category: { not: "MINIBAR" }` 필터 추가** — 미니바는 회사 운영이라 공급자 공유에서 제외(전환기 명칭 누수 차단). 미니바를 공유에 넣지 않음(가격 없어도 "공급자 미관여" 원칙).
7. **마이그레이션(순서 엄수)**: S0 백업(`_backup_minibar_amenity_*` CREATE TABLE AS) → S1 MinibarItem CREATE TABLE → 코드 배포(읽기 MinibarItem 전환 + 소비처 2곳 처리) → 검증 → **테오가 `/settings/minibar`에 표준 품목 입력 완료 확인(빈 목록 구간 종료)** → S3 `DELETE FROM VillaAmenity WHERE category='MINIBAR'`. **폐기는 배포·검증·표준입력 후.** raw SQL.
8. i18n·단위테스트·QA.

## 범위 밖
- `AmenityCategory.MINIBAR` enum·`VillaAmenity.unitPrice` 컬럼 **제거 안 함**(다른 카테고리 무영향, enum drop 위험). 행 DELETE까지만. 컬럼/enum cleanup은 후속 별도.
- 미니바 소모 구조화 저장(MinibarConsumption) — 현행 damageNote 텍스트 유지, 범위 밖.
- 빌라별 미니바 차이(b/c안) — (a) 완전통일 확정.

## 수정 금지 구역 (병렬)
- `lib/checkout.ts`·`app/api/bookings/[id]/checkout/route.ts` — **무변경**(차감 BE 미니바 비의존).
- `app/(admin)/users/*`·`auth.ts`·`app/api/users/*` — 타 세션 활성 영역, 비접촉.
- agreement-editor 세션(`bookings/[id]/checkin/*`) 무관.
- 공유 파일 `messages/*.json`·`prisma/schema.prisma` 추가-only + [[shared-git-index-private-commit]] 전용 인덱스 커밋(공유 인덱스 점유 중).

## 완료 기준 (테스트 가능)
- [ ] `MinibarItem` 테이블 prod 생성·검증(Prisma 쿼리 작동). 스키마 파일 정합.
- [ ] `/settings/minibar` CRUD: 운영자만(401/403), 품목 추가·단가 수정·active 토글·삭제 동작, AuditLog 기록.
- [ ] 체크아웃 페이지가 MinibarItem 표준 목록 표시(전 빌라 동일), 소모 수량 입력→차감 합산 정확(소모×단가 BigInt). BE 차감 API 무변경 회귀 0.
- [ ] 빌라 편집/상세에 MINIBAR 탭·단가 미표시(제거 확인). amenities PATCH MINIBAR 분기 제거.
- [ ] 누수 0: MinibarItem(우리 판매가)이 공급자·공개(/p) 라우트에 미노출(villaId 없어 구조적 차단 + import 0). 단위테스트로 검증.
- [ ] **Zalo 공유에 미니바 제외**: `share/route.ts`가 MINIBAR/MinibarItem을 공급자측 공유 amenityLabels에 끌어오지 않음(category 필터). 단위테스트로 검증.
- [ ] **체크인 시트 미니바 표 MinibarItem 전환**: S3 폐기 후에도 미니바 정산표 정상 렌더(빈 표 회귀 0).
- [ ] per-villa MINIBAR 행 폐기(배포·검증 + **표준 품목 입력 완료** 후). 백업 테이블 존재.
- [ ] typecheck 0, `npm test` 그린, `next build` 통과.

## 검증
- 단위테스트: minibar CRUD 권한·AuditLog, 체크아웃 소모×단가 합산, 누수(공급자 라우트 MinibarItem 미참조).
- QA 독립 평가: 운영자 CRUD·체크아웃 회귀·빌라편집 미니바 제거·누수 실증.

## 단계 / 담당
S0 백업+S1 테이블(TDA raw SQL) → BE(CRUD API·체크아웃 쿼리·amenities 정리) → FE(settings/minibar·checkout-form 소모입력·빌라편집 탭제거) → QA 독립 → S3 폐기 → PM 보고. ADR 신설(미니바 회사표준 전환).
