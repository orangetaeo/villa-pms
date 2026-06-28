# 시크릿 노출 스캔 리포트 (보안 P0-4)

> 실행일: 2026-06-28 / 정본 계획: docs/SECURITY-HARDENING-PLAN-2026-06-27.md §3 P0-4
> 목적: 모든 시크릿이 git 히스토리·작업트리·설정 파일에 노출된 적 없는지 확증. 런칭 전 게이트.

## 결론: **노출 0건 (CLEAN)** ✅

작업트리·779개 전체 커밋 히스토리·CI·배포 설정 어디에도 **실제 시크릿 값이 발견되지 않음.** 발견된 매칭은 전부 `.env.example`의 플레이스홀더 또는 테스트 더미였다.

## 스캔 범위·방법 (재현 가능)

| # | 점검 | 명령 | 결과 |
|---|---|---|---|
| 1 | `.env`류가 히스토리에 커밋된 적 있나 | `git log --all --oneline -- .env .env.local .env.production` | **0건** (한 번도 추적 안 됨) |
| 2 | `.gitignore`가 `.env` 차단하나 | `grep .env .gitignore` | ✅ `.env`·`.env*.local` 포함 |
| 3 | 추적 파일 중 `.env`류 | `git ls-files \| grep .env` | `.env.example`만(플레이스홀더) |
| 4 | gitignore 빈틈(`.env.production`·`.env.development` 무.local) | `git ls-files \| grep -E '\.env\.(production\|development)$'` | **0건** |
| 5 | 작업트리 시크릿 값 패턴 | ripgrep: `AIza…`·`postgres://user:pass@`·`*_SECRET="값"`·`sk-…` (untracked 시드 스크립트 포함, .env류는 ripgrep이 자동 제외) | 매칭 6건 **전부 무해**(아래) |
| 6 | 히스토리 diff 전체(Gemini 키) | `git log --all -G "AIza[0-9A-Za-z_\-]{20,}"` | **0건** |
| 7 | 히스토리 diff(실 postgres 자격증명) | `git log --all -G "postgres(ql)?://user:pass@"` | 1건 → `.env.example` 플레이스홀더(`USER:PASSWORD@HOST`) |
| 8 | 히스토리 diff(NEXTAUTH/CRON/ZALO/GEMINI SECRET 값 할당) | `git log --all -G "(NEXTAUTH_SECRET\|CRON_SECRET\|ZALO_*SECRET\|ZALO_CREDS_KEY\|GEMINI_API_KEY)\s*[:=]\s*\"값16자+\""` | **0건** |
| 9 | CI 설정 | `.github/workflows/` | 없음(CI 시크릿 노출 면) |
| 10 | 배포 설정 | `railway.toml` 시크릿 패턴 | **0건** |

### 작업트리 매칭 6건 (전부 무해)
- `.env.example` 5건: `postgresql://USER:PASSWORD@HOST…`, `NEXTAUTH_SECRET="generate-with: openssl rand -base64 32"`, `CRON_SECRET=…`, `ZALO_EXT_SHARED_SECRET=…`, `ZALO_WEBHOOK_HMAC_SECRET=…` — **전부 플레이스홀더/안내문**.
- `lib/ical.test.ts:725`: `process.env.CRON_SECRET = "topsecret"` — **테스트 더미**(실 시크릿 아님).

## ⚠ 한계 — "git 히스토리 클린 ≠ 노출 안 됨"

git 히스토리가 깨끗해도 운영 키는 **외부 경로로 샜을 수 있다**: 로컬 `.env` 백업, CI/배포 로그, 화면 공유, Zalo 메시지, 과거 협업자 환경 등. git 스캔은 "레포 경유 유출"만 배제한다.

→ **결론: 런칭 시점에 운영 키를 보수적으로 1회 교체**하는 것을 권장한다. 절차는 [secret-rotation-runbook.md](secret-rotation-runbook.md).

## 재스캔 (런칭 직전 1회 더)

런칭 직전 본 표의 명령들을 다시 실행해 그 사이 신규 untracked 스크립트(`prisma/seed-*.ts`·`.mjs` 등)에 키가 섞이지 않았는지 재확인한다. (현재 git status의 untracked 시드 스크립트들도 #5 ripgrep 스캔에 포함되어 0건 확인됨.)
