# b15-cost-change-alert — 견적 중 원가 변경 경보 (운영자)

- 영역: 운영자(ADMIN) / ko / 다크 데스크톱 반응형
- 디자인 시스템: Villa PMS Dark — Admin (`assets/16997822837865073105`)
- 제목: "제안 상세 — P-2614"

## 기획 의도
견적 중인 제안에 공급자 원가 변경이 발생 → 상단 경보 배너 + '공급자 원가 변경됨' 변경 전/후 비교 테이블 + 판매가 재확인 액션. 마진 squeeze 시각화.

## 색/상태
- 다크 navy `#0F172A` / 카드 `#1E293B` / blue `#3B82F6`
- 경보 배너 amber `#F59E0B` on `#78350F`/20
- 변경 전 원가 회색 strikethrough, 변경 후 bright + red "▲ +300,000₫" 델타 칩
- 마진 24%→18% orange(하락 강조)
- **VND 쉼표(2,300,000₫), KRW 쉼표(980,000원)** — 운영자 표기. 마진 노출 허용(ADMIN).

## 자가검토 / 변환 시 반드시 고칠 점
1. 사이드바 서브타이틀 "Operations Manager" → **"Villa PMS Admin"** (DESIGN 표준)
2. 한글 폰트 폴백 누락(Public Sans만 로드) → `"Public Sans","Noto Sans KR"` 추가 (globals.css 전역으로 커버되나 명시)
3. 날짜 "2023-10-24" → **2026.MM.DD 점 표기**
4. 영어 잔존 "Main Property" 배지 제거(운영자 무영어 규칙)
5. 스탯카드 마진 "18.5%" ↔ 테이블 "18%" 불일치 — 단일 값으로 통일
6. 사이드바 9메뉴는 변환 단계 공통 Sidebar 컴포넌트로 일괄(메뉴 라벨 자체는 정확)
