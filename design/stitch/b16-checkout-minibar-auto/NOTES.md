# b16-checkout-minibar-auto — 체크아웃 미니바 차감 자동계산 (운영자, b4 업그레이드)

- 영역: 운영자(ADMIN) / ko / 다크 데스크톱
- 디자인 시스템: Villa PMS Dark — Admin (`assets/16997822837865073105`)
- 제목: "체크아웃 검수 — 예약 #B-2607"

## 기획 의도
기존 b4 체크아웃의 미니바 '확인'(읽기 전용 체크리스트)을 **수량·unitPrice 기반 차감액 자동계산 UI**로 업그레이드. 소모=비치−남은(자동), 차감액=소모×단가(자동), 합계 → 보증금 정산.

## 색/상태
- 다크 navy `#0F172A` / 카드 `#1E293B` / blue `#3B82F6` / danger `#F87171`
- 자동 계산 컬럼(소모/차감액) blue tint, 차감액 danger
- 합계 amber `#F59E0B` 140,000₫, 환불 예정 green 4,860,000₫
- **VND 쉼표(5,000,000₫)** — 운영자 표기. Noto Sans KR 폴백 정상 로드.

## 자가검토 / 변환 시 반드시 고칠 점
1. 사이드바 서브타이틀 "Operation Manager", 프로필 서브 "Operation Lead", 헤더 "Status / Admin Session / Total Settlement" → **모두 한국어**(서브타이틀 "Villa PMS Admin")
2. 미니바 품목 영어 병기 제거: "생수 (Water)/탄산 음료 (Coke/Sprite)/맥주 (Beer)/스낵류 (Snacks)" → 한국어만(생수/음료/맥주/과자)
3. 사이드바 9메뉴 라벨 정확, 변환 단계 공통 Sidebar로 일괄
4. 자동계산 로직(소모=비치−남은, 차감액=소모×단가) 정확 반영됨 — 핵심 의도 충족
5. 단가는 공급자 입력 미니바 가격 기준 자동(노트 카피 정확)
