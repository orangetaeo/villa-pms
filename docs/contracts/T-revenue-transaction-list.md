# 계약서: 매출관리 — 건별 매출 거래 목록 (F1)

## 범위
운영자(ADMIN, canViewFinance) 전용 `/admin/revenue` 신규 페이지. 예약 객실료·미니바·부가서비스 매출을 **건별 거래 행**으로 한 곳에 모아 필터·검색·정렬·엑셀(CSV) 내보내기 제공.

- 거래 소스 3종을 통합한 단일 행 모델 `RevenueTxn`:
  - 객실료: Booking(CHECKED_OUT·NO_SHOW 매출인식, 또는 전체 옵션) — totalSale(KRW/VND), supplierCostVnd
  - 미니바: CheckoutMinibarLine — lineVnd, lineCostVnd
  - 부가서비스: ServiceOrder(CONFIRMED·DELIVERED) — priceKrw/priceVnd, costVnd
- 필터: 기간(from~to), 유형(객실료/미니바/부가서비스), 채널(TRAVEL_AGENCY/LAND_AGENCY/DIRECT), 빌라, 파트너, 통화
- 검색: 투숙객명·빌라명·파트너명·품목명
- 합계 푸터: 통화별 매출·마진(canViewFinance만)
- CSV 내보내기(서버 라우트 `/api/revenue/export`)

## 비범위 (수정 금지)
- 기존 statistics/settlements/receivables 페이지 로직 변경 금지 (read-only 재사용만)
- 스키마 변경 없음 (기존 모델 read-only 집계)
- 마진·판매가는 canViewFinance 게이트 통과 시에만 노출 (원칙2)

## 완료 기준 (테스트 가능)
1. `lib/revenue-ledger.ts` 순수/로더 함수: 3소스→RevenueTxn[] 통합, 기간·필터 적용, BigInt 합산. 단위테스트 통과
2. `/admin/revenue` 페이지: 비운영자 차단, STAFF는 마진/판매가 비노출
3. CSV 내보내기: 필터 반영, BigInt/통화 정확
4. ko+vi i18n 키 동시 추가
5. typecheck·build·기존 테스트 무손상

## 수정 금지 구역 (타 세션)
- 다른 worktree 브랜치 전부. 본 작업은 wt/rev-minibar-bookmod 단독.
