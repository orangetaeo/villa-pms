# T-partner-admin-ops — 파트너 운영 관리자측 보강 4종 (P0 좀비채권 포함)

- 담당: BE+FE (worktree `wt/partner-admin-ops`), 독립 QA 별도
- 배경: 2026-07-03 관리자 관점 감사(에이전트 2 + OWNER 실사용). 파트너 요청 승인 루프는 실증 PASS,
  단 취소 시 채권 미정리(P0)·요청/입금통보 가시성·변경 알림 갭 발견. 선행: T-partner-workflow-gaps(PR #182).

## 범위

### ① [P0] 취소 시 파트너 채권 정리 + 취소 파트너 알림
- `cancelBooking`(lib/hold.ts): 취소 성공 시 해당 예약의 **미청구 채권(invoiceId=null, PENDING/PARTIAL/OVERDUE)을 WRITTEN_OFF로 종결** — 미수·연체 집계에서 제외(기존 OPEN_RECEIVABLE_STATUSES 규칙 재사용). 기입금액(deposit/balancePaidVnd)은 기록 보존(환불/이월은 운영자 수동). **청구서에 이미 묶인 채권은 자동 미접촉**(운영자 청구서 무효화 흐름) — AuditLog changes에 사실 기록.
- 순수 로직은 lib/partner-booking.ts 헬퍼로 분리(단위테스트 대상).
- 취소 시 파트너 알림(BOOKING_CANCELLED, partner-notify 이벤트 추가 — 커밋 후·무throw).

### ② 요청·입금통보 운영자 가시성
- /bookings 목록: 대기 요청 있는 행에 배지(요청 N).
- /dashboard: 파트너 요청 대기 배너(건수+예약 링크, villaPendingReview 배너 패턴 미러).
- lib/dashboard.ts feedEntryFor: PARTNER_PAYMENT_NOTICE·GUEST_PAYMENT_NOTICE 매핑(강조 라벨+예약/청구서 링크) — 활동 피드에서 식별 가능하게.

### ③ 예약 변경 후 파트너 알림
- modifyBooking(lib/booking-modify.ts) 커밋 후 파트너 예약이면 BOOKING_MODIFIED 알림(새 날짜·본인 채권 새 총액 VND만). preview(dry-run)는 미발송.

### ④ 소소 3건
- 청구서 탭: "발행 시 파트너 자동 알림" 안내 캡션(수동 Zalo 발송은 PDF 재발송용 명시).
- /partners 목록: Zalo 연결 여부 아이콘.
- /dashboard: 연체 파트너 배너(연체 파트너 수 + /partners 링크).

## 완료 기준
1. CONFIRMED+채권 예약 취소 → 미청구 채권 WRITTEN_OFF·미수/연체 집계 제외·연체 cron 미대상 (단위테스트)
2. 청구서 묶인 채권은 불변 (단위테스트)
3. 취소·변경 시 파트너 인앱+Zalo 텍스트에 마진·원가·KRW 없음 (빌더 테스트)
4. /bookings 배지·대시보드 배너 2종·피드 매핑 렌더 (build+실사용)
5. 누수 0·기존 규칙(파트너 partnerId 스코프) 유지, tsc 0·lint 0·build·전체 테스트 그린
6. i18n ko/vi 동시(운영자 화면 vi 필수)

## 수정 금지 구역
- prisma 스키마 무변경(이번 태스크는 additive조차 불필요)
- messages/*.json 키 추가만. 타 세션 작업 파일 비접촉.
