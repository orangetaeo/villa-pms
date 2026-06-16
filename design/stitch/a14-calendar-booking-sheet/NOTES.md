# a14-calendar-booking-sheet — 캘린더 예약 상세 바텀시트 (a3 기반)

- 영역: 공급자(SUPPLIER) / vi / 모바일 390px
- 디자인 시스템: Villa PMS Light — Supplier/Public (`assets/16166333700622029900`)
- 제목: "Lịch" + 바텀시트

## 기획 의도
a3 캘린더에 예약 셀 탭 시 바텀시트 추가: 체크인/아웃·몇박·인원·상태(확정/가예약)·**자기 원가(정산 예정액)**. 홀드는 만료 카운트다운.

## 색/상태 (a3 계승)
- Trống green outline / Đã đặt solid blue `#2563EB` / Giữ chỗ light-blue `#DBEAFE` dashed / Đã khóa gray diagonal hatch
- 바텀시트: 상태 배지(Giữ chỗ dashed), amber monospace 카운트다운 "Hết hạn sau 05:23"
- 정산 카드 teal, "Tiền bạn nhận 4.500.000₫ · Dự kiến thanh toán"

## 마진 비공개 — 핵심 (확인 PASS)
- **고객명 없음 / 판매가 없음 / KRW 없음 / 마진 없음**. 금액은 공급자 본인 정산 예정액(VND dots)만.

## 자가검토 / 변환 메모
- 현재 "Giữ chỗ" 변형만 렌더 — 확정(Đã xác nhận solid blue) 변형은 데이터 분기로 추가. 확정 시 카운트다운 숨김.
- 그리드 26일까지만 — 변환 시 실제 월 전체 렌더
- 하단 탭 Villa/Lịch/Dọn dẹp/Thu nhập = a6/a8 일관 (확인)
