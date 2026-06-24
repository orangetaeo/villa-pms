# 계약서 — T-batchB-rate-multiperiod (요금 다기간화)

회의 확정(2026-06-23): 시즌(비/성/극성수기) 분류는 유지하되 **기간별 요금**. 비수기=기본요금 1개 + 성/극성수기 웃돈 기간 N개. 공급자도 여러 기간 입력, 관리자는 각 기간 소비자가 책정.

## 이번 스프린트 범위 = ADR 설계만
- `docs/decisions/ADR-0014-villa-rate-periods.md` 작성 (스키마·가격로직·마이그레이션·UI 계약·대안)
- 코드/스키마 구현은 ADR 승인 후 **별도 스프린트**(마이그레이션 한 세션 전담)

## 완료 기준 (ADR 단계) — ADR-0014 작성 완료(제안 상태, TDA 승인 대기)
- [x] 기간별 요금 데이터 모델 확정 (`VillaRatePeriod` — D1)
- [x] `lib/pricing.ts` 가격 판정 변경 설계 (dual-read 폴백 — D2·D4, ADR-0008 패턴 재사용)
- [x] 기존 `VillaRate`+`VillaSeasonPeriod` 무손실 공존(미백필·dual-read) 전략
- [x] 제안·예약 스냅샷 무영향 확인 (마이그레이션 섹션)
- [x] 공급자/관리자 UI 변경 계약(범위만, 구현 별도 — D6)
- [x] 대안·위험 정리(A·B·C 기각), docs/INDEX.md 등록 완료

## 수정 금지 구역 (다른 세션 작업 중)
- `lib/cleaning.ts`·`lib/hold.ts`·`lib/proposal.ts`·`docs/DESIGN.md` — 수정 안 함
- `app/(admin)/layout.tsx`·`app/(supplier)/layout.tsx`·`components/admin/sidebar.tsx`·`app/**/account/**` (account 기능 세션) — 수정 안 함
- `messages/*.json` — 본 ADR 단계는 키 추가 없음. 필요 시 private-index 커밋

## 비고
- ADR 단계는 문서만 추가 → 코드/스키마 무변경. 구현 스프린트에서 `db push` 한 세션 전담.
