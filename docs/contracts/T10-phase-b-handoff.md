# F10 Phase B 핸드오프 — 공급자 공개 판매 링크 (T10.6~T10.7)

> 다음 세션 킥오프 문서. Phase A(T10.0~T10.5+T10.2b)는 **PR #48로 완료**. 이 문서는 Phase B 착수 전 읽고, 정식 계약서(docs/contracts/T10.6-T10.7-...md)를 작성·선점 커밋한 뒤 구현한다.

## 0. 세션 시작 절차 (필수)

1. **PR #48이 main에 머지됐는지 먼저 확인** (`git log --oneline origin/main | grep F10` 또는 GitHub). 머지 전이면 머지 대기.
2. **새 격리 워크트리에서 진행** (병렬 세션 안전 — CLAUDE.md §0):
   ```
   powershell -ExecutionPolicy Bypass -File scripts\wt-new.ps1 -Name f10-phase-b
   cd C:\Projects\_worktrees\villa-pms-f10-supplier-direct-... (생성된 경로)
   claude
   ```
   → **반드시 머지된 최신 main 기준**으로 브랜치가 생성됨(wt-new는 origin/main 기준).
3. 착수 결정 즉시 **정식 계약서를 단독 커밋·푸시로 선점**(병렬 규칙 #8). docs/contracts/ 확인 후 중복 회피.

## 1. Phase B 범위 (ADR-0021 §7)

**목표**: 공급자가 자기 빌라의 **공개 판매 링크**를 만들어 자기 고객이 직접 셀프 가예약. Phase A(수동 기록)에 이은 본격 직접 판매 도구.

### T10.6 — 공급자 판매가
- 스키마: `VillaRatePeriod.supplierSalePriceVnd BigInt?` 추가 (**raw SQL ALTER**, db push 금지 — [[db-schema-drift-villa-source]]). 운영자 `salePriceVnd`/마진과 **완전 별개**(공급자 자기 정가).
- UI: `app/(supplier)/my-villas/[id]/rate-periods` 에 공급자 판매가 입력(기존 supplierCostVnd 입력 옆). vi.
- 누수: 공급자는 자기 판매가만, 운영자 salePriceKrw/마진 절대 비노출(기존 rate-periods 누수 가드 유지).

### T10.7 — 공급자 공개 판매 링크
- **Proposal 모델 재사용**(seller 개념 확장): 공급자가 자기 빌라+기간으로 공개 토큰 링크 생성.
- 권한: 제안 생성 권한을 `canSetPrice`(운영자)에서 **분리** → 신규 `canCreateSupplierLink`(SUPPLIER 자기 빌라만). lib/permissions.ts.
- 스코프: `supplierId` 강제, **자기 빌라·자기 판매가만** 노출. 운영자 제안링크(/p/[token])와 **토큰 네임스페이스·권한 분리**.
- 흐름: 공급자 고객이 링크 열람(공급자 판매가·실시간 가용성) → 가예약(HOLD, 기존 lib/hold.ts 재사용) → 공급자 입금 확인 → CONFIRMED(seller=SUPPLIER).
- 선착순·정산 제외는 Phase A와 동일(기존 availability 잠금·settlement seller=OPERATOR 필터 그대로 적용됨).

## 2. Phase A에서 이미 깔린 토대 (재사용)

- `Booking.seller`(OPERATOR|SUPPLIER), `supplierSalePriceVnd` — **라이브 DB 적용 완료**.
- `lib/supplier-direct-booking.ts`(직접예약 트랜잭션 패턴), `lib/supplier-booking-access.ts`(공급자 스코프 가드), `lib/availability.ts`(선착순 잠금), `lib/settlement.ts`(seller=OPERATOR 제외 — 직접판매 자동 제외 그대로 동작).
- 디자인: Phase B 공개 링크 화면은 **Stitch 신규 생성 필요**(/p 톤 계승, 공급자 판매가 표시). DESIGN 선행.

## 3. 핵심 함정 (Phase A에서 겪음)

- ⚠️ **공유 정션 node_modules + prisma generate 레이스**: 병렬 세션이 다른 스키마로 prisma generate 하면 새 enum/필드의 런타임/타입이 사라져 빌드·테스트가 **거짓 그린/거짓 실패**. 증상=`BookingSeller`(또는 새 필드) undefined·"no exported member". 복구=`npx prisma generate --schema prisma/schema.prisma` 재실행. **빌드 직전 generate + enum 존재 확인** 필수. ([[prisma-generate-eperm-build-break]])
- 단어 `DIRECT` 재사용 금지(seller=SUPPLIER로 표현 — BookingChannel.DIRECT·Villa.source=DIRECT 충돌).
- 작성자≠평가자: 구현 후 **독립 QA 누수 검사**(타 공급자 빌라·우리 판매가 비노출) 필수.

## 4. 잔여 후속 (Phase B 범위 밖, 백로그)
- 미니바 전환별 자동 보충/회수(다음 booking seller 인지) — ADR-0019 Phase 2.
- T4.4 베트남 사용자 실사용 테스트에 직접예약·검수 화면 포함.
