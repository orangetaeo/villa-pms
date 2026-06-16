# a15-cost-seasons (D) — 원가 관리 + 빌라별 시즌 날짜 (a5 기반)

> 슬러그: a15-cost-seasons (초기 a11 충돌 → a15로 리네이밍 완료)

- 영역: 공급자(SUPPLIER) / vi / 모바일 390px
- 디자인 시스템: Villa PMS Light — Supplier/Public (`assets/16166333700622029900`)
- Stitch screen ID: `631c69aa26ef4d21a77dc87f1dde50bc` (title: "Giá gốc & mùa - Chỉnh sửa")

## 기획 의도
시즌별(비수기/성수기/극성수기) 원가 수정·삭제(a5 키패드 계승) + 각 시즌의 **날짜 범위를 빌라별로 지정**(Áp dụng 날짜 pill + 기간 선택 바텀시트).

## 색/상태
- a5 계승: 비수기 green / 성수기 orange / 극성수기 red 라운드 아이콘
- 활성 카드 teal 보더+light teal fill, 비활성 가격 회색
- 하단 flat numeric keypad (a5 동일), "Lưu thay đổi" teal
- 시즌 삭제 trash 아이콘

## 자가검토 / 변환 메모
- 미니 달력 헤더 "Tháng 5 & 6, 2024" → **2026**으로 (연도 통일 규칙)
- 빈 시즌 "Chưa nhập giá" + 저장 disabled 게이트 유지(a5 규칙)
- 판매가·마진·KRW·수수료 없음, "giá gốc"(원가) 표현만 — 준수 (확인)
