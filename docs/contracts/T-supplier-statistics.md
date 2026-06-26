# 계약: 공급자 매출·가동율 통계 + 정산 전산화 (T-supplier-statistics)

- 브랜치: `wt/supplier-stats`
- 담당: BE/UX-VN/QA 파이프라인 (단일 세션 오케스트레이션)
- 작업 유형: 신규 공급자 화면 (라이트, vi 기본, 모바일 우선)

## 배경

테오 요청: 공급자(SUPPLIER) 화면에서 ① 정산을 전산화해 보여주고 ② 자기 빌라의
**매출(=공급자 원가, supplierCostVnd)** 과 **가동율**을 통계로 보여준다.

기존 `/earnings`(월별 정산 내역, 원가만)는 유지하고, 같은 "수익" 탭 안에
**통계(Thống kê)** 세그먼트를 추가한다(모바일 하단탭 5개 유지 — 6번째 탭 신설 안 함).

## 범위 (수정/생성 파일)

- 생성: `lib/supplier-stats.ts` — 공급자 스코프 통계 로더(순수+DB). `lib/statistics.ts`의
  `resolveStatsPeriod`·`StatsPeriod`·`computeOccupancyRate`·`OCCUPANCY_STAY_STATUSES`·
  `SETTLEMENT_BOOKING_STATUSES` 재사용. **금액은 supplierCostVnd만**.
- 생성: `lib/supplier-stats.test.ts` — 순수 집계 단위 테스트.
- 생성: `components/supplier/stats/` — 라이트 테마 차트(수익 막대 VND, 가동율 라인 %),
  KPI 카드, 기간 칩, 빌라별 성과 카드, 세그먼트 컨트롤. (admin 다크 컴포넌트 **재사용 안 함** —
  KRW/마진 축 혼입 위험 → 깨끗한 VND-only/percent-only 신규 컴포넌트)
- 수정: `app/(supplier)/earnings/page.tsx` — 상단 세그먼트(통계/정산내역). 기존 월별 내역은
  `?view=detail`로 보존, 기본 `?view=stats`.
- 수정: `messages/ko.json`·`messages/vi.json` — `supplierStats` 네임스페이스 **추가만**.
- 수정: `app/(supplier)/layout.tsx` — `SUPPLIER_CLIENT_NAMESPACES`에 `supplierStats` 추가.

## 수정 금지 구역

- `app/(admin)/**`, `components/admin/**`, `lib/statistics.ts`(읽기 전용 재사용), 다른 공급자 라우트.

## 마진/재고 비공개 (절대 — leak-checklist)

공급자 응답·페이로드·메시지에 **절대 미포함**:
`totalSaleKrw`·`totalSaleVnd`·`fxVndPerKrw`·marginType/Value·`guestName`·`guestPhone`·
`agencyName`·미니바/서비스 `costVnd`·`unitPriceVnd`. 다른 공급자 빌라 데이터 0건.
모든 쿼리 `villa.supplierId = session.user.id` 강제. `adminStatistics` 네임스페이스 클라 전달 금지.

## 테스트 가능한 완료 기준

1. SUPPLIER 로그인 → `/earnings` 기본 화면이 **통계** 세그먼트: KPI(총 수익 VND·가동율%·예약수·평균박수),
   수익 추이(월 막대), 가동율 추이(라인), 빌라별 성과 카드 표시. vi 기본.
2. **정산내역** 세그먼트 = 기존 월별 내역(보존). 세그먼트 전환 동작.
3. 기간 칩(이번달/지난달/올해 등) 전환 시 데이터·URL(`?view=stats&range=`) 갱신.
4. 다른 공급자 빌라·예약 0건. 응답 grep으로 금지 필드 0건(QA 누수검사 PASS).
5. ko/vi 키 모두 채움 — 키 원문 노출 0. `npm run typecheck` + `npm run build` 통과.
6. `npm test`(supplier-stats) 통과.
7. 빈 데이터(빌라 0·예약 0) 그레이스풀 — 빈 상태 안내.

## 검증 방법

QA가 Playwright로 공급자 로그인 후 `/earnings` 두 세그먼트·기간칩 동작 확인 +
네트워크/페이로드 금지필드 grep + build/typecheck/test 로그.
