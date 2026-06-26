# 계약서 — 빌라 품질점수 + 판매 후순위 정렬 (Phase 2)

- 브랜치: `wt/quality-score` (격리 worktree)
- 담당: BE/FE/QA · 상태: **착수 선점** (2026-06-26)
- 근거: TASKS.md Phase 2 "품질점수 로직 + 판매 후순위 정렬", 테오 확정(2026-06-26): **산정 기준 = 청소 검수 이력**
- 선행: `Villa.qualityScore Int @default(100)` 스키마 필드 **이미 존재**(마이그레이션 불필요), lib/cleaning.ts 검수 상태기계

## 배경 / 결정

운영자가 재고를 골라 판매할 때 품질 좋은 빌라가 먼저 노출되도록 `qualityScore`(0~100)를 청소 검수 이력으로 산정하고, 제안 후보·공실보드를 점수 내림차순 정렬한다. 현재 필드는 항상 100(미사용)이고 정렬은 이름순.

**산정식(v1, 현재 상태 기준 검수 통과율)**:
- `computeQualityScore(approved, rejected)` = 결정된 검수 0건이면 100(신규 중립 상위), 아니면 `round(100 * approved / (approved + rejected))`. approved/rejected는 그 빌라 CleaningTask의 **현재 상태** APPROVED·REJECTED 건수.
- 의미: 현재 미해결 반려가 있으면 감점, 반려를 고쳐 재승인하면 회복(현재 상태 반영). **누적 반려 이력 가중(AuditLog 기반)은 후속**(v1 단순화 — 명시).

## 범위 (In)

1. **점수 산정** (lib/cleaning.ts): `computeQualityScore` 순수 함수 + `recomputeVillaQualityScore(tx, villaId)` 헬퍼. `approveCleaningTask`·`rejectCleaningTask` 트랜잭션 내부에서 상태 변경 후 호출(빌라 점수 갱신).
2. **정렬** (판매 후순위): `lib/availability.ts getAvailabilityBoard` + `app/api/proposals/candidates` 빌라 조회를 `orderBy: [{qualityScore: desc}, {name: asc}]`로 변경.
3. **노출(정렬 legibility)**: 제안 후보 카드(b2 proposal/new)·공실보드 행에 점수 표시(ADMIN 전용 — 작은 배지/숫자). 응답에 qualityScore additive.
4. **백필** (scripts/backfill-quality-scores.ts): 전 빌라의 현재 CleaningTask 이력으로 qualityScore 재계산(멱등).

## 수정 금지 구역 (병렬 규칙 #2)

- `wt/f10-phase-b`(공급자 판매링크)·미니바 세션 영역 미수정.
- 공유 메인 직접 커밋 금지. messages json은 키 추가만.

## 누수 (원칙2)

- qualityScore는 **ADMIN 전용** 노출. 공급자 화면(my-villas)·공개 제안(/p)·게스트(/g)에 미노출(기존 select에 추가 안 함). 마진·원가 아님이나 운영 내부 정보이므로 ADMIN 경로(candidates·board·admin villa)만.

## 완료 기준 (테스트 가능)

1. 검수 승인/반려 시 해당 빌라 qualityScore가 통과율로 갱신(트랜잭션 내).
2. 제안 후보·공실보드가 qualityScore 내림차순(동점 이름순) 정렬.
3. 백필이 전 빌라 점수를 현재 이력으로 멱등 산정.
4. 누수 0(비-ADMIN 응답에 qualityScore 부재), typecheck0, next build, 단위테스트(computeQualityScore 경계: 0건=100·전승인=100·반려율).

## 검증

- 단위테스트 computeQualityScore + recompute(mock tx). 누수 grep. `npm run typecheck`·`npx next build`·`npx vitest run`.
