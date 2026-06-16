# a11-photo-lightbox — 사진 확대 갤러리 (라이트박스)

- 영역: 공급자(SUPPLIER) / vi / 모바일 390px
- 디자인 시스템: Villa PMS Light — Supplier/Public (`assets/16166333700622029900`)
- Stitch screen ID: `cd40219b71c741e99385863717e576cb` (title: "Thư viện ảnh - Phóng to")

## 기획 의도
썸네일 탭 → 풀스크린 사진 뷰어. 좌우 스와이프(chevron 어포던스), 핀치 줌 힌트, 공간 라벨 캡션, 닫기/삭제 버튼, 하단 필름스트립 + 진행 도트. 프리미엄 네이티브 포토 뷰어(Google Photos/iOS Photos) 품질 목표.

## 색/상태
- 배경: near-black `#0F0F0F` (사진 강조)
- 유일 액센트: teal `#0D9488` (활성 썸네일 2px 보더, 진행 도트 활성)
- 컨트롤: white on translucent black, backdrop-blur

## 변환 시 반드시 고칠 점 (자가검토 결함)
1. 카운터 불일치: 헤더 "3 / 12" ↔ 필름스트립 6장 ↔ 진행 도트 10개 — 실제 사진 수로 ICU 변수 통일(`{current} / {total}`)
2. 캡션 아이콘 오류: "Phòng khách"(거실)인데 `king_bed`(침실) 아이콘 — 공간별 아이콘 매핑 테이블로 교정
3. 하단 5버튼 BottomNavBar는 불필요 클러터(요청 안 함) — 변환 시 제거. 라이트박스는 top bar(닫기/카운터/삭제)만, "버튼 3개 이하" 원칙 준수
