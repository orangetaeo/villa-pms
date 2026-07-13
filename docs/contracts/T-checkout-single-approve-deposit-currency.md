# T-checkout-single-approve-deposit-currency — 체크아웃 승인 단일화 + 보증금 통화 상계

- 상태: 완료 (2026-07-13) — QA PASS(결함 0, 죽은 키 2종 정리). tsc0·vitest 3005·build 통과
- 담당: TDA(설계) + BE + FE, QA 검증
- 배경 (테오 지적, ADR-0041 후속): "보증금 전액 환불이 맞아? 결국은 보증금 차감 후 입금 받는 거잖아. 단어도 틀린 것 같다."
  1. "보증금 전액 환불 / 차감 후 환불 승인" 이원 버튼·문구는 옛 모델 잔재 — 가감산 모델에선 승인 하나로 충분(환불·차감 구분은 서버가 damageFound·라인 데이터로 판정, payload 동일).
  2. 보증금이 ₩(체크인에서 통화 선택 가능)이면 DEPOSIT 상계 라인이 ₫ 전용이라 상계 불가 — "차감 후 입금" 흐름이 비VND 보증금에서 성립 안 함.

## 설계 (TDA 결정)

1. **하단 액션 단일화**: "보증금 전액 환불"·"차감 후 환불 승인" 2버튼 → **"정산 확정·체크아웃 승인" 1버튼**.
   - 활성 조건 = (파손 토글 ON이면 금액+메모/사진 완비) && !잔여수납(하드 게이트, PR #285) && !busy.
   - 하단 바 표시 = 보증금 라벨 + **환불 예정액(보증금 통화 기준)**. 안내문("환불 버튼을 누르면…") 새 문구로 교체.
   - payload 불변(서버 변경 없음 — 환불/차감은 기존대로 서버 파생).
2. **DEPOSIT 상계 라인 통화 = 보증금 통화**(₫ 전용 해제):
   - 서버 검증: DEPOSIT 라인 currency ≠ booking.depositCurrency → 400 `DEPOSIT_CURRENCY_MISMATCH`(기존 DEPOSIT_NOT_VND 대체·일반화). Σ DEPOSIT ≤ depositAmount − (depositCurrency=VND일 때만 파손차감). NONE/HELD 규칙 기존 유지.
   - `depositDeductVnd`(VND 의미 컬럼) = 파손(VND) + **VND 상계만** 합산. 비VND 상계는 CheckoutSettlementLine이 정본(하위호환: VND 보증금 동작 불변).
   - 환불 예정 표시 = depositAmount − Σ상계(보증금 통화) − (VND 보증금이면 파손차감도). KRW는 Int·VND는 BigInt(부동소수점 금지).
   - 한계(명시): 비VND 보증금 + 파손 차감은 보증금 잔액 계산에 자동 반영하지 않음(파손차감은 VND 기록) — FE가 파손 ON+비VND 보증금이면 안내 문구 표시. 정밀 처리는 후속.
3. **FE 자동 상계 제안 일반화**: 보증금 HELD면 통화 무관 제안 — 제안액 = min(보증금 잔여, 청구 잔여를 보증금 통화로 환산) 절삭(₫=1만 내림·₩=1,000원 내림·$=정수 내림, 기존 규칙). DEPOSIT 라인 선택 시 통화=보증금 통화 고정. dirty 규칙 기존 유지.
4. 관련 문구 정비: settlementMethods.DEPOSIT("보증금 차감") 유지, 하단 안내·버튼·게이트 문구 ko/vi 동시.

## 완료 기준
1. 단일 승인 버튼 — 파손 없음+상계 없음(전액 환불 케이스)·파손·상계 케이스 모두 동일 버튼으로 제출, 서버 저장 결과는 기존과 동일(REFUNDED/PARTIAL_DEDUCTED 파생 불변).
2. ₩ 보증금 예약: DEPOSIT ₩ 라인 자동 제안·저장 → depositDeductVnd 미오염(VND 상계 아님), 라인 정본, 환불 예정=₩ 기준.
3. 400: DEPOSIT 라인 통화≠보증금 통화 / Σ초과 / NONE (기존 3종 대체·유지).
4. VND 보증금 기존 동작 바이트 동일 수준 무회귀(테스트).
5. tsc·vitest 전체·build 통과. QA 독립 검증.

## 수정 금지 구역
- design-audit/, 루트 *.png. messages/*.json 키 추가·본 계약 문구 교체만.
