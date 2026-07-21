# 스테이징(테스트 서버) 환경 구축 검토

> **상태: 확정 — 방식 B 채택, 절차서 작성됨 (2026-07-21)**
> 테오님 결정: **방식 B(완전 별도 Railway 프로젝트)**. 목적 = iOS PWA 상태바/스플래시 같은 뷰포트·UI 변경을
> 프로덕션(villa-go.net)을 건드리지 않고 실기기(설치 PWA)로 수렴시킨 뒤 한 번에 main 반영.
> **실행 절차는 맨 아래 「## 실행 체크리스트(확정)」 참조.** 위쪽 3방식 비교는 결정 근거로 보존.

## 배경 / 문제의식

- 이제 프로덕션(villa-go.net)은 **실데이터 운영 단계**([[test-data-vs-real-data-boundary]]). 개발한 코드를 프로덕션에 바로 얹었다가 문제 나면 복구가 복잡하다.
- 로컬 개발 서버는 컴퓨터가 느려서 실사용이 답답함 → 잘 안 쓰게 됨.
- 그래서 **프로덕션과 동일한 스테이징(테스트) 서버**를 클라우드에 따로 두고, 거기서 먼저 검증한 뒤 프로덕션에 올리는 방식을 검토.
- 스테이징은 클라우드에서 도니까 로컬 컴퓨터 성능과 무관.

## 핵심 결론 (요약)

- **월 $10~20 (약 1.5~3만원) 추가, 구축 반나절 수준.** Railway Pro 플랜에 이미 사용량 크레딧 포함이라 현재 사용량이 낮으면 실질 추가요금이 거의 0일 수도 있음.
- **돈·구축은 쉬움.** 진짜 신경 쓸 유일한 난점은 **Zalo 알림 분리** 하나.

## 구축 방식 3가지

| 방식 | 구축 난이도 | 월 비용 추가 | 특징 |
|---|---|---|---|
| A. Railway 별도 환경(Environment) | 쉬움 | ~$10~20 | 한 프로젝트 안에 production/staging 두 환경. 변수만 분리, 코드는 브랜치로 배포 |
| **B. 완전 별도 프로젝트** ⭐추천 | 중간 | ~$10~20 | 프로덕션과 100% 격리. 실수로 프로덕션 건드릴 위험 0 |
| C. 임시(PR) 환경 | 쉬움 | 거의 무료 | PR 열 때만 잠깐 뜸. 상시 테스트 사이트로는 부적합 |

**추천 = 방식 B (완전 별도 프로젝트).** 마진·재고 비공개가 사업 핵심이고, 프로덕션 데이터 사고 시 복구가 복잡하므로 물리적으로 완전히 격리된 별도 프로젝트가 안전. A와 비용 차이 거의 없음.

## 비용 상세 (월, USD)

| 항목 | 비용 | 설명 |
|---|---|---|
| Railway 스테이징 앱(Next.js) | ~$5~10 | 트래픽 거의 없음. sleep 걸면 더 저렴 |
| Railway 스테이징 Postgres | ~$3~5 | 소량 DB. 프로덕션 백업본 복원해서 사용 |
| Cloudflare 서브도메인(staging.villa-go.net) | 무료 | DNS 레코드 1줄 |
| R2 스테이징 버킷 | 무료 | 10GB 무료 티어 내 |
| Gemini API | 거의 무료 | 테스트 호출량 미미(종량제) |
| **합계** | **~$10~20 (1.5~3만원)** | Pro 플랜 포함 크레딧 감안 시 실질 추가 0 가능 |

## 구축 작업 (반나절~하루)

1. Railway에 `staging` 환경/프로젝트 생성 + Postgres 붙이기
2. Cloudflare에 `staging.villa-go.net` DNS 추가 → Railway 연결
3. 환경변수 세트 복제 후 **분리값으로 교체** (NEXTAUTH_URL, DATABASE_URL 등)
4. 프로덕션 DB 자동 백업([[db-backup-automation]]) 복원 → 실데이터 유사 환경
5. 배포 브랜치를 `staging`으로 지정 → 검증 후 main 병합

## ⚠ 유일한 진짜 난점 — 외부 연동 분리

값만 바꾸면 되는 나머지와 달리, 아래는 반드시 분리해야 스테이징이 프로덕션을 오염시키지 않음:

- **Zalo 알림 (가장 까다로움)** — OA(공식 API)가 아니라 **개인 계정 QR 로그인(zca-js, ADR-0005)** 방식이라 스테이징용으로 쓰려면:
  - ① **별도 Zalo 테스트 계정**을 하나 더 만들어 QR로 붙이거나 (계정 준비·QR 로그인 유지 손이 감), 또는
  - ② 스테이징에선 **발송을 아예 꺼둠** — 기존 `ZALO_OPERATOR_NOTIFY_PAUSED` 스위치([[operator-notify-pause-switch]]) 재활용. 별도 계정 없이도 "실공급자에게 테스트 메시지 발송 사고" 100% 차단. 단 Zalo 발송 자체를 테스트하려면 그땐 ① 필요.
- **R2 저장소** — 스테이징 전용 버킷(무료)
- **Cron** — 스테이징에선 홀드 만료·백업 cron 끄기(중복 실행 방지)
- **DATABASE_URL** — 프로덕션 DB 공유 절대 금지

## 다음 액션 (재논의 시)

- ~~테오님 결정 대기~~ → **결정 완료(2026-07-21): 방식 B + Zalo ②발송끄기(별도 계정 안 만듦).** 아래 체크리스트로 진행.

---

## 실행 체크리스트(확정)

> **확정 전제 (2026-07-21)**
> 1. **방식 B** — 완전 별도 Railway 프로젝트(프로덕션과 100% 격리).
> 2. **도메인** — 초기엔 커스텀 도메인(staging.villa-go.net) **불필요**. Railway 기본 도메인 `*.up.railway.app`(HTTPS 자동 제공)으로 PWA 설치·실기기 테스트 가능. → **Cloudflare DNS 단계 생략**. 나중에 상시 URL이 필요해지면 그때 서브도메인 추가(무료, 1줄).
> 3. **Zalo** — 스테이징은 **발송 완전 차단**(별도 Zalo 계정 안 만듦). 실공급자 오발송 사고 100% 차단이 목적. → 코드 플래그 `APP_ENV=staging`(발송 헬퍼 no-op) + AppSetting `ZALO_OPERATOR_NOTIFY_PAUSED=1` **이중 차단**.
> 4. **DB** — 스테이징 전용 Postgres(별도). 프로덕션 DB 공유 **절대 금지**. 초기엔 빈 DB + 테스트 운영자 계정 시드로 충분(프로덕션 백업 복원은 선택).
> 5. **배포 브랜치** — `staging` 브랜치를 스테이징 프로젝트가 배포. UI 실험은 staging 브랜치에서 → 검증되면 main 병합. (main=프로덕션 자동배포는 그대로.)
> 6. **Cron** — 스테이징에선 cron 서비스 **만들지 않음**(홀드만료·백업·알림 중복 실행 방지). Next 웹 서비스 1개 + Postgres 1개만.
>
> **비용 재확인: 월 $10~20(약 1.5~3만원). Railway Pro 포함 크레딧 감안 시 실질 추가요금이 거의 0일 수 있음.**
> **범례**: 🧑 = 테오님이 Railway/브라우저에서 직접 / 🤖 = 코드·스크립트(OPS가 준비, 테오님은 실행만).

### A. Railway 프로젝트·서비스 생성 (🧑 테오님)

1. 🧑 Railway 대시보드 → **New Project** → 이름 `villa-pms-staging` (프로덕션 `villa-pms`와 확실히 구분되는 이름).
2. 🧑 **Deploy from GitHub repo** → `orangetaeo/villa-pms` 선택 → 서비스 생성.
3. 🧑 생성된 웹 서비스 → **Settings → Source → Branch = `staging`** 로 지정 (main 아님! 여기가 프로덕션과 갈리는 핵심).
   - `staging` 브랜치가 아직 없으면: 로컬에서 `git branch staging main && git push -u origin staging` (또는 GitHub UI에서 main 기준 브랜치 생성). ⚠ 이 push 자체는 프로덕션 무영향(스테이징 프로젝트만 이 브랜치를 봄).
4. 🧑 Settings → **Build**: 별도 설정 불필요(package.json `build` = `prisma generate && next build` 그대로). Start = `next start`(Railway 기본 감지).
5. 🧑 이 서비스에는 **cron 서비스를 추가하지 않는다**(전제 6). 프로덕션의 cron-* 서비스들은 복제하지 말 것.

### B. Postgres 추가 (🧑 테오님)

6. 🧑 같은 스테이징 프로젝트 안에서 **New → Database → Add PostgreSQL** (스테이징 전용 인스턴스).
7. 🧑 생성된 Postgres → **Variables** 탭에서 `DATABASE_URL`(또는 `DATABASE_PUBLIC_URL`) 값 확인.
   - 웹 서비스와 같은 프로젝트면 Railway가 `${{Postgres.DATABASE_URL}}` 레퍼런스로 자동 주입 가능(권장). 수동 입력 시 이 값을 웹 서비스 env `DATABASE_URL`에 넣는다.
   - ⚠ **이 URL이 프로덕션 `*.rlwy.net` 호스트와 다른지 눈으로 확인.** 같으면 프로덕션 DB를 가리키는 것 — 즉시 중단.

### C. 환경변수 세트 (🧑 테오님이 Railway Variables에 입력, 값은 🤖 OPS가 안내)

> 프로덕션 `.env` 키 목록 기준. **스테이징에서 반드시 바꿀 값**과 **스테이징 전용 신규**만 아래 표로 정리.
> 표에 없는 나머지 키(예: `NIKE_*`, `TURNSTILE_*`)는 **비워두거나 프로덕션과 동일 재사용** 가능(아래 "재사용/공란" 참고).
> ⚠ **실제 시크릿 값은 이 문서에 절대 쓰지 않는다.** 아래는 플레이스홀더.

| 키 | 스테이징 값 | 왜 |
|---|---|---|
| `DATABASE_URL` | **스테이징 Postgres URL**(B단계, `${{Postgres.DATABASE_URL}}` 권장) | 프로덕션 DB 공유 절대 금지 |
| `NEXTAUTH_URL` | `https://<스테이징>.up.railway.app` (Railway가 발급한 실제 도메인) | 콜백·쿠키 도메인. 프로덕션 URL이면 로그인 깨짐 |
| `NEXTAUTH_SECRET` | **새로 생성** → `openssl rand -base64 32` | 프로덕션 세션 토큰과 분리(재사용 시 세션 혼선·보안 저하) |
| `ZALO_CREDS_KEY` | **새로 생성** → `openssl rand -base64 32` (또는 공란) | 스테이징은 Zalo 미연결 예정이라 미사용. 공란이어도 발송이 no-op라 무방. 넣을 거면 새 값 |
| `CRON_SECRET` | **새로 생성** → `openssl rand -base64 32` | cron 안 돌리지만, 라우트 보호용으로 값은 둔다(외부에서 cron URL 직접 호출 차단) |
| `STORAGE_ACCOUNT_ID` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | **스테이징 R2 버킷 토큰**(권장) 또는 **공란** | 공란이면 이미지 업로드가 로컬 디스크(`UPLOAD_DIR`/`./public/uploads`) 폴백. 프로덕션 버킷 토큰 재사용 시 스테이징 업로드가 프로덕션 버킷을 오염시키므로 **재사용 금지** |
| `STORAGE_BUCKET_NAME` | `villa-pms-staging-uploads` (별도 버킷 만들 때) 또는 공란 | 프로덕션 `villa-pms-uploads`와 분리 |
| `STORAGE_PUBLIC_URL` | 스테이징 버킷 public URL 또는 공란 | 공란이면 상대경로 폴백 |
| `BACKUP_BUCKET_NAME` | **공란** | 스테이징은 백업 cron 안 돌림. 값 없으면 백업 라우트 500이지만 호출 안 하므로 무해 |
| `GEMINI_API_KEY` | 프로덕션과 **동일 재사용 가능** | 번역·OCR 종량제 소액. 스테이징 테스트 호출량 미미. (원하면 별도 키) |
| `GEMINI_MODEL` | 공란(기본 `gemini-2.5-flash`) | 선택 |
| `VILLA_PUBLIC_BASE_URL` | `https://<스테이징>.up.railway.app` 또는 공란 | 알림 링크 절대경로화용. 스테이징은 발송 no-op라 사실상 미사용 |
| **`APP_ENV`** 🆕 | `staging` | **스테이징 전용 신규.** 코드가 이 값을 보고 Zalo 발송 no-op + STAGING 배지 표시(아래 B산출물) |
| **`NEXT_PUBLIC_APP_ENV`** 🆕 | `staging` | **스테이징 전용 신규.** 클라이언트(배지)에서 읽는 공개 플래그. `APP_ENV`와 같은 값 |

**재사용/공란 처리**: `ZALO_EXT_SHARED_SECRET`·`ZALO_WEBHOOK_HMAC_SECRET`·`NIKE_WEBHOOK_URL`·`NIKE_DATABASE_URL`·`ZALO_SYSTEM_OWNER_ID`·`TURNSTILE_*`·`ZALO_CONNECT_*`은 **전부 공란으로 두어도 스테이징 UI 테스트에 지장 없음**(Nike 연동·웹챗 봇검증·Zalo QR은 스테이징 대상 아님). Nike webhook URL은 **반드시 공란**(값 넣으면 스테이징 이벤트가 프로덕션 Nike로 새어나감).

> **`ZALO_OPERATOR_NOTIFY_PAUSED`는 env가 아니라 DB의 AppSetting**이다. → C단계 env가 아니라 아래 **E단계 시드에서 값 `"1"`로 넣는다**(코드 플래그 `APP_ENV=staging`와 함께 이중 차단).

### D. 스키마 적용 — 빈 스테이징 DB 초기 구성 (🤖 OPS, 테오님 실행)

> ⚠ **CLAUDE.md 규약은 라이브 프로덕션 DB 한정으로 `prisma db push`·`migrate dev`를 금지**한다(additive raw SQL 정본).
> 그러나 **처음 만든 빈 스테이징 DB의 최초 1회 스키마 구성**은 그 규약의 예외다. 이 레포엔 `prisma/migrations/`(선언적 마이그레이션 히스토리)가 **없고**(스키마는 `prisma/migrations-manual/` raw SQL로 누적 관리) → `prisma migrate deploy`는 쓸 수 없다.
> **빈 DB를 schema.prisma 전체로 한 방에 세우는 유일한 안전 명령 = `prisma db push`. 단, STAGING DATABASE_URL에만.**

8. 🤖 **로컬 터미널에서, 환경변수 하나만 STAGING으로 지정해 실행**(셸 환경 오염 방지 위해 인라인):

   PowerShell:
   ```powershell
   $env:DATABASE_URL="<스테이징 Postgres URL>"; npx prisma db push; Remove-Item Env:DATABASE_URL
   ```
   Git Bash:
   ```bash
   DATABASE_URL="<스테이징 Postgres URL>" npx prisma db push
   ```
   - `prisma db push`는 schema.prisma를 빈 DB에 그대로 반영(테이블·enum·인덱스 전부 생성). 데이터 손실 경고가 뜨면 **빈 DB가 아니라는 신호** → URL이 프로덕션인지 재확인 후 중단.
   - 🚨 **절대 규칙**: 이 명령을 **프로덕션 `*.rlwy.net` URL로 실행 금지.** 실행 전 URL 문자열을 눈으로 확인. `.env`의 프로덕션 URL이 셸에 남아있지 않은지 확인(그래서 인라인 지정 + 실행 후 `Remove-Item`).
   - 이후 프로덕션과 동일하게, 스테이징에서도 스키마 변경은 raw SQL(migrations-manual) 유지. `db push`는 **최초 1회 부트스트랩 전용**.

### E. 테스트 운영자 계정 + 발송차단 시드 (🤖 OPS, 테오님 실행)

9. 🤖 기존 시드 스크립트 `prisma/seed.ts`가 **멱등**하며 운영자(OWNER=테오)·공급자·빌라 4채·AppSetting을 넣는다. 스테이징 DB에 그대로 실행:

   PowerShell:
   ```powershell
   $env:DATABASE_URL="<스테이징 Postgres URL>"; $env:SEED_ADMIN_PASSWORD="<스테이징 로그인 비번>"; npx tsx prisma/seed.ts; Remove-Item Env:DATABASE_URL; Remove-Item Env:SEED_ADMIN_PASSWORD
   ```
   - 운영자 로그인: `prisma/seed.ts`는 전화번호 `0900000010`(테오)으로 upsert. 비번은 `SEED_ADMIN_PASSWORD`(미지정 시 기본 `villa-pms-admin-dev`). **스테이징에선 반드시 별도 비번 지정** 후 그 값으로 로그인.
   - 최소만 원하면 seed.ts의 사용자 upsert 블록만 떼어 써도 되지만, 빌라·AppSetting까지 있어야 화면이 정상 렌더되므로 **전체 seed.ts 실행 권장**.

10. 🤖 **Zalo 발송 이중 차단 — AppSetting 주입**: 아래 한 줄 스크립트로 `ZALO_OPERATOR_NOTIFY_PAUSED="1"`을 스테이징 DB에 넣는다(또는 앱 로그인 후 /settings에서 켜기).
    ```bash
    DATABASE_URL="<스테이징 Postgres URL>" npx tsx -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); p.appSetting.upsert({where:{key:'ZALO_OPERATOR_NOTIFY_PAUSED'},update:{value:'1'},create:{key:'ZALO_OPERATOR_NOTIFY_PAUSED',value:'1'}}).then(()=>{console.log('paused=1');return p.$disconnect();})"
    ```
    - 이건 `APP_ENV=staging` 코드 no-op(아래 B산출물)과 **중복 안전장치**다. 하나가 빠져도 실공급자에게 메시지가 안 감.

### F. PWA 설치·검증 (🧑 테오님, 실기기)

11. 🧑 스테이징 도메인(`https://<...>.up.railway.app`)을 **아이폰 Safari**로 연다 → 로그인(E단계 운영자 계정).
12. 🧑 공유 버튼 → **홈 화면에 추가** → 설치 PWA 실행. 여기서 상태바 색/스플래시/하단 safe-area를 실기기로 검증.
13. ⚠ **재설치 캐시 함정** ([[ios-pwa-splash-and-statusbar-install-cache]]): `apple-mobile-web-app-status-bar-style`·`apple-touch-startup-image`(상태바 스타일·스플래시 PNG) 같은 **메타를 바꾼 배포**는, 이미 설치된 아이콘엔 옛 값이 캐시된다. → **홈 화면 아이콘 삭제 후 재추가**해야 반영. 반면 **CSS만 바뀐 재배포**는 앱 강제종료(스와이프) 후 재실행이면 반영(재설치 불필요). "배포가 안 됐나?" 오판 금지 — curl로 라이브 메타 바뀐 걸 확인해도 폰이 그대로면 이 캐시가 원인.

### G. 검증 후 main 반영 (🤖/🧑)

14. 스테이징에서 UI가 수렴하면, `staging` 브랜치를 main으로 병합(PR 권장). main 병합 = 프로덕션 자동배포 → 실사용자에게 반영.
15. 프로덕션 배포 후 스모크 3종(로그인 / 운영자 홈 / `/p/[token]` 404) 확인 후 종료.

### 안전 요약 (사고 방지 3선)

- **DB**: 모든 DB 명령(D·E단계)은 STAGING URL을 **인라인 지정** + 실행 후 즉시 해제. 프로덕션 `*.rlwy.net`로 `db push`/`seed` 금지.
- **Zalo**: `APP_ENV=staging`(코드 no-op) + `ZALO_OPERATOR_NOTIFY_PAUSED=1`(AppSetting) 이중 차단. `NIKE_WEBHOOK_URL`·`STORAGE_*`는 프로덕션 값 재사용 금지(공란 또는 스테이징 전용).
- **Cron**: 스테이징엔 cron 서비스 0개. 홀드만료·iCal·백업·알림 재시도가 스테이징에서 실행되면 안 됨.
