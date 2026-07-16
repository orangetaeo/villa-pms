# OPS 런북 — Railway Cron 등록

> 작성 2026-06-26. Railway CLI(`add`/`service`)는 cron 스케줄 설정을 지원하지 않아 **대시보드에서 수동 등록**한다.
> 패턴 출처: `.claude/skills/ops/deployment-pattern.md` (§Cron).
>
> **✅ 2026-06-26 등록·검증 완료**: 아래 4개 모두 Railway에 서비스 생성·Run now 성공·스케줄 자동 실행 확인(`cron-notifications`는 5분 자동 실행 3회 연속 성공). 현재 가동 cron 8개: `cron-ical-sync`(*/30)·`cron-expire-holds`(*/5)·`cron-notifications`(*/5)·`cron-partner-overdue`(0 0 * * *)·`cron-roster-reminder`(0 1 * * *)·`cron-periodic-cleaning`(0 2 1 * *)·`cron-fx-update`(0 1 * * *)·`cron-cleanup-passports`(0 3 * * *).
> **추가 2026-06-26 (PR #69)**: `cron-fx-update` 등록(Duplicate `cron-partner-overdue` → URL·스케줄·이름 변경). 서비스 생성·Run now 성공. ⚠️ **2026-07-12 개편**: 판정 키가 `FX_AUTO_UPDATE`(deprecated)에서 `FX_MODE`로 변경 — `FX_MODE=AUTO`일 때만 동작(KRW·USD 2키 갱신), MANUAL/미설정이면 `skipped_manual`(무동작). 운영자가 `/settings` 환율 카드에서 모드를 자동으로 저장해야 시작. 응답 스키마 `{status, keys:[{key,status,oldValue,newValue?}]}`.
> **추가 2026-06-28 (PR #107, 보안 P1-S3)**: `cron-cleanup-passports` 등록(Duplicate `cron-periodic-cleaning` → URL·스케줄·이름 변경). 서비스 생성·Run now 성공(`curlimages/curl` 초록·1s·`{deleted:0}` 정상). 90일 지난 여권·서명 사진 자동 삭제(개인정보 보존정책 PDPD/PIPA). 멱등·메시지 없음. ⏳ 03:00 UTC 자동 실행 초록 확인은 익일 글랜스.
> 등록 팁: 첫 서비스는 빈 서비스 → Settings §Source의 **Connect Image**로 `curlimages/curl` 연결(Root Directory 칸 아님!) → §Deploy의 Custom Start Command + Cron Schedule → Variables에 CRON_SECRET. 이후 서비스는 **Duplicate(복제)** 후 주소·스케줄·이름만 변경이 가장 빠름.

## 등록 대상

| 서비스명 | 엔드포인트 | 스케줄(UTC) | VN 현지 | 부수효과 |
|---|---|---|---|---|
| `cron-notifications` | `/api/cron/notifications` | `*/5 * * * *` | 5분마다 | **Zalo 메시지 발송**(PENDING 큐) |
| `cron-partner-overdue` | `/api/cron/partner-overdue` | `0 0 * * *` | 매일 07:00 | 채권 OVERDUE 전이(메시지 없음) |
| `cron-roster-reminder` | `/api/cron/roster-reminder` | `0 1 * * *` | 매일 08:00 | **Zalo 메시지 발송**(D-3 명단 리마인더) |
| `cron-periodic-cleaning` | `/api/cron/periodic-cleaning` | `0 2 1 * *` | 매월 1일 09:00 | 정기방역 태스크 생성(메시지 없음) |
| `cron-fx-update` | `/api/cron/fx-update` | `0 1 * * *` | 매일 08:00 | 판매가 환율 `FX_VND_PER_KRW` 갱신(토글 ON일 때만, 메시지 없음) |
| `cron-cleanup-passports` | `/api/cron/cleanup-passports` | `0 3 * * *` | 매일 10:00 | 90일 경과 여권·서명 사진 삭제(개인정보 보존정책, 메시지 없음) |
| `cron-security-alerts` | `/api/cron/security-alerts` | `*/10 * * * *` | 10분마다 | 보안 이상탐지 경보(SecurityEvent 임계치 초과 시 운영자에게 **Zalo 발송**, 60분 쿨다운) — 보안 P3-S3 |
| `cron-checkout-reminder` | `/api/cron/checkout-reminder` | `0 1 * * *` | 매일 08:00 | **Zalo 알림 큐 적재**(내일 체크아웃 예약 → 담당 청소원/공급자 D-1 사전 청소알림, checkOut==today+1 멱등) — PR #139 |
| `cron-instagram-draft` | `/api/cron/instagram-draft` | `20 21 * * *` | 매일 04:20 | 인스타 초안 일 3건 생성(SELLABLE·사진4장↑ 빌라 로테이션, 승인 큐 적재 — 발행 아님). GraphQL 등록(2026-07-16) |
| `cron-instagram-insights` | `/api/cron/instagram-insights` | `0 22 * * *` | 매일 05:00 | 인스타 인사이트 수집(30일 내 매일+구포스트 주1회, PUBLISHED 0건=no-op). GraphQL 등록(2026-07-16) |
| `cron-instagram-token-refresh` | `/api/cron/instagram-token-refresh` | `40 20 * * *` | 매일 03:40 | IG 장기토큰 자동 갱신(멱등 — 주 1회만 실제 갱신, 실패 시 IG_TOKEN_REFRESH_FAILED 인앱 경보). GraphQL API로 등록(2026-07-16, db-backup 선례) |
| `cron-db-backup` | `/api/cron/db-backup` | `0 20 * * *` | 매일 03:00 | DB 스냅샷 R2 백업(메시지 없음) — 프라이빗 버킷 gzip, daily 14·monthly 12 보존. 런북 `docs/ops/db-backup.md`. ⚠ curl 타임아웃 `-m 300`(스냅샷 여유) |

> **✅ 2026-07-03 등록 완료 — 이로써 전 크론(10개) 등록.** `cron-checkout-reminder`(PR #139 신규, 런북 최초 작성 06-26 이후 추가돼 누락됐던 것 발견·보완)와 `cron-security-alerts`(P3-S3)를 테오가 대시보드에서 등록. Run now 성공(각 1s·2s) + checkout-reminder는 앱 DB에서 무부작용 확인(내일 체크아웃 0건 → 알림 0건 멱등 no-op 200). **security-alerts는 스케줄 자동 실행(09:31Z)까지 정상 요약 반환 확인 — §가장 흔한 실패(sh -c) 통과.** checkout-reminder 자동 실행은 01:00 UTC 1회/일 — 익일 Cron Runs 초록 글랜스 권장. 위 등록 절차로 1개 추가하면 가동(Duplicate 후 URL `/api/cron/security-alerts`·스케줄 `*/10 * * * *`·이름 변경). 미등록 시 보안 경보가 자동 발송되지 않음(SecurityEvent는 계속 쌓임 — 수동 조회는 가능, [[incident-response]]). 임계치는 `lib/security-alerts.ts` `SECURITY_ALERT_THRESHOLDS` 상수.
> ⚠️ Railway cron 스케줄은 **UTC**. VN(UTC+7) 현지 시각은 참고용.
> 모든 라우트는 멱등(중복 실행 안전). `*/5`는 분, `0 0 * * *`는 매일 00:00 UTC.

## 등록 절차 (각 서비스 반복, 1개당 ~30초)

Railway 대시보드 → 프로젝트 `outstanding-vibrancy` → production 환경에서:

1. **+ New** → **Empty Service**(또는 Docker Image) 선택.
2. **Settings → Source**: Docker Image = `curlimages/curl`
3. **Settings → Deploy → Custom Start Command** (★ `sh -c '...'` 래핑 필수):
   ```
   sh -c 'curl -fsS -m 120 -H "Authorization: Bearer $CRON_SECRET" https://villa-pms-production.up.railway.app/api/cron/<엔드포인트>'
   ```
   - 예) notifications: `.../api/cron/notifications`
4. **Settings → Deploy → Cron Schedule**: 위 표의 스케줄 입력.
5. **Variables**: `CRON_SECRET` = `${{villa-pms.CRON_SECRET}}` (메인 서비스 값 참조 — **Deploy 전에** 등록).
6. **도메인 생성 금지**(외부 접근 불필요).
7. 서비스명을 위 표대로 변경 후 Deploy.

## ★ 가장 흔한 실패 (교훈)

**Start Command의 `$CRON_SECRET`는 반드시 `sh -c '...'`로 감쌀 것.** 감싸지 않으면 Deploy 직후 1회 실행은 셸 확장이 되어 성공하지만, **스케줄 자동 실행은 리터럴 `$CRON_SECRET`를 그대로 전송**해 매번 401(curl -f 실패)이 난다. "Run now 성공"만 보고 판단 금지.

## 검증 4단계 (등록 후 각 서비스)

1. **무인증 401**: `curl https://villa-pms-production.up.railway.app/api/cron/<이름>` → 401 (라우트 게이트). ✅ 4개 모두 확인됨(2026-06-26).
2. **수동 200**: `curl -H "Authorization: Bearer <실제 CRON_SECRET>" .../api/cron/<이름>` → 200 + 요약 JSON.
   - ⚠️ notifications·roster-reminder는 이 호출이 **실제 Zalo 메시지를 발송**하므로 의도적일 때만.
   - ✅ fx-update는 `FX_MODE`가 MANUAL/미설정이면 `{"status":"skipped_manual"}`(부수효과 없음) — 안전하게 검증 가능.
3. **Run now**: 대시보드 Cron Runs 탭 → Run now → 성공 로그.
4. **스케줄 자동 실행**: 정각/주기 실행 후 Cron Runs 탭 초록 확인. (③과 ④는 실행 경로가 달라 둘 다 확인.)

## 참고
- partner-overdue 미등록 시: 채권이 OVERDUE로 전이 안 돼 미수/여신 대시보드·신용 게이트가 부정확.
- roster-reminder 미등록 시: D-3 투숙객 명단 리마인더 미발송.
- notifications 미등록 시: PENDING Zalo 알림이 자동 발송되지 않음(큐에 적체).
- periodic-cleaning 미등록 시: 월 정기방역 태스크 자동 생성 안 됨.
- fx-update 미등록 시: 판매가 환율 자동 갱신 안 됨(수동 입력 유지). **단 토글 OFF가 기본이라 미등록·미설정도 안전** — 자동 갱신을 켜려면 ① 본 cron 등록 ② `/settings`에서 토글 ON 둘 다 필요. (구현: [[fx-auto-update-optin]], 계약 `docs/contracts/T-fx-auto-update.md`)
- cleanup-passports 미등록 시: 90일 지난 여권·서명 사진이 삭제 안 되고 누적(개인정보 보존정책 미준수). 기능 장애는 없으나 PDPD/PIPA 최소보존 원칙 위반 — 등록 권장. (구현: 보안 P1-S3, `lib/passport-retention.ts`, 계약 `docs/contracts/T-sec-hardening-p1.md`)
- checkout-reminder 미등록 시: 청소원이 D-1 사전 알림 없이 당일 체크아웃 후에야 청소 요청을 받음(일정 준비 불가). (구현: PR #139, `lib/checkout-reminder.ts` — 수신자는 빌라 cleanerId ?? supplierId)
- db-backup 미등록 시: 실DB가 자동 백업되지 않음(재해 시 최신 스냅샷 부재). 등록 필수. 전제 = `BACKUP_BUCKET_NAME`(프라이빗 R2 버킷) env 설정 — 미설정이면 수동 호출도 500. 구현: `docs/ops/db-backup.md`, 계약 `docs/contracts/T-db-backup-automation.md`. ⚠ Start Command의 curl은 백업만 `-m 300`(기본 120으로는 성장 시 타임아웃 위험).
- ⚠️ 청소원·공급자 Zalo 알림의 전제: 수신자 User에 `zaloUserId`가 연결돼 있어야 함. 미연결이면 발송이 **NO_ZALO_LINK 영구 실패**(재시도 제외) — cron 등록과 별개로 계정 연결 절차(친구추가 → `/users`에서 LINK_ZALO) 필요.
