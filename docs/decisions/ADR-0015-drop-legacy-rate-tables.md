# ADR-0015 — 구 요율 테이블 제거 (VillaRate·VillaSeasonPeriod, Phase C)

- 상태: Accepted (2026-06-24)
- 관련: ADR-0014(빌라 기간별 요금 — Phase B에서 구 경로 코드 제거 완료), ADR-0008(빌라별 시즌 폴백), ADR-0013(enum/테이블 DROP 위험 교훈)

## 맥락

ADR-0014 Phase B(커밋 ddf2274)로 가격 산정·표시·원가경보가 `VillaRatePeriod` 단일 경로로 전환되고, `VillaRate`·`VillaSeasonPeriod`를 읽거나 쓰는 **코드는 0**이 되었다. 두 테이블은 무해한 잔존 상태였다. 전 빌라(11건)는 이미 `VillaRatePeriod`로 전환되었고(게이트①② 0 확인), 모든 데이터는 테스트 데이터다.

운영자(테오)가 "테스트 데이터 자유 수정 + 백업 후 지금 DROP 진행"을 승인하여 Phase C를 즉시 수행한다.

## 결정

`VillaRate`·`VillaSeasonPeriod` 모델을 `prisma/schema.prisma`에서 제거하고 `prisma db push`로 테이블을 DROP한다.

- **유지**: `SeasonType` enum, 전역 `SeasonPeriod`(빌라 생성 시 HIGH/PEAK 기간 날짜 템플릿), `VillaRatePeriod`(단일 요율 소스).
- **제거**: `model VillaRate`, `model VillaSeasonPeriod`, 그리고 `Villa`의 관계 필드 `rates`·`seasonPeriods`.
- **백업**: DROP 전 두 테이블 전량을 `backups/phase-c-villarate-villaseasonperiod-2026-06-24.json`에 덤프(VillaRate 30행·VillaSeasonPeriod 1행, 전역 SeasonPeriod 4행 참고 포함, BigInt는 `"…n"` 문자열).
- **부수 정리**: 일회성 마이그레이션 스크립트(`scripts/migrate-rate-periods.ts`·`scripts/inspect-rate-state.ts`)는 임무 완료·모델 의존으로 삭제(이력은 git). `scripts/cleanup-test-data.ts`의 `_count.rates`는 `ratePeriods`로 갱신.

## 안전 근거

- **FK 안전**: 두 모델은 `villaId`로 `Villa`를 참조할 뿐, 다른 모델이 이들을 참조하지 않는다 → DROP 시 FK 위반 없음.
- **코드 참조 0**: ADR-0014 Phase B + 독립 QA로 `app/`·`lib/`에 모델 사용 0 확인. 스키마 제거 후 `tsc`(scripts·tests·prisma 포함 전수 검사)·`next build`로 잔여 참조 부재를 게이트.
- **스냅샷 무영향**: 제안·예약 금액은 생성 시 스냅샷(ADR-0003)이라 요율 테이블 비참조.
- **데이터 가치 보존**: 과거 원가 이력은 AuditLog + 위 JSON 백업에 잔존.

## 대안 (기각)

- **deprecated 유지(DROP 안 함)**: ADR-0013의 enum DROP 위험 교훈상 보통 더 안전하나, 본 건은 (1) 테스트 데이터 (2) FK 안전 (3) 코드 참조 0 (4) 백업 완료 (5) 운영자 명시 승인으로 위험이 낮아 DROP 채택. 스키마 단순화 이득.

## 비가역성·롤백

테이블 DROP은 비가역. 롤백이 필요하면 schema에 모델을 되살리고 `db push` 후 JSON 백업을 재적재한다(스크립트는 git 이력에서 복원). 운영 데이터가 아니므로 실질 롤백 필요성은 낮다.

## 후속

없음 — ADR-0014 요율 다기간화 에픽 종결. 향후 요율 관련 변경은 `VillaRatePeriod` 단일 모델 기준.
