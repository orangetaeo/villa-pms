# 계약: 빌라 품질점수 v2 — 누적 반려 이력 가중 (AuditLog 기반)

- 담당 세션: quality-followup (worktree `wt/quality-followup`, origin/main 기준)
- 선행: 품질점수 v1 배포 완료 (PR #63, [[villa-quality-score]])
- 착수: 2026-06-26

## 배경 / 문제
v1 `recomputeVillaQualityScore`는 **현재 상태**(CleaningTask.status APPROVED·REJECTED) 카운트로
통과율을 산정한다. 반려된 검수를 고쳐 재승인하면 status가 APPROVED로 바뀌어 **과거 반려가 점수에서 사라진다**.
같은 100% 현재 통과율이라도 "첫 검수에 통과한 빌라"와 "여러 번 반려 후 통과한 빌라"가 구분되지 않는다.

## 범위 (변경 파일)
1. `lib/cleaning.ts`
   - `recomputeVillaQualityScore` 데이터 소스를 **AuditLog 누적 이벤트**로 전환.
     - 빌라의 CleaningTask id 목록 → AuditLog(entity="CleaningTask", entityId IN ids,
       `changes.status.new` = APPROVED/REJECTED) **이벤트 수**로 통과율 산정.
     - 순수 함수 `computeQualityScore(approved, rejected)`는 **그대로 재사용**(통과율 정의 불변).
   - `approveCleaningTask`·`rejectCleaningTask`에서 `recomputeVillaQualityScore` 호출을
     **이 이벤트의 `writeAuditLog` *뒤*로 이동**(같은 트랜잭션 내 audit insert가 count에 보이도록).
   - 주석 갱신(v1 현재상태 → v2 누적 이력).
2. `scripts/backfill-quality-scores.ts` — recompute 재사용이라 로직 변경 없음, 헤더 주석만 갱신.
3. 테스트
   - `lib/cleaning.test.ts`: `recomputeVillaQualityScore` 누적 가중 단위테스트(스텁 db) 추가
     — 재승인해도 과거 반려가 분모에 남는지, decided 0건이면 100인지.
   - `lib/availability.test.ts`: `getAvailabilityBoard`가 `orderBy [{qualityScore:desc},{name:asc}]`를
     요청하고 DB 반환 순서를 보존하는지(정렬 통합 테스트, v1 Minor 후속).

## 완료 기준 (테스트 가능)
- [ ] 반려→재승인 빌라의 score < 100 (과거 반려가 영구 반영). 첫 통과 빌라 = 100.
- [ ] 검수 0건(신규) = 100 유지.
- [ ] approve/reject 후 score가 **이번 이벤트 포함**해 정확(순서 이동 검증).
- [ ] 공실보드·후보 정렬 orderBy 검증 테스트 통과.
- [ ] 누수 불변: qualityScore는 ADMIN 경로만(v1 경계 그대로, 새 노출 0).
- [ ] `npm run typecheck` + `vitest run` + `next build` 통과.
- [ ] 라이브 백필 재실행(멱등) — v2 점수로 갱신.

## 수정 금지 구역
- 타 세션 worktree(agreement-editor·service-order-ui·settlement·supplier-settlement·partner-1) 및
  메인 폴더 미커밋 WIP(vendor stats·partner-signup) — 비접촉.
- 스키마 변경 없음(마이그레이션 0). qualityScore 필드·게이트(isSellable) 로직 불변.

## 검증 방법
독립 QA 서브에이전트 — 누수 스캔 + 누적 가중 시나리오 재현 + 정렬 테스트 리뷰.
