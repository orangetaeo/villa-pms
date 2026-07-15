# T-db-backup-automation — 실DB 자동 백업 세팅

> 착수 2026-07-15. 배경: 실DB 초기화 후 실데이터 입력 시작 — 자동 백업이 전무(2026-07-09 수동 스냅샷 1회뿐, 오늘 pg_dump 시도는 0바이트 실패). 실데이터가 들어가기 전에 일일 자동 백업 가동 필요.

## 범위

1. **`lib/db-snapshot.ts`** — `prisma/export-full-snapshot.ts`의 dmmf 전 모델 JSON 스냅샷 로직을 공용 모듈로 추출(BigInt → `"123n"` 직렬화 유지). 기존 스크립트는 이 모듈을 쓰도록 리팩터.
2. **`app/api/cron/db-backup/route.ts`** — CRON_SECRET Bearer 게이트(기존 cron 패턴 동일) → 스냅샷 → gzip → R2 업로드 → 보존 pruning → 요약 JSON 응답. 실패 시 500 + 장애 경보(기존 security-alerts/operator-notify 장애축 경로 재사용 — ZALO_OPERATOR_NOTIFY_PAUSED와 무관하게 발송되는 축).
3. **저장소**: 백업 전용 **프라이빗 R2 버킷** (`BACKUP_BUCKET_NAME` env, 기존 STORAGE_* 자격증명 재사용). 공개 이미지 버킷(`STORAGE_BUCKET_NAME`) 사용 금지 — 백업엔 여권·원가·마진 포함. env 미설정 시 500(무단 폴백 금지).
   - 키 구조: `daily/villa-pms-YYYY-MM-DD.json.gz`, 매월 1일자는 `monthly/`에도 복사.
4. **보존 정책**: daily 최근 14개, monthly 최근 12개 — 초과분 cron 실행 시 삭제.
5. **`scripts/restore-from-snapshot.ts`** — 스냅샷 → 빈 DB 복원(테이블 owner 권한으로 `DISABLE TRIGGER ALL` → insert → 복구, BigInt `"123n"` 역변환). `--execute` 플래그 없으면 드라이런.
6. **문서**: `docs/ops/db-backup.md` 런북(복원 절차 포함) 신규 + `docs/ops/cron-registration.md`에 `cron-db-backup`(`0 20 * * *` UTC = VN 03:00) 행 추가 + `docs/INDEX.md` 등록 + `.env.example`(있으면) `BACKUP_BUCKET_NAME` 추가.

## 완료 기준 (테스트 가능)

- [ ] 무인증 요청 → 401 (게이트)
- [ ] CRON_SECRET 인증 → 200 + `{status, models, rows, bytes, key, pruned}` 응답, R2에 gzip 객체 생성 확인
- [ ] BACKUP_BUCKET_NAME 미설정 시 500 (공개 버킷 폴백 없음)
- [ ] 보존 pruning: 14/12개 초과분만 삭제 (경계 로직 유닛 검증)
- [ ] restore 드라이런: 실제 스냅샷 파일 파싱·BigInt 역변환·모델 순서 산출 성공
- [ ] `next build` 통과

## 검증 방법

QA가 로컬에서 route 핸들러 게이트·pruning 경계 검토 + 스냅샷/복원 왕복(BigInt·Date) 코드 검토. 배포 후 프로덕션에서 수동 curl 200 + R2 객체 실물 확인.

## 수정 금지 구역

- `scripts/prod-launch-data-wipe.ts`, `scripts/seed-demo-v25-bookings.ts` (타 세션/사용자 진행 중)
- `prisma/schema.prisma` (스키마 변경 없음)

## 배포 후 수동 작업 (테오)

1. R2 프라이빗 버킷 생성(또는 스크립트로 CreateBucket) + Railway 메인 서비스에 `BACKUP_BUCKET_NAME` env 추가
2. Railway 대시보드에서 `cron-db-backup` 등록(기존 cron Duplicate, 런북 갱신본 참조)
3. (권장, 별개) Railway Postgres 서비스 자체 Backups 기능 활성화 — 이중 안전망
