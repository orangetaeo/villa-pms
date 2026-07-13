# T-ticket-audit-followups — 티켓 발행·판매 3포지션 감사 후속 일괄 수정

- 상태: 완료 (2026-07-13) — 7건(항목 7=취소 QR 차단, 테오 확정 편입). QA PASS(결함 0). tsc0·vitest 3028·build 통과
- 담당: BE(+게스트 FE 소폭), QA 검증
- 배경: 테오 지시 "소비자·부가서비스공급자·ADMIN 3포지션에서 티켓 발행·판매 문제 요소 전체 확인" —
  3개 병렬 감사 결과 **P0/P1 = 0건**, P2 2건 + P3 5건. 이 중 정책 판단 1건(취소 주문 QR 잔류 — 테오 확인 대기) 제외
  6건을 일괄 수정.

## 수정 목록 (감사 발견 그대로 — 각 항목에 파일:라인 근거 있음)

1. **[P2-A] 무료 티켓이 운영자 정산 허브 "정산 대기"에 유령 잔류** — lib/service-orders-hub.ts의
   `settleable`·pending/paid viewWhere에 vendor/orders와 동일한
   `NOT: { AND: [{type:TICKET},{priceVnd:0n},{costVnd:0n}] }` 추가. 공유 상수로 추출(3곳 재사용, vendor/orders route·vendor-stats 포함).
2. **[P2-B] 미체크인 상태 규칙 variant 신청 시 원인 불명 오류** — 게스트 옵션 페이지에서 서버 400
   `TICKET_GUESTS_REQUIRED`를 안내형 오류로 매핑(셀프 체크인 유도 문구, guest-i18n 5언어).
   app/g/_components/guest-options.tsx의 CONFIG_ERROR_CODES 계열 확장.
3. **[P3-①] 무료 티켓 취소 시 벤더 "발주 취소" Zalo 오발송** — app/api/service-orders/[id]/route.ts
   취소 통보 게이트에서 무료 티켓(type=TICKET && priceVnd=0) 제외(실제 PO 발송 이력 없음).
4. **[P3-③] 동시 발행 업로드 ticketUrls append 유실 경합** — app/api/vendor/orders/[id]/tickets/route.ts
   POST append의 updateMany where에 `ticketUrls: { equals: order.ticketUrls }` 낙관 가드 추가, 0건 시 409(재시도 유도).
5. **[P3-④] lib/vendor-stats.ts settleable에 무료 티켓 NOT 필터 부재**(주석과 불일치, 금액 무영향) — 1의 공유 상수 적용.
6. **[P3-⑤] loadGuestCheckin이 TICKET 확정 주문의 벤더 연락처를 payload에 포함**(활성 누수 아님 — 방어심층) —
   lib/guest-checkin-load.ts vendorName/vendorPhone 산출식에 `o.type !== "TICKET"` 조건 추가(로더 계층 종결, 주석과 정합).

7. **[항목7] 취소된 티켓 주문의 QR 소비자 완전 차단**(테오 확정 2026-07-13: "취소된 주문은 당연히 삭제돼야") —
   단 DB·스토리지의 `ticketUrls` 원본은 삭제하지 않는다(증빙 보존 — 운영자·벤더 열람 유지).
   (a) lib/guest-checkin-load.ts: 주문 status==="CANCELLED"면 반환 payload의 `ticketUrls`를 빈 배열로 절단(로더 계층 종결,
   항목 5와 같은 방어심층). 게스트 orders 화면 부분발행 경고는 자연 소멸(ticketUrls.length>0 게이트).
   (b) app/api/g/[token]/service-orders/[id]/ticket-download/route.ts: status==="CANCELLED"면 404(ORDER_NOT_FOUND) —
   이미 발급된 다운로드 URL 재사용도 차단. (c) admin·vendor 화면 불변(vendor cancelled 탭 자기 산출물 열람 무해).

- 교훈 축적: .claude/skills/qa/leak-checklist에 "배열 필드 append mutation은 DELETE와 달리 낙관 가드 누락되기 쉬움 —
  read-modify-write 배열은 has/equals 가드로 대칭 방어" 추가.

## 완료 기준
1. 각 항목 단위테스트(1·5=허브/통계 무료 제외, 3=통보 미발송, 4=경합 409, 6=TICKET 연락처 null) + 기존 테스트 무회귀.
2. 2번: 미체크인+규칙 variant 400 시 게스트에게 체크인 유도 문구 표시(5언어).
3. tsc·vitest 전체·build 통과. QA 재검(수정이 벤더 무료 숨김·연락처 게이트 기존 동작을 건드리지 않는지).

## 보류 (해소됨)
- ~~취소된 티켓 주문의 발행 QR 잔류~~ → **테오 확정(2026-07-13): 소비자에게서 완전 차단**. 항목 7로 편입 구현.
  증빙 보존 원칙에 따라 DB·스토리지 원본은 유지하되(운영자·벤더 열람), 소비자 로더·다운로드 프록시에서만 차단.
