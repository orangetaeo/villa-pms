# 계약: 미니바 전환 자동 회수 (RECOVER) — ADR-0019 Phase 2 / ADR-0021 D6

날짜: 2026-06-26 / 담당: TDA·BE / 평가: QA(독립)
브랜치: `wt/minibar-recover` (origin/main 기준)
근거: ADR-0019 §line 57·60(MinibarMovementType에 RECOVER·전환별 보충/회수), ADR-0021 §6.1 D6(테오 2026-06-26 확정). 메모리 [[minibar-architecture]]·[[supplier-direct-sales-channel]].

## 배경
미니바 = 운영자(우리) 재고. 빌라의 **다음 예약 seller**에 따라 체크아웃 전환 시 재고 이동이 갈린다(ADR-0021 D6):
- 다음 = **SUPPLIER(공급자 직접판매)** → 우리 재고 **전량 회수**(우리가 운영 안 하는 판매에 재고 미잔류).
- 다음 = **OPERATOR / 없음** → par까지 보충(RESTOCK) = **수동 유지**(아래 범위 밖 참조).

현재 `MinibarMovementType = {RESTOCK, CONSUME, ADJUST}` — RECOVER 부재. 현재고 = MinibarStockMovement ΣqtyDelta(원장 단일소스, lib/minibar-inventory.ts).

## 설계 판단 (구현 결정·가정 명시)
1. **RECOVER만 자동화**(이번 범위). 자동 RESTOCK은 **미구현** — 입고는 물리적 매입(unitCostVnd 수반)이라 체크아웃마다 자동 기록하면 원가 데이터 오염. 입고는 기존 `/inventory` 수동 화면 + 부족(low) 알림 유지(ADR-0021 D6의 "par까지 보충"은 수동 워크플로로 충족).
2. **트리거 = 체크아웃 완료**(`completeCheckout`, 빌라가 비는 전환 시점). CONSUME 기록 직후 같은 트랜잭션에서 평가.
3. **다음 예약 판정** = 같은 빌라의 미래 예약 중 status ∈ {HOLD, CONFIRMED, CHECKED_IN}, checkIn ≥ 이번 checkOut, checkIn 오름차순 첫 건. 그 seller === SUPPLIER 면 회수.
4. **회수량** = 품목별 현재고 onHand>0 인 것마다 RECOVER 이동(qtyDelta = −onHand) → 현재고 0. onHand≤0 품목은 미생성.
5. **체크아웃 시 다음 예약 미정**이면 회수 안 함(보수적). 공급자 예약이 사후 확정되는 경로의 회수는 **후속**(아래 범위 밖)로 문서화.

## ① 구현 범위
- **스키마(TDA)**: `MinibarMovementType`에 `RECOVER` 추가. additive — raw SQL `ALTER TYPE ... ADD VALUE`(라이브 DB), `prisma generate --schema` 명시. `prisma db push` 금지.
- **BE 순수함수**: `lib/minibar-inventory.ts`에 `planRecover(onHandByItem: {minibarItemId,onHand}[]): {minibarItemId, qtyDelta}[]`(onHand>0 → −onHand). + `isSupplierNext(seller)` 판정 헬퍼(또는 호출측 인라인).
- **BE 통합**: `lib/checkout.ts completeCheckout`에서 CONSUME 기록 후, 빌라 다음 예약 seller 조회 → SUPPLIER면 품목별 현재고(ΣqtyDelta, 방금 CONSUME 포함) 집계 → RECOVER 이동 생성(createdBy=actor, note="전환 회수: 다음 공급자 직접판매") + writeAuditLog(또는 기존 패턴).
- **테스트**: 순수함수(planRecover 경계) + 통합(다음=SUPPLIER → 회수로 현재고 0 / 다음=OPERATOR·없음 → 회수 0 / onHand 0 품목 미생성 / OPERATOR 경로 회귀 0).

## 범위 밖 (명시)
- 자동 RESTOCK(설계 판단 1). 공급자 예약 사후확정 시 회수 트리거(설계 판단 5) — 후속 ADR-0019 보강.
- 게스트 셀프체크인·서비스 카탈로그 등 ADR-0019 타 영역(이미 구현됨).

## ② 완료 기준 (QA 하드 게이트)
1. `MinibarMovementType`에 RECOVER 라이브 DB 반영 + generate 후 typecheck 0.
2. 체크아웃 시 다음=SUPPLIER → 그 빌라 전 품목 현재고 0(RECOVER 음수 이동), 다음=OPERATOR/없음 → RECOVER 0.
3. 미니바 소비 정산(기존)·보증금·통합청구 회귀 0. seller=SUPPLIER/OPERATOR 양 경로 체크아웃 정상.
4. **누수**: RECOVER 경로·응답에 운영자 원가(unitCostVnd/costVnd) 노출 0(원장 기록만, 표시 없음). 공급자 체크아웃에서도 동일.
5. lint·typecheck 0, 관련 테스트 통과, `next build` 성공.

## ③ 검증
- 단위/통합 테스트 + 독립 QA(작성자≠평가자) 누수·회귀.
