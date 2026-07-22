# T-publish-orphan-reaper — 발행 고아(PUBLISHING) 자동 회수

- 담당: BE (구현) → QA (검증)
- 브랜치: `worktree-publish-reaper`
- 착수: 2026-07-23

## 배경 (실제 사고)

2026-07-22 18:35(GMT+7) `cron-instagram-publish` 실행이 배포 교체 중 `curl (22) 502`로 죽었다.
라우트는 `QUEUED → PUBLISHING` 원자 선점을 먼저 하므로, 발행 도중 프로세스가 끊기면
**그 행은 PUBLISHING에 영구히 갇힌다**(어떤 코드도 PUBLISHING을 되돌리지 않음).

- 결과: 릴스 1건이 발행되지 않은 채 큐에서 사라짐 → 사람이 계정을 눈으로 확인하고 손으로 FAILED 처리
- 같은 구조가 `youtube-publish`에도 그대로 있음(YtShortStatus.PUBLISHING)
- 편집 축(`editJobStatus: PROCESSING`)에는 이미 고아 회수가 있는데(`youtube-edit-jobs` cron ①단계, 25분)
  **발행 축(status: PUBLISHING)에는 없다** — 이 계약의 범위

## 범위 (Scope)

### 1. `lib/marketing/reap-stale-publishing.ts` (신규)
`reapStalePublishing(db?)` — InstagramPost·YoutubeShort 두 모델의 stale PUBLISHING을 FAILED로 회수.

- 판정: `status = PUBLISHING AND updatedAt < now - 20분`
  - 근거: 두 라우트 모두 `maxDuration = 300`(5분)이 하드 상한 → 20분은 정상 실행의 4배. 살아있는 발행을 죽일 수 없다.
- 회수: `updateMany`로 `{status: PUBLISHING}` 조건부 갱신(원자성 — 방금 성공한 행을 덮어쓰지 않는다)
  - `status = FAILED`, `failReason = "발행 중 중단(고아 자동 회수) — 계정에서 실제 발행 여부를 확인한 뒤 재발행하세요."`
- **★ 절대 QUEUED로 되돌리지 않는다**: 끊긴 시점에 플랫폼에는 이미 올라갔을 수 있다(7/22 건은 안 올라갔지만 보장 불가).
  자동 재발행은 중복 게시 위험 → 반드시 사람이 확인. FAILED + 경보가 정본.
- 회수 건마다 `writeAuditLog({userId: null, action: "UPDATE", entity: "InstagramPost"|"YoutubeShort", changes: {status: {old: "PUBLISHING", new: "FAILED"}, failReason: {new: ...}}})`
- 회수분 있으면 `notifyMarketing`으로 경보 — **기존 kind 재사용**(`IG_PUBLISH_FAILED` / `YT_PUBLISH_FAILED`).
  새 MarketingAlertKind·NotificationType enum 추가 금지(enum 드리프트 함정 회피).
- 반환: `{ instagram: number; youtube: number }`. 내부 오류는 삼키지 않고 호출부가 격리(try/catch)한다.

### 2. 호출 지점 3곳
- `app/api/cron/instagram-publish/route.ts` — 인증 통과 직후, 킬스위치 검사 **전**(자기 치유). try/catch 격리.
- `app/api/cron/youtube-publish/route.ts` — 동일 위치.
- `app/api/cron/youtube-edit-jobs/route.ts` (*/5분) — ①단계 편집 고아 회수 옆에 발행 고아 회수 추가.
  → 새 cron 서비스 등록 없이 **5분 내 감지**. 이 cron은 사실상 "마케팅 잡 틱"임을 주석으로 명시.

### 3. 문서
- 두 라우트 상단 주석에 고아 회수 흐름 1줄 추가
- `docs/marketing/instagram-marketing-plan.md`에 운영 노트 1줄(고아 발생 시 자동 FAILED + 경보 → 계정 확인 후 재발행)

## 범위 밖 (Out of scope)
- 새 cron 서비스 등록, Railway 설정 변경(이미 별도 조치: `RUN_CMD -m 330 --retry 5` 적용 완료)
- schema.prisma 변경 (없음 — 기존 enum·컬럼만 사용)
- admin UI 변경
- SEO 발행 축(`SeoArticleStatus`) — 동일 구조인지 미확인, 별건

## 수정 금지 구역
- `prisma/schema.prisma` (스키마 변경 없음)
- `lib/youtube/edit.ts`, `lib/youtube/narration.ts`, `lib/instagram/publish.ts` (발행·렌더 본체)
- `messages/*.json` (사용자 대면 문구 없음 — 운영자 알림은 ko 하드코딩 기존 패턴)

## 완료 기준 (테스트 가능)
1. `npm run lint && npm run typecheck` 통과
2. `npm run build` 통과 (배포 빌드 게이트)
3. 단위 테스트 `__tests__`에 `reap-stale-publishing` 케이스:
   - 20분 초과 PUBLISHING → FAILED + failReason 세팅 + 감사로그 1건
   - 19분 경과 PUBLISHING → **건드리지 않음**(살아있는 발행 보호)
   - QUEUED·PUBLISHED·FAILED 행 → 영향 없음
   - 회수 0건이면 `notifyMarketing` 호출 없음
4. 회수된 행이 QUEUED가 아니라 FAILED인지 명시적으로 단언(중복 발행 방지 회귀 테스트)
5. QA: 실제 DB의 현재 PUBLISHING 0건 상태에서 세 라우트가 200을 반환하고 아무 행도 바뀌지 않음을 확인

## 검증 방법
- 로컬: 위 테스트 + `npm run build`
- 배포 후: `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/youtube-edit-jobs` 200 + 응답에 회수 카운트 필드
