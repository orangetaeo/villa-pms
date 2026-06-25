# 계약서 — 정산 2차 P2-3 S5 계정별 잔액 대시보드

- 태스크: P2-3 S5 (ADR-0018 후속)
- 담당 세션: wt/ledger-dashboard
- 선행: P2-3 LEDGER(머지, main), verifyLedger·ledgerLine 존재

## 범위
- `lib/ledger.ts`: `summarizeLedgerBalances(accountBalances)` 순수 함수 추가 — 계정×통화 잔액(부호)을 운영자 표시용으로 해석.
  - 보유현금 CASH_KRW/CASH_VND(차변, 그대로), 공급자 미지급채무(=−SUPPLIER_PAYABLE, 양수=갚을 돈),
    매출(=−REVENUE, 통화별), 원가 COGS(그대로), 환차손익 순액(=−FX_GAIN_LOSS, 양수=이익).
- `lib/ledger.test.ts`: 부호 해석 단위테스트.
- `app/(admin)/settlements/page.tsx`: verifyLedger 1회 호출 결과(accountBalances)로 **장부 잔액 패널** RSC 렌더(기존 환차 경고 배너와 같은 자리). settlements-view.tsx **미수정**(충돌 회피).
- i18n: adminSettlements에 ledger 잔액 라벨 ko/vi 추가.

## 수정 금지 구역
- settlements-view.tsx(타 세션 활성 가능) 미수정. messages 키 추가만. 공유 메인 직접 커밋 금지.

## 완료 기준
1. 패널이 통화별 현금·미지급채무·매출·원가·환차손익을 부호 올바르게 표시(테스트).
2. ADMIN(canViewFinance)만 — 기존 page 가드 하 렌더(공급자 미노출).
3. LEDGER 비어도(잔액 0) 정상 표시. 마이그레이션 미적용 등 실패 시 패널 생략(페이지 정상).
4. typecheck0 · 무회귀 · next build · 누수0.

## 검증
- `npx vitest run lib/ledger.test.ts`
- `npm run typecheck` / `npx next build`
