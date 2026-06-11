# Skill: 가용성·HOLD 패턴

## 단일 소스
- 가용성 판정은 lib/availability.ts 한 곳에서만. 화면·API에서 중복 구현 금지

## 규칙
- 구간은 [checkIn, checkOut) half-open — checkOut일은 다음 예약 checkIn 가능
- available = no Booking(HOLD|CONFIRMED|CHECKED_IN) overlap AND no CalendarBlock overlap AND villa.status=ACTIVE
- 판매가능 = available AND villa.isSellable (검수 게이트)

## HOLD 동시성 (SPEC F3)
- prisma.$transaction 안에서: ① 겹침 재조회 ② 없으면 생성 — 둘을 한 트랜잭션으로
- Postgres advisory lock(villaId 해시) 또는 SERIALIZABLE 사용
- HOLD 생성 시 totalSaleKrw·supplierCostVnd 스냅샷 저장 (요율 변경 무영향)

## 교훈 축적
- (T1.3 QA, 2026-06-11) **날짜는 UTC 자정 정규화 후 판정에 투입** — @db.Date는 UTC 자정으로 저장되므로, API 입력 문자열을 `new Date()`로 그냥 변환하면 시간 성분이 섞여 half-open 경계가 어긋날 수 있다. route 경계에서 `new Date("YYYY-MM-DDT00:00:00.000Z")` 형태로 정규화할 것
- (T1.3 QA, 2026-06-11) **findSellableVillaIds의 villaIds 생략(전체 재고 조회)은 ADMIN route 전용** — SUPPLIER·공개 컨텍스트에서 호출하면 재고 비공개 원칙 위반. 호출부 role 검사를 leak-checklist로 점검
- (T1.3, 2026-06-11) 가용성 모듈은 순수 판정층(evaluateAvailability)과 DB 래퍼층으로 분리 — DB 없이 단위 테스트 가능, HOLD 트랜잭션은 래퍼에 tx 주입해 재사용
- (T1.4 QA, 2026-06-11) **`prisma.$transaction` 안에서 재조회→생성만으로는 race가 안 막힌다** — Postgres 기본 격리(READ COMMITTED)에서는 동시 두 트랜잭션이 모두 "겹침 0건"을 읽고 둘 다 INSERT에 성공한다. 트랜잭션 첫 줄에 `SELECT pg_advisory_xact_lock(hashtext(villaId))`(또는 `isolationLevel: 'Serializable'` + 직렬화 실패 재시도)을 반드시 추가할 것. 차단 생성·HOLD 생성 등 같은 빌라 재고를 두고 경합하는 모든 쓰기가 **동일한 락 키**를 잡아야 차단↔홀드 교차 race도 막힌다
