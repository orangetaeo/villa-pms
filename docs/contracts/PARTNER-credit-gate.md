# 계약: PARTNER-credit-gate — 여신 게이트 정합·권한 강화 (QA Minor 마무리)

**브랜치**: wt/partner-credit-gate (origin/main 기준)
**ADR**: ADR-0022 (PARTNER B2B 미수·여신). 에픽 QA Minor 잔여 정리.

## 범위
1. **재지정 시 신용게이트 재실행** — `PUT /api/bookings/[id]/partner`가 확정 후 파트너 지정 시 채권을 생성하지만 `evaluateConfirmCredit`(한도초과·연체·BLOCKED/SUSPENDED 차단)를 건너뛴다. confirm(lib/hold.ts)과 동일하게 게이트 적용 → 차단 시 409 `PARTNER_CREDIT_BLOCKED`(채권·지정 롤백).
2. **신용한도·등급 변경 OWNER 전용화** — `PATCH /api/partners/[id]`의 creditTier·creditLimitVnd **값 실변경**은 `isSystemAdmin`(OWNER/ADMIN) 전용. MANAGER는 연락처·메모 등 다른 필드만 수정(값 미변경 시 통과 — 폼 전체 전송 호환). 위반 시 403 `CREDIT_FIELDS_OWNER_ONLY`.

## 수정 금지 구역
- `app/(admin)/inventory/**`, `lib/minibar*` — 미니바 세션
- `app/api/partner-invoices/**`, `lib/partner-invoice*` — PARTNER-3b-UI(PR #44) 점유
- `prisma/schema.prisma` — 변경 없음

## 완료 기준
- [ ] 차단 파트너(BLOCKED/한도초과)를 확정 예약에 재지정 → 409, 채권 미생성
- [ ] 정상 파트너 재지정 → 채권 생성(기존 동작 유지)
- [ ] MANAGER가 creditLimit/tier 변경 시도 → 403, 다른 필드만 수정은 통과
- [ ] OWNER/ADMIN은 한도·등급 변경 가능
- [ ] typecheck 0 · 단위테스트 · next build 통과
