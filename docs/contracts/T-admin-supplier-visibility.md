# T-admin-supplier-visibility — 공급자 행동의 관리자 가시성 보강

## 배경
2026-07-03 관리자 측 공급자 연동 점검에서 확정된 갭 3건 (사용자 승인: "추천대로 진행").
전제(사용자 확인): 공급자 직접판매 시 미니바는 회수 방식이라 직접예약은 회사 매출 기여 0.

## 범위
1. **A. 빌라 승인 무통지 해소**
   - 신규 빌라 등록(POST /api/villas, PENDING_REVIEW) → zalo 연결된 활성 운영자 전원 알림
   - 반려 빌라 재제출(PUT /api/villas/[id], REJECTED→PENDING_REVIEW) → 동일 알림(payload.resubmitted=true 텍스트 분기)
   - NotificationType에 `VILLA_PENDING_REVIEW` 추가 — SECURITY_ALERT 선례대로 라이브 DB에 raw SQL `ALTER TYPE ADD VALUE`(additive) + schema.prisma + buildNotificationText case(exhaustive switch)
2. **B. 대시보드 승인 대기 카운트** — lib/dashboard.ts에 villaPendingReviewCount, 대시보드에 클릭 카드(→ /villas?status=PENDING_REVIEW)
3. **C. 매출 거래목록에서 공급자 직접예약 객실 행 제외** — lib/revenue-ledger.ts ROOM 쿼리에 `seller: OPERATOR` 필터 (직접예약은 totalSale null·원가 0으로 0원 행 오염만 유발. 미니바 라인은 실소비 기록이므로 비접촉). 통계(statistics.ts)는 점유율 정확성 위해 무변경.
4. **D. 승인(ACTIVE) 후 공급자 콘텐츠 수정 알림** — photos POST/DELETE·amenities PATCH·info PATCH 시 운영자 알림 `VILLA_CONTENT_UPDATED`(enum 추가). 스팸 방지: villa.status가 ACTIVE일 때만 + 같은 빌라의 미발송(PENDING) 동일 타입 알림 존재 시 스킵(dedup).

## 수정 파일 (이 외 수정 금지)
- prisma/schema.prisma (NotificationType 2값 추가만) + 라이브 raw SQL
- app/api/villas/route.ts, app/api/villas/[id]/route.ts, app/api/villas/[id]/photos/route.ts, app/api/villas/[id]/amenities/route.ts, app/api/villas/[id]/info/route.ts
- lib/zalo.ts (buildNotificationText case 추가), lib/notifications* (헬퍼 있으면), lib/dashboard.ts, lib/revenue-ledger.ts
- app/(admin)/dashboard/page.tsx, messages/ko.json·vi.json (키 추가만)
- 관련 테스트 추가/갱신

## 완료 기준
- 공급자 신규 등록/재제출 시 운영자 Notification(PENDING) 적재, 판매가·마진 미포함
- 대시보드에 승인 대기 N 카드, 클릭 시 승인 대기 탭
- /revenue 거래목록에 seller=SUPPLIER 객실 행 미노출 (미니바 라인 영향 없음)
- ACTIVE 빌라의 사진/비품/정보 수정 시 운영자 알림 1건(dedup), PENDING_REVIEW 상태(마법사 중)엔 미발송
- tsc·lint·build 0, 전체 테스트 그린, 라이브 enum ALTER 적용
