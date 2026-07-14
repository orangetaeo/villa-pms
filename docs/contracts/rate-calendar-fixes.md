# 계약: 요금 캘린더 디버깅 리뷰 후속 수정 (rate-calendar-fixes)

- 착수: 2026-07-14 (8관점 디버깅 리뷰 → 검증 확정 10건 중 수정 대상 9건, 테오 승인 "수정할 내용은 수정해줘")
- 브랜치: worktree-rate-calendar-fixes
- 선행: PR #313(ADR-0044)·#314. 리뷰 판정 근거는 세션 기록.

## 범위 (BE)

1. **[P2] pct 하한 검증** — batch route pct: `z.number().finite().gt(-100).max(500)` (400 VALIDATION). lib/rate-layers.ts pctFactorScaledE4의 throw는 방어로 유지.
2. **[P2] 레이어 총량 캡 공유 상수** — `MAX_RATE_PERIOD_ROWS = 200`(lib/rate-period-input.ts). layers POST·batch POST(ADJUST/SET/COPY_YEAR)는 생성 후 non-base 행 수가 캡 초과 시 400 `LAYER_LIMIT`(사전 count 검사). 공급자 cost 라우트 periods.max(60) → `.max(MAX_RATE_PERIOD_ROWS)`로 정렬. 전체교체 PATCH도 동일 상수.
3. **[P3] COPY_YEAR 윤년 경계** — exclusive endDate는 직접 시프트하지 않고 `마지막 밤(end−1일)을 시프트 후 +1일`로 계산(마지막 밤 보존, start==end 퇴화 불가). 방어로 shifted start>=end 행은 skip.
4. **[P3] 트랜잭션 분리 + range 캡** — ADJUST/SET/COPY_YEAR의 구간화·row 생성 계산을 `$transaction` 밖으로, 트랜잭션은 count 검사+createMany+writeAuditLog만. rangeSchema에 range당 밤 수 상한(≤ 1100박, 3년) refine 추가 → 400 `RANGE_TOO_LONG`.
5. **[P3] 전체교체 PATCH 검증 통합** — route.ts의 자체 priceFields/premiumData/digits/isoDate/SEASONS/toUtc를 lib/rate-period-input.ts 공용 fragment로 교체(동작 불변 — 기존 테스트가 게이트).

## 범위 (FE)

6. **[P2] parsePct 로케일 콤마** — 콤마를 소수점으로 정규화 후 파싱("1,5"→1.5). 숫자·부호·구분자 1개 외 거부(NaN→err). 일괄 조정·선택 % 두 입력 모두.
7. **[P2] STAFF 프리미엄 요일 편집 복원** — page.tsx에서 `!showFinance`(STAFF)일 때만 렌더되는 컴팩트 프리미엄 요일 에디터 복원(구 premium-days-editor를 git 이력에서 회수·간소화, 기존 /info PATCH). finance 사용자는 캘린더 내 편집 그대로(중복 없음).
8. **[P3] 승자·프리미엄 규칙 단일 원천화** — lib/pricing.ts에서 `periodBeats`·`premiumReasonFor`·`hasAnyPremiumValue` export, components/rate-calendar/calendar-lib.ts의 손 복사(stackForDate·sortLayersForPanel 비교자, premiumReason·hasAnyPremium)를 import로 교체. 클라 번들 안전(값 import에 Prisma 런타임 미포함) 확인.
9. **[P3] CalendarGrid 메모이제이션** — 셀 승자·주 밴드·공휴일 Map을 useMemo(layers·base·view·premiumDays·holidays 의존)로, CalendarGrid를 React.memo로. hover(hlLayerId)는 재계산 없이 하이라이트만.
10. **[P3] 고아 파일 삭제** — app/(admin)/villas/[id]/rate-period-editor.tsx 삭제(임포트 0 확인됨) + price-fields.tsx·price-suggest.ts의 사멸 주석 갱신.

## 범위 밖 (기록만)
- RateCalendar mode='supplier' 도달 불능 분기 — 공급자 통합 여부는 별도 태스크(IDEAS)
- suggestKrw float/1,000원 반올림 — 구 편집기 승계 동작, ADR-0044 D5 범위 밖
- STAFF 원가표 겹침 승자 미표시 — 기존 한계, 별도 UX 태스크

## 완료 기준 (QA 합의 조건 C1~C4 반영, 2026-07-14)
1. pct=-150 → 400 / pct="1,5" → +1.5%로 파싱 (단위 테스트)
2. non-base 200행 초과 생성 시도 → 400 LAYER_LIMIT, 공급자 cost 저장은 200행까지 정상 (테스트). ※C4: 캡은 사전 count 검사 — 동시 배치 레이스로 인한 일시 초과는 허용 한계(ADMIN 전용 소프트 캡)로 명시
3. **C1 재기술**: 윤년 [2024-01-01, 2024-02-29) 복사(+1년) → §3 알고리즘대로 정확히 **[2025-01-01, 2025-03-01), 밤수 59 동일** — 테스트로 밤수 보존 확인. 단일 밤 [2024-02-28, 2024-02-29) → [2025-02-28, 2025-03-01) 1밤 보존
4. STAFF 세션에서 프리미엄 요일 편집 UI 렌더 (finance는 캘린더 내, 중복 렌더 없음). **C3**: STAFF 경로 payload·/info PATCH 응답에 salePrice*/margin* 미포함을 QA가 확인, §8 export 함수(periodBeats·premiumReasonFor·hasAnyPremiumValue)는 금액 미반환(불리언·사유만) 유지
5. calendar-lib이 pricing export를 소비(손 복사 잔존 0), 기존 캘린더 테스트 그린. **C2**: §5 교체 전 공용 fragment(digits·SEASONS·toUtc·priceColumns)와 인라인의 의미 동일성 확인 + PATCH 검증분기 특성화 테스트 부재 시 먼저 추가
6. 전체 스위트 + `next build` 통과, PROGRESS.md에 #314·본 수정 기록 보완

## 수정 금지 구역
- prisma/schema.prisma, 공급자 select 화이트리스트(마진 계열 추가 금지), messages/*.json은 키 추가만
