# 계약: 매출관리 페이지 `/sales` (IDEAS.md — 테오 2026-06-24)

브랜치: `wt/sales` · 담당: BE/FE · 상태: 착수(선점)

## 배경·문제
IDEAS.md: "매출관리 페이지(/sales) — 정산과 별개. 정산(/settlements=공급자 원가 지급)과 매출(판매 실적·기간별 매출 집계)은 다른 개념·다른 페이지. 신설 시 ADMIN 모바일 하단 네비 중앙 돌출 항목을 정산→매출로 교체."

발견: `/statistics` 개요(overview) 탭이 **이미 매출(KRW/VND 매출·마진·마진율 + 추이 + 채널)을 집계**한다(loadOverviewStats). 따라서 /sales는 **로직을 중복 구현하지 않고** 그 엔진·UI를 재사용하여 "매출 전용 최상위 진입점"으로 승격한다.

## 범위 (Phase 1)
- 신규 라우트 `app/(admin)/sales`:
  - `page.tsx` — RSC. **재무 전용 게이트**(canViewFinance=false면 redirect("/dashboard"), 비운영자 redirect("/login")). `resolveStatsPeriod` + `loadOverviewStats(period)` + `loadVillaPerformance(period, true)` 재사용.
  - `sales-client.tsx` — 단일 스크롤(탭 없음): DateRangeFilter + 매출 KPI/추이/채널(OverviewTab 재사용) + 빌라별 매출 랭킹(VillasTab 재사용, hasFinance=true).
- `statistics-client.tsx`: 내부 `OverviewTab`·`VillasTab`를 **export**(JSX 중복 0, /sales가 import).
- `sidebar.tsx`: 재무 그룹에 `sales` leaf(cap=canViewFinance, icon=trending_up) 추가 + 모바일 centerItem을 `canViewFinance ? /sales : /availability`로 교체(정산→매출).
- `middleware.ts`: `/sales`를 `FINANCE_PATHS`에 추가(비재무 차단).
- i18n ko/vi: `nav.sales`("매출"/"Doanh thu"), `pageTitles.sales`, 신규 네임스페이스 `adminSales`(title·subtitle·villaSectionTitle) + `(admin)/layout.tsx` 화이트리스트에 `adminSales` 등록.

## 비범위
- /statistics overview 탭 제거(추후 슬림화 — 이 PR은 additive·무파괴). 부가서비스/미니바 상세 탭(/statistics ancillary 유지). 신규 집계 로직·스키마 변경·Stitch 신규 디자인(기존 컴포넌트 디자인 언어 계승).

## 완료 기준 (테스트 가능)
1. ADMIN(OWNER/MANAGER)이 `/sales`에서 매출 KPI·추이·채널·빌라별 매출 랭킹을 본다.
2. STAFF(canViewFinance=false)는 `/sales` 접근 시 middleware/page 게이트로 차단(매출·마진 노출 0).
3. 모바일 하단 중앙 네비가 재무 권한자에게 "매출"(→/sales), STAFF에게 "공실"(→/availability).
4. typecheck 0(드리프트 제외)·전체 테스트 그린(회귀 0)·lint 에러 0·next build 성공.
5. 독립 QA: 누수 0(작성자≠평가자).

## 수정 금지 구역
메인 폴더 타 세션 WIP(`lib/vendor-stats.ts`·`app/api/vendor/**`·`components/vendor/**`·`app/vendor/**`·`lib/service-display.ts`) 미접촉.
