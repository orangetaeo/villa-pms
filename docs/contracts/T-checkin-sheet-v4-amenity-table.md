# T-checkin-sheet-v4-amenity-table — 비품 박스 표 + 미니바 정산 컬럼

담당: FE · 2026-06-24 · 선행: T-checkin-sheet-v3(완료)

## 배경 (사용자 요청)
프린트 시트의 비품을 박스(표) 형태로: 항목 | 가격 | 수량 | 남은수량 | 합계.
가격·수량(비치)은 인쇄, **남은수량·합계는 빈 칸**(체크아웃 시 손기입).

## ① 구현 범위
- `lib/checkin-sheet-i18n.ts`: SheetLabels에 `amenityTable {item,price,stocked,remaining,total}` 5개 언어 추가.
- `checkin-sheet/page.tsx`:
  - amenities select에 `unitPrice` 추가 — **미니바 고객 청구 단가(VND), 게스트 노출 OK**. 빌라 판매가/원가와 무관.
  - 비품 섹션을 카테고리 그룹 테두리 표로 교체: 컬럼 항목/가격/수량/남은수량/합계.
    가격 = unitPrice(있으면 `n₫`), 수량 = quantity(비치). 남은수량·합계 셀은 빈 칸(손기입).
  - 선택 언어로 컬럼 헤더·항목·카테고리 라벨 렌더.

## ② 완료 기준
1. 비품이 테두리 표(박스)로 렌더, 컬럼 5개(항목/가격/수량/남은수량/합계)
2. 미니바 항목에 가격(단가 ₫)·수량 표시, 남은수량·합계 셀 빈 칸
3. 컬럼 헤더·항목명·카테고리가 선택 언어(en/zh/ru 포함)
4. **마진 비공개 유지** — totalSaleKrw/totalSaleVnd/supplierCostVnd 노출 0. unitPrice는 미니바 청구가(의도된 노출)이며 villa 판매가/원가 아님
5. 디지털 체크인·기존 시트 기능 회귀 0
6. typecheck0 / build0 / 기존 minibar-leak 테스트 통과

## ③ 검증
- QA(독립): ?lang별 표 렌더 스크린샷, unitPrice 표시 확인 + totalSale*/supplierCost 0 grep, `npx vitest run villa-amenities-minibar-leak` 통과 확인.

## 수정 금지 구역
격리 worktree `wt/sheet-minibar`. 공유폴더 타세션 WIP·다른 worktree(guest-roster) 비접촉. messages 미변경.
