# T-checkin-sheet-v3-full-i18n-amenities — 시트 전체 다국어 + 비품 인쇄

담당: FE/LOC · 2026-06-24 · 선행: T-checkin-sheet-v2(완료)

## 배경 (사용자 피드백 2건)
1. 지금은 동의서만 언어 변경됨 → **인쇄 문서 전체**(라벨·섹션·비품·동의서)가 선택 언어로 바뀌어야 함
2. 프린트 시 비품 정보가 안 나옴 → 시트에 **비품 섹션** 추가

## ① 구현 범위
- 신규 `lib/checkin-sheet-i18n.ts`: 시트 인쇄 라벨(5개 언어 ko/vi/en/zh/ru) + 비품 49종 라벨(5언어) + 카테고리 라벨(5언어) + 채널 라벨 + nights/guestsValue 함수. `amenityLabel()` 폴백(custom→customLabel).
- `checkin-sheet/page.tsx`:
  - 인쇄 문서 전체를 선택 언어(`L = SHEET_LABELS[lang]`)로 렌더. 기본 언어 = 앱 로케일(ko/vi), `?lang=`으로 en/zh/ru.
  - 비품 섹션 추가: villa.amenities select(category/itemKey/customLabel/quantity — **unitPrice 미포함, 가격 누수 0**), 카테고리별 그룹, 선택 언어 라벨, qty>1이면 ×n.
  - 동의서는 선택 언어 단일 렌더(기존 ko+게스트 병기 → 문서 전체 단일 언어로 변경).
  - 툴바(no-print)는 앱 로케일 유지.
- 비품 ko/vi 라벨은 messages amenities.items 미러(편집기·체크아웃은 messages 사용). 동기화 주석+메모리.

## ② 완료 기준
1. `?lang=en|zh|ru` 시 시트 모든 라벨(예약정보·보증금·WiFi·비품·동의서 섹션 제목+필드)이 해당 언어로 렌더
2. 비품 섹션이 인쇄물에 카테고리별로 표시(선택 언어 라벨), 비품 있는 빌라
3. 비품에 unitPrice/가격/마진 노출 0 (select·렌더)
4. 채널·인원·박수·조식 값도 선택 언어
5. 동의서 선택 언어 단일 렌더 + 버전
6. 기본 언어 = 앱 로케일, ?lang 변경·날짜 이동 시 언어 보존
7. 마진 비공개 유지(판매가·원가 0), 디지털 체크인 회귀 0
8. typecheck0 / build0

## ③ 검증
- QA(독립) Playwright: ?lang=en/zh/ru 시트 전체 언어 전환 스크린샷, 비품 섹션 표시, 누수 grep(unitPrice/totalSale/supplierCost 0)

## 수정 금지 구역
격리 worktree `wt/sheet-i18n`. 공유폴더 타세션 WIP 비접촉. messages는 이번 미변경(라벨은 모듈).
