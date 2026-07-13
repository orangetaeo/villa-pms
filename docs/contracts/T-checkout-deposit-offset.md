# T-checkout-deposit-offset — 체크아웃 보증금 상계(가감산) 정산 + 화면 재배열

- 상태: 완료 (2026-07-13) — QA PASS(결함 0), tsc0·vitest 2961·build 통과. ADR은 번호 충돌로 0041로 확정
- 담당: TDA(설계) + BE + FE, QA 검증
- 배경 (테오 지시 2건):
  1. "보증금이 있으면 부가서비스·미니바를 **차감하고** 입금 처리하면 되는데 굳이 환불을 하게 하는 프로세스는 잘못" — 청구 전액을 따로 수납받고 보증금을 따로 환불하는 현재 흐름 대신, **보증금에서 가감산 후 잔액 환불 또는 부족분만 최종 결제**.
  2. "파손·손실 리포트에 금액이 있으면 그것도 차감. UX는 파손 리포트를 최상단 → 미니바 → 부가서비스 결제 확인 → 가감산 → 최종 결제" — 화면 섹션 순서 재배열.
- **동반 수정 (버그)**: 미니바 이중 계상 — 현재 미니바 소모분이 게스트 청구(guestChargeVnd)에도, 보증금 차감(deductionVnd)에도 동시 반영됨(FE가 damageFound=true로 minibarTotal 합산 전송). UI 안내대로 조작하면 미니바를 두 번 수취.

## 설계 (TDA 결정, ADR-0041)

1. **`GuestSettlementMethod`에 `DEPOSIT` 추가**(additive SQL) — 수납 라인(PR #276의 CheckoutSettlementLine)의 수단으로 "보증금 차감"을 표현. **currency=VND 전용**(보증금이 VND이므로). 재사용: 라인 원장·MIXED 파생·settledVnd 캐시 구조 그대로.
2. **미니바 보증금 자동 차감 제거(이중 계상 수정)** — `deductionVnd`=파손 차감만, `damageFound`=실제 파손만 true. 미니바는 게스트 청구로만 1회 계상. 미니바를 보증금으로 받고 싶으면 DEPOSIT 라인으로 상계(아래 FE 자동 제안).
3. **`resolveDepositOutcome` 확장** — 입력에 depositOffsetVnd(ΣDEPOSIT 라인) 추가:
   - HELD: (파손차감 + 상계) > 0 → PARTIAL_DEDUCTED / 0 → REFUNDED. 파손 시 파손차감>0 필수·무파손 시 파손차감 금지(기존 유지).
   - NONE(미수취): DEPOSIT 라인 존재 → RangeError(라우트 400). 기존 NONE 규칙 유지.
4. **서버 검증**: ΣDEPOSIT ≤ 보증금(VND) − 파손차감 (초과 → 400 DEPOSIT_OFFSET_EXCEEDS). DEPOSIT 라인 currency≠VND → 400. depositCurrency가 VND 아닌 예약(희귀)은 DEPOSIT 라인 400(수동 폴백). 보증금 원천은 서버가 Booking에서 조회(클라 신뢰 금지) — FE의 depositVnd prop 산출 로직과 동일 기준.
5. **`depositDeductVnd` 저장 = 파손차감 + ΣDEPOSIT 상계**(보증금에서 빠진 총액 — 기존 표시·통계 하위호환). 수단·금액 상세는 라인 원장.
6. **`narrowVendorSettleMethod`를 화이트리스트 방식으로 변경**(CASH|BANK_TRANSFER|OTHER만 통과) — enum 값 추가 시 벤더 정산 소비처 회귀 재발 방지(PR #276 교훈).
7. **FE 섹션 재배열(테오 지시 순서)**: ① 파손·손실 리포트(최상단) ② 미니바 확인 ③ 부가서비스 청구 확인 ④ **가감산 요약**: 보증금 − 파손 − 총청구(환산) = 최종 (양수=환불 예정액 / 음수=추가로 받을 금액) ⑤ 수납 라인 — **DEPOSIT 라인 자동 제안**: 보증금 HELD·VND일 때 min(보증금−파손, 총청구 환산 VND 1만₫ 절삭)을 프리필(수동 편집·삭제 가능, 운영자가 편집한 후에는 자동 재계산으로 덮지 않음) ⑥ 버튼: DEPOSIT 라인·파손 있으면 "차감 후 환불 승인"만 활성(전액 환불과 배타).
8. 예약 상세: `methods.DEPOSIT` i18n(ko "보증금 차감"/vi) — 라인 표시는 기존 UI 재사용.

## 완료 기준 (테스트 가능)
1. 미니바 이중 계상 소멸: 미니바 소모 시 guestCharge에만 반영, depositDeductVnd·damageFound 미오염(파손 없으면 damageFound=false 저장).
2. DEPOSIT 라인 저장 → depositDeductVnd=파손+상계, 환불 표시=보증금−파손−상계, settlementMethod 파생(단독=DEPOSIT, 혼합=MIXED).
3. 400 계열: 상계 초과·보증금 NONE·DEPOSIT 라인 비VND.
4. 구 payload(method+amounts)·구 데이터 표시 하위호환 유지.
5. 화면 순서 = 파손 → 미니바 → 부가서비스 → 가감산 요약 → 수납 → 버튼.
6. lib 단위테스트 + tsc 0 + vitest 전체 + next build 통과. QA 권한 누수 재검(라인 금액 showFinance 게이트 유지).

## 수정 금지 구역
- `design-audit/`, 루트 `*.png` (다른 세션·사용자 산출물)
- `messages/ko.json`·`vi.json`은 키 추가만
