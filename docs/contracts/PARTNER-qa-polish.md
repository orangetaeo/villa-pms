# 계약: PARTNER-qa-polish — 연체 미수 KPI 정확화 + /api/partners 경량목록 분리

**브랜치**: wt/partner-qa-polish (origin/main 기준). ADR-0022 잔여 QA Minor 2건.

## 범위
1. **연체 미수 KPI 정확화** — /receivables의 "연체 미수"가 연체 파트너의 *전체* 미수를 합산해 라벨과 괴리. `lib/partner` 순수 헬퍼 `overdueOutstanding(receivables, asOf)`(기한경과·OVERDUE 채권 잔액 합) 추가 → `PartnerAggregate.overdueOutstandingVnd` 도출 → `summarizeReceivables`가 진짜 연체액 합산. 라벨 무변경.
2. **/api/partners 경량목록 분리** — 예약 파트너 지정 드롭다운(partner-assign-card)이 전체 Aging 집계를 끌어옴. 경량 `GET /api/partners/options`(?type 필터, id·name·nameVi·type·creditTier·status만) 신설 + assign-card 전환. 기존 GET /api/partners(목록 화면용)는 유지.

## 수정 금지 구역
- `app/api/partner-invoices/**`·`lib/partner-invoice*`(PR #44), `app/api/bookings/[id]/partner/route.ts`·`app/api/partners/[id]/route.ts`(PR #45)
- `app/(admin)/inventory/**`·`lib/minibar*`(미니바 세션), `prisma/schema.prisma`(무변경)

## 완료 기준
- [ ] 연체 KPI = 실제 기한경과 채권 잔액 합(미도래 제외), 단위테스트
- [ ] options 엔드포인트 light shape·canViewFinance 게이트·type 필터, assign-card 동작 유지
- [ ] typecheck 0 · 테스트 · build 통과
