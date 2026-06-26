# OPS 런북 — Railway Cron 등록

> 작성 2026-06-26. Railway CLI(`add`/`service`)는 cron 스케줄 설정을 지원하지 않아 **대시보드에서 수동 등록**한다.
> 패턴 출처: `.claude/skills/ops/deployment-pattern.md` (§Cron).
>
> **✅ 2026-06-26 등록·검증 완료**: 아래 4개 모두 Railway에 서비스 생성·Run now 성공·스케줄 자동 실행 확인(`cron-notifications`는 5분 자동 실행 3회 연속 성공). 현재 가동 cron 7개: `cron-ical-sync`(*/30)·`cron-expire-holds`(*/5)·`cron-notifications`(*/5)·`cron-partner-overdue`(0 0 * * *)·`cron-roster-reminder`(0 1 * * *)·`cron-periodic-cleaning`(0 2 1 * *)·`cron-fx-update`(0 1 * * *).
> **추가 2026-06-26 (PR #69)**: `cron-fx-update` 등록(Duplicate `cron-partner-overdue` → URL·스케줄·이름 변경). 서비스 생성·Run now 성공. ⚠️ **토글 `FX_AUTO_UPDATE` 기본 OFF**라 cron이 돌아도 응답은 `skipped_off`(무동작). 실제 갱신은 운영자가 `/settings` 환율 카드에서 자동 갱신을 켜야 시작.
> 등록 팁: 첫 서비스는 빈 서비스 → Settings §Source의 **Connect Image**로 `curlimages/curl` 연결(Root Directory 칸 아님!) → §Deploy의 Custom Start Command + Cron Schedule → Variables에 CRON_SECRET. 이후 서비스는 **Duplicate(복제)** 후 주소·스케줄·이름만 변경이 가장 빠름.

## 등록 대상 (5개)

| 서비스명 | 엔드포인트 | 스케줄(UTC) | VN 현지 | 부수효과 |
|---|---|---|---|---|
| `cron-notifications` | `/api/cron/notifications` | `*/5 * * * *` | 5분마다 | **Zalo 메시지 발송**(PENDING 큐) |
| `cron-partner-overdue` | `/api/cron/partner-overdue` | `0 0 * * *` | 매일 07:00 | 채권 OVERDUE 전이(메시지 없음) |
| `cron-roster-reminder` | `/api/cron/roster-reminder` | `0 1 * * *` | 매일 08:00 | **Zalo 메시지 발송**(D-3 명단 리마인더) |
| `cron-periodic-cleaning` | `/api/cron/periodic-cleaning` | `0 2 1 * *` | 매월 1일 09:00 | 정기방역 태스크 생성(메시지 없음) |
| `cron-fx-update` | `/api/cron/fx-update` | `0 1 * * *` | 매일 08:00 | 판매가 환율 `FX_VND_PER_KRW` 갱신(토글 ON일 때만, 메시지 없음) |

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
   - ✅ fx-update는 토글 OFF면 `{"status":"skipped_off"}`(부수효과 없음) — 안전하게 검증 가능.
3. **Run now**: 대시보드 Cron Runs 탭 → Run now → 성공 로그.
4. **스케줄 자동 실행**: 정각/주기 실행 후 Cron Runs 탭 초록 확인. (③과 ④는 실행 경로가 달라 둘 다 확인.)

## 참고
- partner-overdue 미등록 시: 채권이 OVERDUE로 전이 안 돼 미수/여신 대시보드·신용 게이트가 부정확.
- roster-reminder 미등록 시: D-3 투숙객 명단 리마인더 미발송.
- notifications 미등록 시: PENDING Zalo 알림이 자동 발송되지 않음(큐에 적체).
- periodic-cleaning 미등록 시: 월 정기방역 태스크 자동 생성 안 됨.
- fx-update 미등록 시: 판매가 환율 자동 갱신 안 됨(수동 입력 유지). **단 토글 OFF가 기본이라 미등록·미설정도 안전** — 자동 갱신을 켜려면 ① 본 cron 등록 ② `/settings`에서 토글 ON 둘 다 필요. (구현: [[fx-auto-update-optin]], 계약 `docs/contracts/T-fx-auto-update.md`)
