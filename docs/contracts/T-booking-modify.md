# 계약서: 예약 변경 기능 (F3)

## 범위
기존 예약의 핵심 필드 변경 API + 운영자 UI. 변경 시 가용성·금액·정산·미수 재계산.

- 변경 가능 필드: checkIn/checkOut(날짜), villaId(빌라), guestName/guestCount/guestPhone(투숙객·인원), breakfastIncluded
- 변경 허용 상태: HOLD·CONFIRMED(전체), CHECKED_IN(체크아웃 날짜 연장 등 제한적 — 체류 연장 대응)
- 신규 API `PATCH /api/bookings/[id]/modify`:
  1. 권한: isOperator. 상태 가드.
  2. 트랜잭션: lockVillaInventory → checkAvailability(자기 예약 제외) → 충돌 시 거부(사유)
  3. 금액 재계산: quoteStayForVilla(새 빌라/기간/통화) → totalSale*, supplierCostVnd, nights 갱신
  4. 환율 스냅샷 fxVndPerKrw 정책: 유지(기존 값) — 재계산 금액은 기존 환율로 환산
  5. 파트너 채권 존재 시 금액·빌라 변경 차단(정합성) — 메시지로 안내(취소후 재예약 권유)
  6. AuditLog old→new 전 필드 기록
  7. Zalo 알림: 공급자에게 BOOKING_MODIFIED 통지(payload 판매가·마진 비포함)
- UI: 예약 상세에 "예약 변경" 패널/모달 — 날짜·빌라·인원 편집, 가용성/금액 미리보기, 변경 사유.

## 비범위 (수정 금지)
- 통화(saleCurrency)·채널 변경은 이번 범위 밖(별도) — 차단/비활성
- 체크아웃 완료(CHECKED_OUT)·취소·만료 예약은 변경 불가
- 정산 CONFIRMED/PAID 건은 금액 변경 차단

## 완료 기준 (테스트 가능)
1. 가용성 재검사: 자기 예약 제외하고 충돌 판정(겹침 시 거부) — 단위테스트
2. 금액 재계산: 날짜·빌라 변경 시 quote 반영, 통화 컬럼 정합(assertSaleAmountColumns)
3. 채권 존재 시 금액/빌라 변경 차단 동작
4. CHECKED_IN: 체크아웃일만 변경 허용(다른 필드 잠금)
5. AuditLog·Zalo 알림 큐 적재
6. 권한: 비운영자 차단, 마진 비노출
7. ko+vi i18n, typecheck·build·테스트 통과

## 신규 알림 타입
- NotificationType.BOOKING_MODIFIED (enum 추가 — 라이브 DB additive raw SQL ALTER, prisma db push 금지)

## 수정 금지 구역
- 본 작업 wt/rev-minibar-bookmod 단독.
