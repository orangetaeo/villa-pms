# T-amenity-quantity-custom — 비품·시설 수량 입력 + 직접입력(custom) 전 카테고리 확장

- 상태: 진행 중 (2026-07-10 착수, worktree `worktree-amenity-quantity-custom`)
- 요청: 빌라 등록 시 비품·시설에 **수량**을 입력하게 하고(관리인이 정확한 수량 입력 → 자사 데이터 활용),
  **직접입력 텍스트 박스**(+수량 필수)를 추가. 베트남어로 입력된 직접입력 항목을 관리자 페이지에서
  어떻게 표시할지 처리 방안 포함.

## 배경 (탐색 결과)

- `VillaAmenity`는 이미 `quantity Int @default(1)` + `customLabel String?`(itemKey="custom") 지원 — 스키마는 번역 컬럼 1개만 추가하면 됨.
- 마법사 `step-amenities.tsx`는 미니바 외 카테고리를 있음/없음 토글(수량 고정 1)로만 사용.
- 직접입력(custom)은 `lib/amenities.ts CUSTOM_ALLOWED_CATEGORIES = ["MINIBAR"]`로 미니바에만 허용 — 그런데 미니바는 회사표준 분리(#2b)로 서버가 silent drop → 사실상 custom 사용 불가 상태.
- 관리자 편집기(`amenities-editor.tsx`)는 이미 +/− 스테퍼로 수량 지원. 단 **custom 행을 건너뛰고 전체교체 PATCH** → custom 확장 시 관리자 저장이 공급자 직접입력을 삭제하는 함정. 반드시 함께 수정.
- 공급자 수정 화면 = 마법사 재사용(PUT /api/villas/[id]) → 마법사만 고치면 등록·수정 모두 해결.
- 번역: `lib/gemini.ts translateText(text, "ko")` 재사용 (숫자 보존 가드·재시도 내장). Zalo `captionTranslated` 저장형 패턴 준용.

## 설계 결정 (TDA)

1. **수량 UI**: 사전 항목 타일 선택 시 수량 1로 시작, 선택된 타일에 +/− 스테퍼 노출(1~99). 텍스트 입력 없음(터치 중심). 0이 되면 선택 해제.
2. **직접입력**: `CUSTOM_ALLOWED_CATEGORIES`에 KITCHEN·BATHROOM·APPLIANCE 추가. 각 카테고리 탭 하단에 "직접 추가" 섹션 — 텍스트 입력(vi, 최대 60자) + 수량 스테퍼(기본 1, 필수) + 추가 버튼 + 추가된 항목 리스트(수량 조절·삭제). 카테고리당 최대 10개.
3. **번역 컬럼**: `VillaAmenity.customLabelKo String?` (additive raw SQL, `prisma/migrations-manual/2026-07-10-amenity-custom-label-ko.sql` + schema.prisma 동기 반영. `db push` 금지).
4. **번역 파이프라인**: POST/PUT/PATCH 저장 커밋 **후** best-effort — custom 라벨 dedupe → `translateText(label, "ko")` Promise.allSettled → 성공분만 `customLabelKo` UPDATE. 실패해도 저장은 성공(null 유지). Gemini 키 부재 시 조용히 스킵.
5. **관리자 표시**: `customLabelKo`가 있으면 "한국어 번역 (vi 원문)" 병기, 없으면 vi 원문 그대로 (formatVillaName 병기 패턴 준용). 관리자 편집기는 custom 행 조회·수량 조절·삭제·추가 지원(전체교체 PATCH에 custom 포함 필수).
6. **게스트/공개 노출**: ko 화면은 `customLabelKo ?? customLabel`, vi 화면은 `customLabel`. `customLabel` 조회처 전수 grep 후 노출 지점 모두 반영 ([[consumer-e2e-bugs-fix-implementation]] 교훈).
7. **미니바**: 현행 유지 (회사표준 분리 — 이번 범위에서 손대지 않음. 서버 drop 로직 불변).

## 범위 (파일)

- `prisma/schema.prisma` + `prisma/migrations-manual/2026-07-10-amenity-custom-label-ko.sql` (additive 1컬럼)
- `lib/amenities.ts` (CUSTOM_ALLOWED_CATEGORIES 확장)
- `lib/villa-schema.ts` (create/update 스키마에 customLabel 추가 + custom 검증)
- `app/api/villas/route.ts`, `app/api/villas/[id]/route.ts`, `app/api/villas/[id]/amenities/route.ts` (customLabel 저장 + 번역 파이프라인)
- `app/(supplier)/my-villas/new/step-amenities.tsx`, `wizard-types.ts`, `villa-wizard.tsx` (수량 스테퍼 + 직접입력 UI + prefill/submit)
- `app/(admin)/villas/[id]/page.tsx`, `amenities-editor.tsx` (custom 행 포함 편집 + 번역 병기)
- 게스트/공개 노출 지점 (grep 결과에 따름: lib/guest-checkin-load.ts, app/g/_components/*, app/p/* 등)
- `messages/ko.json`·`vi.json` — amenities NS 키 추가만 (동시 추가, 파일 전면 재정렬 금지)
- 테스트: `tests/wizard-types.test.ts`, `tests/villa-create-api.test.ts` 갱신 + custom/번역 케이스 추가

## 수정 금지 구역

- 미니바 관련(MinibarItem, minibar-stock-editor, 회사표준 drop 로직), VillaRatePeriod/판매가, package.json

## 완료 기준 (테스트 가능)

1. 마법사에서 사전 항목 수량 2 이상 입력 → 저장 → DB `quantity` 반영, 재진입 시 prefill 정확.
2. 마법사에서 vi 직접입력 + 수량 입력 → 저장 → `itemKey="custom"` 행 + `customLabel` + `quantity` 저장. 수량 없이 추가 불가(기본 1 강제).
3. 관리자 빌라 상세에서 custom 항목이 한국어 번역 병기로 표시(번역 실패 시 vi 원문). 관리자가 다른 비품 수정·저장해도 custom 행이 사라지지 않음.
4. Gemini 호출 실패/키 부재 시에도 저장 API 200.
5. 임의 itemKey 주입은 여전히 400 (custom은 허용 카테고리만, customLabel 필수).
6. 공급자 응답·화면에 판매가/마진 필드 무노출 (기존 불변식 유지).
7. ko/vi 키 패리티, `npm run lint && npm run typecheck && next build` 통과, 기존+신규 테스트 통과.

## 검증 방법

- QA 에이전트가 로컬에서 Playwright 실사용(마법사 등록→관리자 확인 왕복) + 위 기준 채점. 작성자 자기평가 무효.
