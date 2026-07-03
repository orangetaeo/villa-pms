# 계약: 관리자 운영 갭 A1~A5 (소비자 연동 신호·처리)

- 브랜치: `wt/admin-ops-gaps` (worktree 격리)
- 근거: 2026-07-03 소비자 E2E·관리자 운영점검 (memory: admin-ops-audit-consumer-side-2026-07-03)
- 회의 요약: PM(우선순위 A1+A2 최우선, A3~A5 동일 PR 포함 — 전부 소비자 신호 배선으로 응집) /
  TDA(enum 2값 additive 라이브 ALTER 승인, Booking 스키마 무변경 — 입금통보는 기존 AuditLog 소스 유지) /
  BE(취소 시 주문 일괄취소는 cancelBooking 트랜잭션 내부, 벤더 살아있는 PO엔 기존 VENDOR_PO_CANCELLED 재사용) /
  QA(단위테스트: 취소연쇄·확정가드·HOLD 가시성 where, 라이브 스모크로 마감)

## 범위 (테스트 가능한 완료 기준)

**A1 소비자 신호 알림·대시보드**
- [ ] 게스트 입금통보(POST /api/p/[token]/payment-notice) 시 운영자 전원에게 Zalo 알림 enqueue (신규 `GUEST_PAYMENT_NOTICE`)
- [ ] 게스트/파트너 부가서비스 요청(POST /api/{g,p}/[token]/service-orders) 시 운영자 알림 enqueue (신규 `SERVICE_ORDER_REQUESTED`)
- [ ] 대시보드 카드 2개: "입금통보 확인 대기 N"(HOLD+GUEST_PAYMENT_NOTICE 감사로그 보유) → /bookings?status=hold, "옵션요청 대기 N" → /service-orders?tab=requests
- [ ] NotificationType enum 2값 라이브 ALTER(additive raw SQL) + zalo exhaustive switch case 추가

**A2 예약목록 HOLD 가시성**
- [ ] 기본(월 겹침) 스코프에서도 활성 HOLD는 항상 포함 (where OR status=HOLD)
- [ ] 목록 하단 KPI "Giữ chỗ chưa xác nhận"을 /bookings?status=hold 링크로

**A3 옵션요청 통합 큐**
- [ ] /service-orders에 "고객 요청 대기" 탭: 전 예약 REQUESTED 주문 목록(빌라·게스트·희망일시·예약 링크)

**A4 취소예약 잔여 수납 추적**
- [ ] CANCELLED + 수납합>0 예약 상세에 환불 필요 배너(수납액 표시)
- [ ] 대시보드 "취소예약 미환불 N" 카드(0이면 숨김)

**A5 취소 시 부가서비스 연쇄 처리**
- [ ] cancelBooking 트랜잭션에서 미종결 주문(REQUESTED·CONFIRMED) → CANCELLED, 살아있는 PO는 벤더 Zalo+인앱 취소통보
- [ ] 취소된 예약의 주문 확정/추가 차단(서버 409)

## 검증
- `npx tsc --noEmit` 0 에러 / 관련 vitest 그린 / `npx next build` 통과
- 라이브 배포 후 스모크: 데모 빌라로 가예약→입금통보→운영자 알림 적재 확인, 취소→주문 연쇄취소 확인

## 수정 금지 구역
- prisma/schema.prisma의 NotificationType 외 모델, vendor 통계(lib/vendor-*), 청소(cleaning-*), 파트너 포털 — 타 세션 활동 영역
