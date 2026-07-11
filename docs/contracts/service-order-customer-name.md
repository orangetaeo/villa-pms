# 계약서: 부가서비스 주문 이용자 이름 — 소비자 입력/대표자 기본값 + 벤더 노출

- 담당: BE (구현) / QA (독립 검증) / 메인 세션(Fable) = TDA 설계·스키마 승인
- 브랜치: worktree-service-order-customer-name
- 배경(테오 지시 2026-07-11): 마사지 등 부가서비스 신청 시 소비자 이름을 입력받거나
  예약에 이미 등록된 대표자 이름(Booking.guestName)을 사용해 마사지 업체(벤더)에
  보여줘야 한다 — 벤더가 누구를 응대하는지 알아야 이행 가능.

## 설계 결정 (TDA)
- 스키마 additive 1필드: `ServiceOrder.customerName String?` — 주문 시점 이용자 이름
  스냅샷(예약 대표자와 다를 수 있음: 일행 중 다른 사람이 이용).
- 게스트 신청 폼에 이름 입력칸 1개(주문 묶음 공통) — **예약 대표자 이름 자동 채움**
  (텍스트 입력 최소화 원칙), 수정 가능, 비우면 서버가 대표자 이름 폴백.
- 벤더 노출은 `customerName ?? booking.guestName` 폴백 — 이름 미기록 구주문·
  관리자/파트너 발주도 백필 없이 전부 커버.
- PII 범위: **이름만**(전화·기타 금지). 벤더는 이행 대상 식별 목적의 정당 수신자.

## 범위 (Scope)

### 1. 스키마 + 마이그레이션 (메인 세션 수행)
- `ServiceOrder.customerName String?` + migrations-manual raw SQL 라이브 적용.

### 2. 게스트 신청 (BE+FE)
- `app/g/[token]/options/page.tsx` 로드에 booking.guestName 포함(자기 예약 — 누수 아님)
  → GuestOptionsProps 확장.
- `guest-options.tsx`: 하단 합계 영역 위(또는 카드 목록 아래) 이름 입력칸 —
  라벨 "이용자 이름", 대표자 이름 prefill, max 80. 주문 POST body에 customerName 포함
  (묶음 공통 1값). GUEST_LABELS 5언어.
- `app/api/g/[token]/service-orders/route.ts` POST: zod customerName(옵션, trim·max 80)
  → 빈값이면 booking.guestName 폴백 → create data에 저장.

### 3. 벤더 노출 (BE+FE)
- 자동 발주·수동 dispatch의 VENDOR_PO Zalo payload에 customerName 추가
  (lib/vendor-dispatch.ts 호출부 select 확장 + `?? booking.guestName` 폴백).
  lib/zalo.ts VENDOR_PO 빌더에 이름 줄 추가(없으면 줄 생략 — 구 payload 하위호환).
- `/api/vendor/orders` ROW_SELECT에 customerName + booking.guestName, mapRows에서
  `customerName ?? guestName`으로 단일 필드 노출 → vendor-board 발주함·예약현황 카드에
  이용자 이름 표시(person 아이콘). vendor NS ko/vi.
- 운영자 인앱/기존 알림은 무변경(운영자는 예약 상세에서 확인 가능).

### 4. 관리자 (선택 아님·경량)
- service-orders-panel 주문 행에 이용자 이름 표시(있을 때만) — 예약 대표자와 다른
  경우 식별용. adminServiceOrders/bookings NS 확인 후 키 추가.

### 5. 문서·테스트
- docs/NOTIFICATIONS.md D-01 payload에 이용자 이름 추가 기록.
- 테스트: POST customerName 저장·빈값 대표자 폴백·max 초과 400, 벤더 API 폴백 노출,
  zalo 빌더 이름 줄(있음/없음 하위호환).
- PROGRESS.md는 메인 세션이 커밋 직전.

## 수정 금지 구역
- 상태기계(respond/proposal/tickets/complete) 무변경. 시간제안·티켓·날짜검색 경로 무변경.
- PII: customerName 외 게스트 개인정보(전화 등) 벤더 노출 금지.

## 완료 기준
1. 게스트 신청 폼에 대표자 이름 prefill 입력칸, 수정값이 주문에 저장. 빈값=대표자 폴백.
2. 벤더 Zalo 발주 문구·벤더 보드 카드에 이용자 이름 표시(구주문은 대표자 폴백).
3. 구 payload/구주문 하위호환(이름 없으면 줄 생략·폴백). 누수: 이름 외 PII 없음.
4. 게스트 5언어·vendor/admin ko/vi 파리티. lint·typecheck·vitest 회귀 0·build 통과.
