# T-pr82-redo-concurrency — PR #82(동시성·타임존 12건) 현행 이식

- 상태: **완료** (2026-07-10, PR #82 대체 — 원본은 2026-06-26 작성 후 main 전진으로 충돌·일부 무효화)
- 발단: 테오 "열린 PR 4건 판단해서 정리". #82는 분석 결과 수정 대부분이 여전히 미반영(실결함)이라 폐기 대신 현행 코드 기준 선별 이식.

## 이식 내역 (판정: 이식 10 · 부분 보강 1 · 스킵 1)

| 항목 | 판정 | 내용 |
|---|---|---|
| service-orders PATCH 상태 가드 | 부분 보강 | vendorId 경로는 기존 RMW 가드 존재 — 일반필드 경로만 updateMany+409 |
| dispatch 이중 발주 차단 | 이식 | updateMany 가드 (이중 Zalo 발주 방지) |
| vendor respond 동시 수락/거절 | 이식 | updateMany 가드 |
| 입금 동시성 락 | 이식 | pg_advisory_xact_lock(receivable:bookingId) — 채권 카운터 lost-update 방지 |
| 파트너지정 vs 확정 경합 | 이식 | 동일 락 + confirmHold 트랜잭션 직렬화 |
| partner-invoice 수납 락 | 이식 | 수납 paidVnd lost-update 방지 |
| 입금 삭제 채권 역계산 | 이식 | reversePaymentFromReceivable 신설(순수·0하한) — LEDGER 역분개와 별개 저장소라 이중반영 아님, invoiceId 결제는 기존 조기차단으로 ADR-0027 경로와 불간섭 |
| VN 캘린더 일 기준 | 이식 | ical since·연체 판정(markOverdueReceivables·hasOverdue·aging) UTC일→VN일 |
| signup P2002 레이스 | 이식 | 사전체크 뒤 create try-catch P2002→409 (레이스 창 봉합) |
| availability board 논널 단언 | 이식 | 안전 폴백 |
| 사전체크 409 자체 | 스킵 | 이미 main에 존재 |

## 검증

- [x] tsc·next build 통과 (최신 main 리베이스 후 재실행)
- [x] vitest 163파일 / **2516 통과** (신설 tests/service-order-concurrency.test.ts + 역계산·연체 경계·락 테스트 24건 추가)
- [x] 작성자(BE 에이전트)≠검토자(메인 세션) — 돈 계산(역계산)·락 순서 디프 직접 검토

## 후속

- 원본 PR #82는 본 이식 PR 머지 후 superseded로 닫음.
