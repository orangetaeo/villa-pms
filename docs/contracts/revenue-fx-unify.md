# 계약서 — 매출관리 통화 통합 환산 표시 + 환산 후 마진 (Phase 1)

- 착수: 2026-06-27
- 브랜치: `wt/revenue-fx-unify`
- 담당: BE+FE (이 세션)

## 범위 (수정하는 파일)
- `lib/revenue-ledger.ts` — 환산·통합·환산후마진 로직 (핵심)
- `app/(admin)/revenue/page.tsx` — 현재 환율 주입 + 직렬화
- `app/(admin)/revenue/revenue-client.tsx` — 통합 환산 KPI + 통화별 원본 병기 UI
- `app/api/revenue/export/route.ts` — CSV 환산 컬럼
- `lib/statistics.ts` — 표기 용어 일관성(마진 로직 무변경)
- `messages/ko.json` · `messages/vi.json` — `adminRevenue` 키 **추가만**
- `lib/revenue-ledger.test.ts` — 테스트 추가

## 완료 기준 (테스트 가능)
1. /revenue에 "통합 환산 매출(≈VND)" + 통화별 원본(KRW·VND·USD칸) 병기 표시
2. 마진이 KRW 예약(예약시점 fxVndPerKrw 스냅샷, 없으면 현재 환율 폴백) 환산분 포함
3. 환율 미상 KRW 건은 fxMissing으로 마진 제외 + 건수 표기
4. USD는 표시 칸만(값 0) — Phase 1, 실제 입력은 Phase 2
5. STAFF/공급자/공개경로 누수 0 (canViewFinance 게이트 유지)
6. lint·typecheck·vitest·build 통과

## 수정 금지 구역
- 스키마(prisma/schema.prisma) — Phase 1은 스키마 변경 없음
- pricing.ts·settlement-finance.ts·payment.ts·proposal.ts — Phase 2 대상, 이번 미접촉
- 다른 세션 작업 파일(prisma/seed-*, docs/usage-*)
