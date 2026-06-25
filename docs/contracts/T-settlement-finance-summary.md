# T-settlement-finance-summary — 정산 페이지 고도화 1차: 운영자 매출·환차·마진 요약 (Phase 2)

## 배경 / 결정
테오 선택(2026-06-25): 정산 페이지 고도화 — **다중 통화 수납 + VND 지급 + 환차 기록**(환전 LEDGER 패턴). Phase 2 착수(보류 규칙 해제). 현재 정산은 Phase 1 최소형(공급자 원가 VND 합산·지급만, lib/settlement.ts·/settlements).

**핵심 실측**: 운영자 손익(수납·환산·환차·마진)은 **기존 Booking 필드만으로 파생 가능** — `saleCurrency`+`totalSaleKrw`/`totalSaleVnd`(고객 수납액), `supplierCostVnd`(공급자 지급액), `fxVndPerKrw`(예약 시점 환율 스냅샷). 별도 Payment/Ledger 모델 없이 1차 가치 전달 가능 → **스키마 무변경**(저위험).

## 아키텍처 결정 (TDA·FIN)
- **1차 = 파생 요약(읽기)**: 새 모델 없이, 정산 대상 예약(CHECKED_OUT·NO_SHOW)에서 운영자 손익을 계산해 /settlements(ADMIN, canViewFinance)에 노출.
  - 예약별: 수납액(통화별) → **VND 환산**(KRW는 `fxVndPerKrw` 스냅샷, VND는 그대로) → 지급액(supplierCostVnd) → **마진 = 수납VND환산 − 지급VND**.
  - 월 합계: 총 수납(KRW 합·VND 합 통화별 분리) + 총 수납 VND환산 + 총 지급 VND + 총 마진 VND.
  - 공급자별(Settlement)에도 동일 마진 산출(ADMIN만).
- **누수 불변식**: 마진·판매가·VND환산은 **ADMIN(canViewFinance) 전용**. 공급자 /earnings·정산 알림은 무변경(원가만). 공급자 라우트에 마진·매출 select 0.
- **환율 스냅샷 우선**: KRW 예약의 VND 환산은 `Booking.fxVndPerKrw`(제안→HOLD 복사된 시점값)만 사용. 스냅샷 없으면(데이터 미비) 환산 불가 → "환율 미상" 표기 + 마진 합계에서 제외(허위 0 금지, [[translation-number-preservation]]·money-pattern 정신).
- **BigInt 전용**: VND BigInt, KRW Int. KRW→VND = `krw × fxVndPerKrw`(Decimal(14,4) 스케일 정수 연산, 반올림 half-up). lib/pricing에 `krwToVndSnapshot` 헬퍼 추가(역방향 suggestSalePriceKrw와 대칭).

## 범위 (1차)
1. `lib/settlement-finance.ts` 신규 — 순수 함수: 예약별 손익 계산(`bookingFinance`), 월/공급자 합계(`summarizeFinance`). 입력은 통화·금액·fx 스냅샷. 단위테스트(KRW/VND 혼합·fx 스냅샷·환율 미상 제외·BigInt 합산·통화 화이트리스트).
2. `lib/pricing.ts` — `krwToVndSnapshot(krw: number, fxVndPerKrw: string): bigint` 추가(half-up, Decimal(14,4) 스케일). 단위테스트.
3. `/settlements` 페이지(RSC, canViewFinance 게이트) — 월 정산 대상 예약의 손익 합계 카드 추가: **총 수납(KRW/VND 분리)·VND 환산 합·총 지급(VND)·총 마진(VND)·적용 환율 요약·환율 미상 건수**. 공급자별 행에 마진(ADMIN만, 토글/확장).
4. i18n ko/vi(adminSettlements 네임스페이스 추가-only). 누수·단위테스트·QA.

## 범위 밖 (2차 이후)
- **실제 수납 기록 모델**(Payment: 통화·수단·부분입금·실입금일·수납 환율) — 1차는 견적 판매가(totalSale*)를 수납액으로 간주. 부분/실입금 차이·수납수단은 2차.
- **복식부기 LEDGER 엔트리**(collection/payout/fx_adjustment 계정·차변/대변) — 2차(환전 BithumbLedger 패턴 본격 이식).
- Settlement 상태 확장(COLLECTED·FX_ADJUSTED), 환차 수동 조정 워크플로 — 2차.
- 월 정산서 PDF(vi), 실계좌 연동 — 별도.
- Settlement·SettlementItem 스키마 변경 — 1차 무변경(파생 계산만).

## 수정 금지 구역 (병렬)
- 타 세션 활성: `app/(admin)/users/*`·`auth.ts`·`app/api/users/*`·`app/(admin)/bookings/[id]/checkin/*`·`app/(admin)/settings/*`·`lib/agreement*`·`lib/gemini.ts`·`app/api/agreement/*`·`app/(supplier)/my-villas/new/villa-wizard.tsx` — 비접촉.
- 공유 파일: `messages/*.json`은 추가-only(adminSettlements 키), [[shared-git-index-private-commit]] 전용 인덱스 또는 타 세션 비활성 시 pathspec. `lib/settlement.ts`·`/settlements/*`·`/api/settlements/*`·`lib/pricing.ts`는 본 태스크 영역(타 세션 비접촉 확인됨).
- `prisma/schema.prisma` 무변경(1차).

## 완료 기준 (테스트 가능)
- [ ] /settlements(ADMIN)가 월 손익 요약 카드 렌더: 총 수납(KRW/VND)·VND환산·총 지급·총 마진·적용 환율·환율미상 건수. 숫자 정확(BigInt, KRW→VND half-up).
- [ ] 공급자별 마진 = 그 공급자 예약들의 (수납VND환산 − supplierCostVnd) 합. ADMIN만.
- [ ] 누수 0: 공급자 /earnings·정산 알림·공급자 라우트에 마진·매출·VND환산 미노출(select·렌더 0). STAFF(canViewFinance=false)도 마진 미표시.
- [ ] 환율 스냅샷 없는 KRW 예약은 마진 합계 제외 + "환율 미상 N건" 표기(허위 0 금지).
- [ ] `krwToVndSnapshot`·`bookingFinance`·`summarizeFinance` 단위테스트 그린. typecheck 0, `npm test` 그린, `next build` 통과.

## 검증
- 단위테스트: KRW/VND 혼합 월·fx 스냅샷 환산·환율 미상 제외·통화 화이트리스트 throw·BigInt 합 검증.
- QA 독립: ADMIN 손익 요약 실측(Playwright), STAFF·공급자 누수 0 실증, KRW→VND 환산 정확.

## 단계 / 담당
FIN(손익 계산 순수모듈·환산 헬퍼·테스트) → FE(/settlements 요약 카드·공급자 마진) → LOC(ko/vi) → QA 독립 → PM 보고. ADR 신설(정산 고도화 — 파생 손익 1차 + Payment/LEDGER 2차 로드맵).
