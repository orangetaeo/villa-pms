# 계약서: 게스트 부가옵션 주문 — 벤더 직접 전달 방식 전환

- 담당: BE (구현) / QA (독립 검증) / 메인 세션(Fable) = TDA 설계 승인
- 브랜치: worktree-guest-order-direct-vendor
- 배경(테오 지시 2026-07-10): 게스트가 /g/[token]/options 에서 주문하면 현재는 운영자가
  수동 발주(dispatch) 후 다시 확정(CONFIRMED)하는 2중 승인 구조. 부가옵션은 해당 벤더
  (부가서비스 공급자)에게 직접 전달되고 소비자↔벤더가 직접 연락하는 모델이어야 하며,
  운영자(ADMIN)는 현황 모니터링만 한다. + 게스트에게 신청 완료·상태 변경이 보이게 한다.

## 범위 (Scope)

### 1. 자동 발주 (BE)
- `app/api/g/[token]/service-orders/route.ts` POST: 카탈로그 항목의 vendor가
  `approvalStatus=APPROVED && active`이면 생성 시점에 `vendorStatus=PENDING_VENDOR`,
  `poSentAt=now` 설정 + 벤더 Zalo `VENDOR_PO`(zaloUserId 연결 시) + 인앱 `VENDOR_PO` 적재.
- 발주 로직은 `app/api/service-orders/[id]/dispatch/route.ts`와 중복되므로 공용 헬퍼로
  추출(`lib/vendor-order.ts` 또는 신규 `lib/vendor-dispatch.ts`) — 두 경로 모두 사용.
- 벤더 미배정·미승인·비활성이면 현행대로 REQUESTED로만 생성(운영자 수동 처리 폴백).
- 운영자 A1 알림(notifyOperatorsServiceOrderRequested)은 유지(정보성).

### 2. 벤더 수락 = 자동 확정 (BE)
- `app/api/vendor/orders/[id]/respond/route.ts`: `action=accept` && `requestedVia=GUEST`
  && `status=REQUESTED`이면 같은 updateMany에서 `status=CONFIRMED`로 원자 전이.
- propose(시간 제안)·reject는 현행 유지 — 예외 케이스는 운영자가 조율(모니터링 대상).
- AuditLog에 status 전이 포함. 운영자 VENDOR_PO_RESPONSE 알림 현행 유지.

### 3. 게스트 셀프 취소 조정 (BE)
- `app/api/g/[token]/service-orders/[id]/cancel/route.ts`: 허용 조건을
  `status=REQUESTED && vendorStatus in (null, VENDOR_REJECTED, PENDING_VENDOR)`로 확장.
- PENDING_VENDOR 취소 시 벤더에게 `VENDOR_PO_CANCELLED` Zalo + 인앱 취소 통보 발송
  (PATCH 취소 경로의 기존 통보 로직 재사용/추출).
- VENDOR_ACCEPTED(=CONFIRMED) 이후는 현행대로 셀프 취소 불가.

### 4. 게스트 화면 (FE — guest 공개 L2 5언어)
- `guest-options.tsx`: 주문 성공 리다이렉트에 `ordered=1` 쿼리 부가.
- `orders/page.tsx` + `guest-orders.tsx`:
  - `?ordered=1`이면 상단 성공 배너("신청 완료 — 서비스 담당자에게 바로 전달되었습니다").
  - 상태 문구 개편: REQUESTED=담당자 확인 중, CONFIRMED=확정(담당자 수락).
  - CONFIRMED(벤더 수락) 주문에 담당자 연락처 노출: vendor name + phone(tel: 링크).
    ★노출 허용=이름·전화만. bankInfo·costVnd·마진 절대 금지.
  - 셀프 취소 버튼 조건을 3번 규칙과 일치시킴(수락 전까지 취소 가능).
- `lib/guest-checkin-load.ts`: requestedOrders에 vendor {name, phone} 포함.
- `lib/guest-i18n.ts` GUEST_LABELS: 신규 라벨 전 언어 동수 추가.

### 5. 문서
- `docs/NOTIFICATIONS.md`: D-01/D-03 트리거에 "게스트 주문 시 자동 발주" 반영,
  D-02/D-04 트리거에 게스트 셀프 취소 반영.
- 신규 ADR: 게스트 주문 직접 발주·자동 확정 결정 기록(번호는 기존 최댓값+1).
- PROGRESS.md 갱신(커밋 직전 1회).

## 수정 금지 구역
- prisma/schema.prisma (스키마 변경 없음 — 기존 필드로 충분)
- 관리자 service-orders-panel 로직 (모니터링 화면 현행 유지; dispatch 버튼은 이미
  vendorStatus 존재 시 숨김/409 처리되므로 무변경. 회귀만 확인)
- 파트너/운영자 주문 생성 경로(requestedVia!=GUEST)는 현행 플로우 유지

## 완료 기준 (테스트 가능)
1. 게스트 주문 생성 응답 후 DB: vendorStatus=PENDING_VENDOR, poSentAt 세팅,
   Notification(VENDOR_PO) 큐 행 존재 (승인 벤더 + Zalo 연결 시).
2. 벤더 respond accept → 해당 GUEST 주문 status=CONFIRMED (운영자 개입 0).
   파트너/운영자 주문은 accept 후에도 REQUESTED 유지.
3. 게스트 취소: PENDING_VENDOR에서 200 + 벤더 취소 통보 적재. VENDOR_ACCEPTED에서 409.
4. /g/[token]/orders: ordered=1 배너 표시, CONFIRMED 주문에 벤더 이름·전화 표시,
   5언어 라벨 누락 0 (파리티 스크립트/검사 통과).
5. 누수 0: 게스트 응답·화면에 costVnd·마진·bankInfo 부재 (QA leak-checklist).
6. `npm run lint && npm run typecheck && next build` 통과. 기존 vitest 회귀 0.

## 검증 방법
- QA 에이전트가 코드 리뷰 + leak-checklist + 로컬 단위검증(가능 범위) 수행.
- 작성자 자기평가 무효 — QA 독립 판정.
