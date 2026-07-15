# OPS 런북 — DB 자동 백업 (R2 논리 스냅샷)

> 작성 2026-07-15 (T-db-backup-automation). 배경: 실DB 초기화 후 실데이터 입력 시작 — 자동 백업 전무
> (2026-07-09 수동 스냅샷 1회뿐, pg_dump 시도는 서버/로컬 버전 불일치로 0바이트 실패). 일일 자동 백업 가동.

## 1. 아키텍처 — 왜 pg_dump가 아니라 JSON 스냅샷인가

- **버전 불일치**: 서버 PostgreSQL **18** vs 로컬 클라이언트 **17** → `pg_dump`가 protocol/format 불일치로 실패(0바이트).
  로컬에 PG18 클라이언트를 맞추는 대신, **버전 독립적인 논리 스냅샷**을 택했다.
- **스키마는 이미 git에**: `prisma/schema.prisma`가 스키마 정본. 백업은 **데이터만** 확보하면 된다.
- **방식**: `Prisma.dmmf.datamodel.models` 전 모델을 `findMany` → `{ [모델명]: 전 행[] }` JSON → gzip.
  BigInt(VND 등)는 `"123n"` 문자열로 직렬화(복원 시 역변환). 로직 단일 원천 = `lib/db-snapshot.ts`
  (CLI `prisma/export-full-snapshot.ts`와 cron 라우트가 공유).
- **규모**: 현재 ≈23MB(gzip 전). 전 행을 메모리에 적재 — 수십 MB까지 스트리밍 불필요. 수백 MB 이상 성장 시
  `lib/db-snapshot.ts` 주석의 커서 페치 전환 필요.
- **한계(중요)**: 논리 스냅샷은 **PITR(특정 시점 복구)이 아니다** — 하루 1회 스냅샷 간 데이터는 손실될 수 있다.
  이중 안전망으로 **Railway Postgres 서비스 자체 Backups 기능**도 활성화 권장(아래 §6).

## 2. 구성 요소

| 파일 | 역할 |
|---|---|
| `lib/db-snapshot.ts` | 스냅샷 공용 모듈(`snapshotAllModels` / `serializeSnapshot`) + 보존 경계 순수 함수 `selectKeysToPrune`(라우트 파일 export 제약상 여기 위치) |
| `app/api/cron/db-backup/route.ts` | cron 진입점 — 스냅샷→gzip→R2 업로드→pruning |
| `scripts/restore-from-snapshot.ts` | 복원 스크립트(드라이런 기본, `--execute`로 실행) |
| `prisma/export-full-snapshot.ts` | 수동 로컬 스냅샷 CLI(위 모듈 사용, 인터페이스 불변) |

## 3. 버킷 준비 (테오 — 배포 후 1회)

백업엔 **여권·원가·마진**이 들어가므로 공개 이미지 버킷(`STORAGE_BUCKET_NAME`)과 **반드시 분리**한다.

1. **Cloudflare 대시보드 → R2 → Create bucket**: 프라이빗 버킷 `villa-pms-db-backups` 생성
   (Public access **OFF** — 공개 도메인 연결 금지).
2. **API 토큰**: 그 버킷에 **Object Read & Write** 권한 토큰 발급.
   - 기존 이미지용 토큰에 이 버킷을 **추가**해도 됨 → 그 경우 `BACKUP_*` 자격증명 env는 **불필요**(STORAGE_* 폴백).
   - ⚠ 실측: 기존 STORAGE_* 토큰이 **버킷 스코프**라 새 버킷 접근이 막힐 수 있음(계정 수준 CreateBucket 403 실증).
     막히면 새 버킷 전용 토큰을 발급해 `BACKUP_*` 3종으로 지정.
3. **Railway `villa-pms` 서비스 → Variables**:
   - `BACKUP_BUCKET_NAME=villa-pms-db-backups` (필수)
   - (새 토큰을 발급한 경우만) `BACKUP_ACCOUNT_ID` / `BACKUP_ACCESS_KEY_ID` / `BACKUP_SECRET_ACCESS_KEY`

> 자격증명 해석 순서: `BACKUP_*` 우선 → 미설정 항목은 `STORAGE_*`로 폴백. `BACKUP_BUCKET_NAME`은 폴백 없음
> (미설정 시 cron이 즉시 500 `{status:"error", reason:"BACKUP_BUCKET_NAME missing"}` — 공개 버킷 무단 사용 차단).

## 4. cron 등록 & 보존 정책

- 등록: `docs/ops/cron-registration.md`의 `cron-db-backup` 행 참조(`0 20 * * *` UTC = VN 03:00, curl `-m 300`).
- 키 구조:
  - `daily/villa-pms-YYYY-MM-DD.json.gz` (날짜 UTC, 같은 날 재실행 = 같은 키 덮어쓰기 = 멱등)
  - 매월 1일(UTC)은 같은 바이트를 `monthly/villa-pms-YYYY-MM.json.gz`에도 보관.
- 보존: `daily/` 최근 **14개**, `monthly/` 최근 **12개** — 초과분은 매 실행 시 삭제(`selectKeysToPrune`).
- 응답: `{ status:"ok", models, rows, bytes, key, monthlyKey, pruned }`.

## 5. 복원 절차 (재해 시)

> ⚠ 파괴적. 대상 DB를 반드시 확인(운영 DB에 실수 복원 금지). `DISABLE TRIGGER ALL`은 **테이블 owner 권한** 필요.

### 5.1 백업 파일 내려받기
Cloudflare 대시보드 또는 S3 호환 CLI로 원하는 `daily/`·`monthly/` 객체를 로컬로 다운로드
(예: `villa-pms-2026-07-15.json.gz`).

### 5.2 드라이런(필수 — DB 미변경)
```bash
npx tsx --env-file=.env scripts/restore-from-snapshot.ts ./villa-pms-2026-07-15.json.gz
```
→ 파싱 성공·모델별 행 수·복원 순서 출력. 여기서 오류가 나면 파일 손상 의심.

### 5.3 대상 DB 준비 (수동 — 스크립트는 자동 DROP/TRUNCATE 안 함)
- **빈 DB로 복원이 원칙**. 대상 DB에 스키마만 있고 데이터는 없어야 한다.
- 스키마 준비: 새/빈 DB에 `prisma/schema.prisma` 반영(운영과 동일 버전).
  ```bash
  # 새 빈 DB에 대해서만. 기존 운영 DB에 절대 실행 금지.
  DATABASE_URL="<복원대상>" npx prisma db push
  ```
- 기존 데이터를 지우고 재복원해야 하면(의도적), 대상 DB에서 수동으로 `TRUNCATE ... CASCADE` 또는
  스키마 재생성. **스크립트는 절대 자동으로 지우지 않는다** — 실수 방지를 위해 기존 행이 있으면 기본 중단한다.

### 5.4 실행
```bash
DATABASE_URL="<복원대상>" npx tsx --env-file=.env scripts/restore-from-snapshot.ts ./villa-pms-2026-07-15.json.gz --execute
```
- 대상 DB에 기존 행이 있으면 중단됨 → 의도적 덮어쓰기면 `--force` 추가(위 5.3 수동 정리 후 권장).
- 동작: 각 테이블 `DISABLE TRIGGER ALL`(FK 순서 무관) → `createMany(skipDuplicates)` → `ENABLE TRIGGER ALL`.
- 왕복: BigInt(`"123n"`/`"-5n"`)만 역변환, Date(ISO)·Json(객체)·enum(문자열)·null은 그대로 Prisma 수용.

### 5.5 복원 후 검증
- `npx prisma studio`로 핵심 테이블(User·Villa·Booking·CheckInRecord) 행 수·샘플 확인.
- 시퀀스: cuid 기반 PK라 시퀀스 리셋 불필요. 만약 autoincrement 컬럼을 추가한다면 복원 후 `setval` 필요(현재 없음).

## 6. 검증 방법 (배포 후 최초 1회)

1. **무인증 401**: `curl https://villa-pms-production.up.railway.app/api/cron/db-backup` → 401.
2. **BACKUP_BUCKET_NAME 미설정 500**: env 추가 전 인증 호출 → `{status:"error",reason:"BACKUP_BUCKET_NAME missing"}`.
3. **수동 200**: `curl -m 300 -H "Authorization: Bearer <CRON_SECRET>" .../api/cron/db-backup`
   → `{status:"ok", models, rows, bytes, key, pruned}`.
4. **R2 실물**: Cloudflare 대시보드에서 `daily/villa-pms-<오늘>.json.gz` 객체 생성 확인.
5. **왕복 확인(권장)**: 다운로드 → 임시 빈 DB에 §5 절차로 복원 → 행 수 대조.

## 7. 실패 시 경보 (장애 축)

- cron 실패 → **500 반환**(Railway Cron Runs에 빨강 표시 = 최종 신호).
- 추가로 **운영자 인앱 알림**(`enqueueInAppForOperators`, type `DB_BACKUP_FAILED`) + **SecurityEvent**(`BACKUP_FAIL`) 기록.
- ★ 이 경보 경로는 **`ZALO_OPERATOR_NOTIFY_PAUSED`와 무관하게 발송**된다(인앱 직접 적재 = pause 스위치 비경유).
  단, DB 자체가 죽어 스냅샷이 실패한 경우엔 인앱 적재(DB 쓰기)도 실패할 수 있으므로 **Railway Cron Runs 빨강이
  가장 신뢰할 수 있는 신호**다 — 초기 운영 며칠은 Cron Runs 탭 글랜스 권장.
- (향후) Zalo 폰 발송까지 원하면 `NotificationType`에 백업 실패 타입 추가 필요(스키마 변경 = TDA).

## 8. 이중 안전망 (권장, 별개)

Railway Postgres 서비스 자체 **Backups** 기능 활성화 — 논리 스냅샷(하루 1회)의 간극을 인프라 백업이 보완.
