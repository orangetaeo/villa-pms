# 계약서 — 파트너 청구서 수납 → LEDGER COLLECTION 연결 (ADR-0024)

- 태스크: ADR-0024 — 마감 청구서(PartnerInvoice) 수납을 복식부기 LEDGER COLLECTION에 적재
- 담당 세션: **wt/ledger-collection** (격리 worktree — 공유 메인 직접작업 금지)
- 상태: **착수 선점** (2026-06-26) — 1단계 = ADR-0024 초안 작성·합의. 합의(D1~D4 확정) 전 구현 코드 금지.
- 정본: docs/decisions/ADR-0024-partner-invoice-payment-ledger.md
- 선행: ADR-0018 LEDGER(머지, main — postCollection·reverseCollection·verifyLedger), ADR-0022 파트너 청구서(머지, main — recordInvoicePayment)

## 배경 (요약)

수납 경로가 둘인데 청구서 경로만 LEDGER 미적재 → B2B 매출이 복식부기에서 누락. `Payment.invoiceId` 필드는 이미 존재하나 `recordInvoicePayment`가 Payment row를 안 만들고 paidVnd만 누적. 상세·설계안·대기결정(D1~D4)은 ADR-0024 참조.

## 이번 작업 (Phase 1 — 기획)

- [x] ADR-0024 초안 작성 (Proposed)
- [ ] 테오 결정 D1(통화)·D2(백필)·D3(정정)·D4(모델) 확정 → ADR Accepted 전환
- [ ] (Accepted 후) 구현 스프린트 계약서 별도 작성

## 수정 금지 구역 (병렬 세션 규칙 #2)

- **ADR-0021 Phase B 세션 영역**: `wt/f10-phase-b`가 동시 진행 중. F10 관련 파일(공급자 직접판매·판매링크) 일절 미수정.
- 공유 메인 폴더 직접 커밋 금지 — 본 세션은 wt/ledger-collection 격리 worktree에서만 커밋.
- 구현 단계에서 `prisma/schema.prisma`(Payment) 변경은 1세션 전담 + raw SQL ALTER(db push 금지).

## 완료 기준 (구현 단계 — Accepted 후)

1. 청구서 수납 시 Payment row 생성 + COLLECTION 적재(증분 amountVnd, paymentId 멱등).
2. 통화별 항등식 0(CASH_VND +/ REVENUE −), verifyLedger 청구서 수납 포함 교차검증 통과.
3. 이중계상 0(선금 예약경로 + 잔금 청구서경로 합 = 실입금), 멱등(재시도 중복 0).
4. 실거래 백필 멱등, 데모 제외(ADR-0018 #3).
5. 누수 0(COLLECTION ADMIN 전용), typecheck0, next build, 단위테스트.

## 검증

- 단위테스트: recordInvoicePayment COLLECTION 적재·균형·멱등, 백필 멱등.
- `npm run typecheck` / `npx next build`.
- LEDGER 무결성: verifyLedger 통화별 합 0 + 매출/현금 교차검증.
