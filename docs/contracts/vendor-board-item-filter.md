# 계약: 벤더 보드 품목(티켓 분류) 필터

- 상태: 착수 (2026-07-12)
- 브랜치: wt/vendor-item-filter
- 배경(테오): 티켓업체 화면에서 검색만으로는 티켓 분류(품목)별로 발주를 모아 볼 수 없음 —
  "빈사파리만", "키스쇼만" 같은 분류 조회 필요. 품목이 7종+로 늘어 텍스트 검색만으론 불편.

## 설계 (TDA)

- **서버 필터**: `GET /api/vendor/orders`에 `itemId`(catalogItemId) 파라미터 추가 — 목록 where에
  AND 결합(기존 검색·날짜 필터와 동일 패턴 `withFilters`). 뱃지 카운트·정산 전역합계는 필터 무관
  유지(날짜 필터와 동일 원칙 — "할 일 총량" 의미 보존). 본인 vendorId 스코프가 base라 타 벤더
  itemId를 넣어도 빈 결과일 뿐(누수 없음).
- **필터 소스**: 신규 `GET /api/vendor/catalog-items` — 본인(vendorId) 소속 카탈로그 품목의
  **id·현지화 이름만** 반환(pickI18n, locale 기준). ★누수: priceVnd(우리 판매가)·costVnd·마진
  절대 미포함. Role=VENDOR + 본인 스코프.
- **UI**(vendor-board.tsx): 날짜 필터 행 아래(검색창 위)에 품목 분류 셀렉트 — "전체 품목" 기본,
  품목 1종 이하면 미노출. 4탭 공통 상태(탭 전환 유지), 변경 시 page=1. 라벨 vendor NS ko/vi.

## 범위
1. `app/api/vendor/orders/route.ts` — itemId 파라미터(+검증: 문자열 max 40)
2. `app/api/vendor/catalog-items/route.ts` — 신규(본인 품목 id·이름만)
3. `components/vendor/vendor-board.tsx` — 분류 셀렉트
4. `messages/ko.json`·`vi.json` — vendor NS 키 추가만
5. 테스트: itemId 필터 적용·타 벤더 itemId 빈 결과·catalog-items 응답에 가격류 미포함(not.toHaveProperty)

## 수정 금지 구역
- prisma/schema.prisma, ROW_SELECT 화이트리스트(응답 shape 불변), 뱃지·정산 합계 의미

## 완료 기준 (QA)
- [ ] 분류 선택 시 4탭 목록이 그 품목만, 뱃지·정산 합계는 전역 유지
- [ ] catalog-items 응답=id·이름만(판매가·원가·마진 0), 본인 품목만
- [ ] 품목 1종 이하 벤더는 셀렉트 미노출, 기존 검색·날짜 필터와 조합 동작
- [ ] ko/vi 키 쌍, next build 통과
