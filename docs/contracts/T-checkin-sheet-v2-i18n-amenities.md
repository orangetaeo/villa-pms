# T-checkin-sheet-v2-i18n-amenities — 다국어 동의서 + 비품 확장

담당: FE/LOC · 작성일 2026-06-24 · 상태: 착수 · 선행: T-admin-checkin-sheet(완료)

## 배경 (사용자 요청 3건)
1. 동의서를 한국어 외 베트남어·영어·중국어·러시아어로도 표시(게스트 자국어 서명)
2. 비품 내용 보강 — 일반 휴양 빌라 표준 항목 추가
3. 이용 동의서는 추후 수정·확장 예정(길어질 수 있음)

## ① 구현 범위
### A. 비품 확장 (스키마 변경 없음 — 기존 4카테고리 항목만 추가)
- `lib/amenities.ts` AMENITY_ITEMS에 22개 항목 추가:
  - 주방(+9): stove, pot, cutlery, mug, toaster, waterPurifier, dishSoap, bottleOpener, trashBin
  - 욕실(+6): conditioner, soap, handWash, bathMat, slippers, bathTrashBin
  - 가전(+6): dryingRack, iron, vacuum, dehumidifier, speaker, safeBox
  - 미니바(+1): coffeeTea
- `messages/ko.json`·`vi.json` amenities.items에 22개 라벨 추가(ko+vi). 3개 편집기가 사전 자동 렌더.

### B. 다국어 동의서 + 버전 (전용 콘텐츠 모듈)
- 신규 `lib/agreement.ts` — 단일 소스: AGREEMENT_VERSION, 5개 언어(ko/vi/en/zh/ru) docTitle+7조항, buildClauseOrder(hasPool), 언어 라벨/가드.
- `agreement-section.tsx`(디지털 체크인) — messages 대신 모듈에서 앱 로케일(ko/vi)로 렌더 + 버전 표기.
- 체크인 시트 `page.tsx` — 동의서를 모듈에서 렌더. `?lang=`(기본 vi)로 게스트 언어 선택 → **한국어(기록용) + 게스트 언어 병기**. 버전 표기.
- 신규 `agreement-lang-select.tsx`(클라) — 언어 선택 select, ?lang 갱신. 날짜 이동 링크는 lang 보존.
- `adminCheckinSheet.langSelect` 키 추가(ko+vi).

## ② 완료 기준
1. /villas·공급자 비품 편집기에 새 22개 항목이 카테고리별로 표시, 토글/저장 정상(API isValidAmenity 통과)
2. 체크인 시트 언어 선택(ko/vi/en/zh/ru) → 한국어 + 선택 언어로 동의서 병기 렌더, ?lang 변경 시 갱신
3. en/zh/ru 동의서 텍스트가 깨짐 없이 출력(7조항+수영장 조항)
4. 디지털 체크인(/bookings/[id]/checkin) 동의서가 모듈 기반으로 ko/vi 정상 렌더(회귀 없음)
5. 동의서에 버전(v2026-06) 표기
6. **마진 비공개 유지** — 시트 select·렌더에 판매가/원가/마진 없음(회귀 0)
7. 날짜 이동 시 선택 언어 보존
8. ko/vi 키 깨짐 없음, JSON additive-only
9. typecheck0 / next build0

## ③ 검증 방법
- QA(독립) Playwright: 시트 ?lang=en|zh|ru 렌더 스크린샷, /villas 비품 편집기 신항목, 디지털 체크인 동의서 회귀, 누수 grep(totalSale*/supplierCost 0건)
- 단위: lib/agreement 구조 일관성(모든 조항 5개 언어 키 존재)

## 수정 금지 구역 (병렬 세션)
격리 worktree `wt/checkin-v2`에서 작업. 공유폴더 타세션 미커밋 파일 `lib/{cleaning,hold,proposal}.ts·docs/DESIGN.md`는 비접촉. 공유 `messages/*.json`은 worktree에서 HEAD 기준 additive 삽입 후 wt 병합.
