# T-partner-workflow-gaps — 파트너(여행사/랜드사) 업무 완결성 5종

- 담당: BE+FE (worktree `wt/partner-workflow`), 독립 QA 별도
- 배경: 2026-07-03 파트너 관점 전수 감사(코드 3건 + 프로덕션 실사용). 조회는 견고하나
  알림 0개·요청 액션 0개로 모든 단계에서 운영자 전화 의존. 우선순위 ①→⑤ 순 구현.

## 범위

### ① 파트너 알림 (Zalo + 인앱)
- 이벤트 4종: 예약확정(confirmHold) · 홀드만료(expireHolds) · 청구서발행(partner-invoice issue) · 연체전이(markOverdueReceivables cron)
- 채널: Partner.contactZaloUid로 Zalo 발송(연결 시) + InAppNotification 적재(파트너 User 대상)
- 파트너 포털 알림센터: 벨 아이콘 + 목록(vendor 알림센터 패턴 미러). 새 NotificationType enum 추가 금지(기존 enum 재사용 또는 InAppNotification.type 문자열)
- 신규 cron 없음 — 기존 cron/이벤트 경로에 편승

### ② 예약 취소·변경·홀드연장 "요청" (운영자 승인형)
- 파트너는 직접 취소/변경 불가 유지(사업원칙). 요청 레코드 생성 + 운영자 알림 + 운영자 화면 노출/처리(승인·거절)만
- 신규 테이블 BookingChangeRequest(additive, 라이브 raw SQL ALTER — db push 금지)
- 파트너 예약상세: 요청 버튼(취소/변경/홀드연장) + 진행중 요청 상태 표시
- 운영자: 예약상세에 대기 요청 배너 + 승인/거절 (승인 시 기존 운영자 API 수동 실행 유도 또는 연동 — 구현 중 판단, 최소 거절/완료 처리)

### ③ HOLD 만료시각 + 입금계좌 안내
- 파트너 예약상세: HOLD면 holdExpiresAt 표시(+임박 강조), 미납 잔액 있으면 입금계좌 안내(공개 /p 페이지와 동일 소스)

### ④ 입금통보 버튼 채권 경로 배선
- receivables-list 각 채권 행에 PaymentNoticeButton(receivableId) 노출 — API 기존(POST /api/partner/receivables/payment-notice)

### ⑤ 연장예약(parentBookingId) 묶음 표시
- 파트너 예약목록·상세: 연결예약 배지 + 상호 링크 + 묶음 합계(부모+자식). 채권 화면 연결 표기

## 완료 기준 (테스트 가능)
1. 확정/홀드만료/청구서발행/연체 시 파트너 InAppNotification row 생성 + contactZaloUid 있으면 Zalo 발송 (단위테스트)
2. 파트너 알림센터에서 본인 알림만 조회(IDOR 테스트), 읽음 처리
3. 요청 API: 본인 partnerId 예약만(404), 상태가드, 중복 미해결 요청 409, 운영자 처리 시 상태 전이
4. 파트너 예약상세에 HOLD 만료시각·계좌 노출, CANCELLED/체크아웃엔 미노출
5. 채권 행 입금통보 → AuditLog PARTNER_PAYMENT_NOTICE 적재(상태 미변경)
6. 연장예약 부모·자식 상호 링크 렌더
7. 누수 0: 마진·원가·KRW·신용한도·타파트너 데이터 미노출 (기존 규칙 유지)
8. tsc 0 · lint 0 · next build 통과 · 기존 테스트 그린

## 검증 방법
- 단위테스트(신규 API·알림 빌더) + 독립 QA 에이전트 코드검토(작성자≠평가자)
- 프로덕션 배포 후 데모 랜드사(0791234568) 실사용 스팟체크

## 수정 금지 구역
- prisma/schema.prisma 외 스키마 관련: additive만(라이브 raw SQL), 기존 enum 값 변경 금지
- messages/ko.json·vi.json: 키 추가만
- 타 세션 작업 파일(cleaning*, seed-*) 비접촉
