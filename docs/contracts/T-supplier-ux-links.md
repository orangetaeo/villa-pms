# T-supplier-ux-links — 공급자 포털 UX 단절 2건 연결

## 배경
2026-07-03 공급자 관점 전 화면 점검에서 발견된 흐름 단절 2건 (업무 차단 아님, UX 연결 누락).

## 범위
1. **캘린더 예약 바텀시트 → 검수 진입**: `/calendar`에서 예약(BOOKED) 셀 탭 시 뜨는 바텀시트에, 해당 예약이 공급자 직접예약(seller=SUPPLIER)이고 검수 가능 상태(CONFIRMED→체크인 / CHECKED_IN→체크아웃)면 검수 화면으로 가는 버튼 추가. 운영자 예약(seller=OPERATOR)에는 미노출(검수 API가 404이므로).
2. **청소 상세 → 빌라 역링크**: `/cleaning/[id]`의 빌라명을 `/my-villas/[villaId]` 링크로. **SUPPLIER 역할만** — CLEANER는 /my-villas 접근 불가이므로 링크 미노출.

## 수정 파일 (이 외 수정 금지)
- `app/(supplier)/calendar/calendar-view.tsx` (+ 바텀시트 데이터 공급 경로에 seller/status 필드가 없으면 해당 서버 페이지/API 1곳)
- `app/(supplier)/cleaning/[id]/page.tsx`
- `messages/ko.json`, `messages/vi.json` — 키 추가만

## 완료 기준 (테스트 가능)
- 직접예약 CONFIRMED 셀 바텀시트에 "체크인 검수" 버튼 → `/my-bookings/[id]/checkin` 이동
- 직접예약 CHECKED_IN 셀엔 "체크아웃 검수" 버튼 → `/my-bookings/[id]/checkout`
- 운영자 예약 셀엔 검수 버튼 없음 (마진·검수권한 경계 유지)
- SUPPLIER로 청소 상세 진입 시 빌라명 링크 동작, CLEANER는 일반 텍스트
- ko/vi 키 동시 추가, tsc·lint·build 0 에러

## 검증 방법
- 기존 관련 테스트 통과 + typecheck/lint/build
- QA 독립 검토 (누수·역할 경계 중점)
