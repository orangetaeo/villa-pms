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
- (없음)
