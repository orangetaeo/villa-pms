# 계약 — 체크인 후 예약 변경 에픽 (ADR-0030)

- 브랜치: `wt/post-checkin-modify`
- ADR: [ADR-0030](../decisions/ADR-0030-post-checkin-booking-modification.md)
- 착수: 테오 "이 내용으로 전체 개발 진행" (2026-07-01)

## 수정 금지 구역 (다른 세션 작업 중)

- `app/(auth)/login/**`, `messages/ko.json`·`messages/vi.json`의 **login 관련 키** — 다른 세션 WIP. i18n은 **키 추가만**(기존 키 미수정).

## 범위 (ADR §10 순서)

| 태스크 | 범위 | 완료 기준(테스트 가능) |
|---|---|---|
| **T-A** | `checkAvailability`/`evaluateAvailability` 정원(maxGuests) 검증 + modify 빌라/인원 변경 시 게이트 | 정원 초과 빌라·구간 → `OVER_CAPACITY` 사유·거부. 정원 이내 통과. 단위 테스트 |
| **T-B** | `POST /api/bookings/[id]/modify/preview` dry-run (커밋 없음) + 패널에 추가청구·새 총액·정원·공실·과수납 표시 | 미리보기가 modify와 동일 검증·견적을 커밋 없이 반환. STAFF는 판매가 게이트 |
| **T-C** | 상태별 재계산 분기: 체크인 후 = `max(기존액, 재견적액)` 하한, 단축 감액 차단 | CONFIRMED=전체 재견적 유지. CHECKED_IN=감액 없음. 단위 테스트 |
| **T-D** | 과수납 가드: `수납 > 새 총액` 경고(확정 다운그레이드) | preview/응답에 overpayment 플래그. 테스트 |
| **T-E** | `Booking.parentBookingId`(additive raw SQL ALTER) + 연결 추가 예약 생성 흐름 | 원 빌라 불가 시 대체 빌라 새 예약 생성·연결·알림·청소. 테스트 |
| **T-F** | 파트너 채권 추가라인: 자식 예약 금액을 부모 청구서/채권에 합산 | 여신 예약 연장 시 채권 증가(취소·재예약 아님). 테스트 |
| **T-G** | 게스트·공급자·청소 후속 반영 | 출입정보·정산 미리보기·알림 반영 |

## 원칙 가드 (QA 체크)

- 마진 비공개: preview·알림에 판매가/마진은 `canViewFinance` 게이트. 공급자 알림 = 날짜·인원만.
- 검수 게이트: 이동/추가 대상 빌라는 `isSellable=true`만.
- 재고 비공개: 대체 빌라 후보는 ADMIN 화면만.
- AuditLog: 모든 mutation에 기록.
- 동시성: 재고 잠금 + updateMany status 가드 유지.

## 스키마 변경 (TDA)

- `Booking.parentBookingId String?` (self-relation, additive) — **raw SQL ALTER** (`prisma db push` 금지, [[db-schema-drift-villa-source]]). T-E에서.

## 검증 방법

- `npm run lint && npx tsc --noEmit` 0
- 관련 단위 테스트 통과 (`lib/booking-modify.test.ts`, `lib/availability` 신규)
- QA 독립 평가(작성자≠평가자): 권한 누수·마진 노출·감액 규칙·과수납 가드
