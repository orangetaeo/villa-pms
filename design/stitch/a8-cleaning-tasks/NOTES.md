# a8-cleaning-tasks — 청소 태스크 목록 (Dọn dẹp)

- Stitch screen: projects/14837850287160773673/screens/fe5c3ddad0234a8cad42695d26c164c7
  (주의: 동일 프롬프트 중복 생성본 1bef1975adda42daaa6cf1773ec11d7e가 Stitch 프로젝트에 존재 — 미사용)
- 대상: CLEANER/SUPPLIER (vi), 모바일, 라이트 teal. a6 하단 탭 "Dọn dẹp"의 목적지.
- 디자인 의도: 배정된 청소 건을 카드 목록으로. 카드 = 빌라 사진 + 이름 + 체크아웃 날짜(Trả phòng: 12/06) + 상태 배지 1개 + 우측 chevron(탭 → a4-cleaning-photos).
- 상태 배지 4종: Chờ dọn(주황) / Đã gửi(파랑) / Đã duyệt(초록) / Bị từ chối(빨강 외곽선)
- 하단 탭: Villa, Lịch, Dọn dẹp(활성), Thu nhập
- 가격·KRW·마진 요소 없음. "villa" 통일.
- 변환 메모(UX-VN): 상태 배지 색상은 globals.css 변수로, 카드 전체가 터치 영역(56px+)
