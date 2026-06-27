# 계약: 소비자 페이지 업무상 빠진 기능 보강 (2026-06-27)

브랜치 `wt/consumer-gaps`. 2026-06-27 소비자(게스트/제안) 페이지 점검에서 도출, 테오 승인 4건.

## 범위 (관리자엔 있으나 소비자엔 빠진 업무 기능)

### A. 게스트 영역 `/g/[token]` (스키마 변경 없음)
- **A1 WiFi·주소·지도 노출** — `Villa.wifiSsid/wifiPassword/address` 데이터 존재(관리자 체크인 화면엔 노출). 게스트 셀프체크인 G5 완료화면에 출입정보 카드 추가. wifiPassword는 동의서 서명 완료(`signed`) 후에만 표시. 누수 가드: `/p` 공개페이지엔 절대 미노출(기존대로).
- **A2 체크아웃 정산 미리보기** — `/g/[token]/orders`에 게스트 신청 합계(상태별: 요청됨/확정) 표시. 미니바 소비분은 체크아웃 시 합산 안내문구 유지. 판매가만(원가·마진 0).
- **A3 옵션 셀프 취소** — `ServiceOrder.status REQUESTED → CANCELLED`(운영자 확정 CONFIRMED 전만). 신규 라우트 `POST /api/g/[token]/service-orders/[id]/cancel`. 토큰 교차검증 + guestRateLimit + AuditLog 필수.

### B. 제안 영역 `/p/[token]/done` (스키마 변경 없음)
- **B1 입금통보 버튼** — `BookingStatus.HOLD`일 때만. 입금자명(선택) 입력 + "입금했습니다" 버튼 → `POST /api/p/[token]/payment-notice`. AuditLog(action=GUEST_PAYMENT_NOTICE, meta: depositorName, notedAt) 기록 + 운영자 예약상세(`/bookings/[id]`)에 "게스트 입금통보" 배지 노출. Zalo 푸시는 후속(NotificationType enum 추가 보류). 토큰 교차검증 + public rate-limit.

## 완료 기준 (테스트 가능)
- A1: 서명 완료 게스트의 G5에 WiFi SSID·비번·주소·지도링크 표시. 미서명 시 비번 숨김. `/p` done/main엔 wifi 필드 select·렌더 0(누수 가드 회귀).
- A2: `/orders`에 신청 합계(VND, 상태별) 표시. CONFIRMED·REQUESTED 구분. 원가 0.
- A3: REQUESTED 주문에 취소 버튼 → 취소 시 CANCELLED + 목록 갱신. CONFIRMED/DELIVERED엔 취소버튼 없음. 타토큰 주문 취소 시 404.
- B1: HOLD done에 입금통보 버튼. 누르면 AuditLog 생성 + 운영자 예약상세 배지. CONFIRMED done엔 버튼 없음.
- 공통: 5개 언어(ko/en/ru/zh/vi 또는 게스트 GUEST_LABELS) 라벨, 모바일 390px 오버플로 0, role/scope·rate-limit·AuditLog 누락 0.

## 수정 금지 구역
- 다른 세션 작업 중인 파일 없음(단독 worktree). 공유 파일 추가만: `lib/guest-i18n.ts`(A), `lib/public-i18n.ts`(B) 키 추가만.

## 검증
QA(독립) Playwright 프로덕션 재현 + 누수 체크리스트(마진·재고·wifi /p 노출) + typecheck/build.
