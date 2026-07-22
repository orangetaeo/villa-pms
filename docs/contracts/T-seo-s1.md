# T-seo-s1 — 공개 콘텐츠 기반 + 검색 색인 인프라 (SEO 에픽 S1)

> 상위 기획: docs/plans/seo-public-blog.md (§0 재검토 결과 = 헌법)
> worktree: `.claude/worktrees/seo-blog` / 브랜치 `worktree-seo-blog`
> 선행: S0(DESIGN Stitch 3화면) — **UI 구현은 S0 export 이후**. 본 계약의 디자인 비의존 항목은 선행 가능

## 1. 배경·목적

네이버 블로그 글쓰기 API는 2020-05-06 종료, 클립은 업로드 API 부재. **자사 도메인에 콘텐츠를 두고 검색엔진에 자동 색인 요청**하는 것이 유일한 완전 자동 경로다. S1은 그 토대 — 크롤러가 들어올 수 있는 공개 표면과 색인 파이프라인을 만든다.

**현재 블로커**: `app/page.tsx`가 비로그인 방문자를 `/logout`으로 리다이렉트한다. villa-go.net 루트에 공개 홈이 없어 어느 검색엔진에 등록해도 첫 페이지에서 튕긴다. `sitemap.ts`·`robots.ts`도 부재.

## 2. 범위 (In)

| # | 항목 | 산출물 |
|---|---|---|
| A | 공개 직렬화 봉인 | `lib/seo/public-villa.ts` — Prisma select 화이트리스트 + 반환 타입 봉인 |
| B | 누수 테스트 | `tests/seo-leak.test.ts` — 금지 키 검출 시 실패 |
| C | robots | `app/robots.ts` — 공개 트리 allow, 비공개 전부 disallow |
| D | sitemap | `app/sitemap.ts` — DB 기반 동적(공개 대상만) |
| E | RSS | `app/feed.xml/route.ts` |
| F | IndexNow | `lib/seo/indexnow.ts` + 키 파일 라우트 — 네이버·Bing 동시 핑, **일 상한 5** |
| G | 소유확인 메타 | 네이버·구글·Bing 3종 env → 루트 layout 주입 |
| H | 공개 홈 | `/` 비로그인 = 공개 홈, **세션 있으면 기존 role 분기 100% 보존** |
| I | PWA 분리 | `manifest.ts` `start_url` → `/login` (공급자 설치 경험 보존) |
| J | 스플래시 제외 | `SPLASH_GATE`에 공개 트리 경로 추가 |
| K | Villa 공개 토글 | `publicSlug`·`publicListed`·`publicListedAt` additive + admin 토글 + AuditLog |

## 3. 범위 밖 (Out) — 다른 스프린트

- 가이드 글 자동생성·승인 큐·점진 발행 큐 → **S2**
- 빌라 상세/지역 허브/테마 조합 페이지 UI, JSON-LD, GA4·전환추적·CSP 갱신 → **S3**
- 네이버 검색광고 API·커머스 API → 별도 에픽

## 4. 절대 규칙 (위반 시 롤백)

### 4.1 공개 경계 — 기획서 §2 승계
공개 허용: 빌라명·단지명·침실/욕실/최대인원·수영장/조식·해변거리·면적·층수·체크인아웃 시각·이용규칙·주차·VillaFeature·승인 사진/클립·소개문.
**절대 금지**: 판매가·원가·마진·`baseDepositVnd`·`monthlyRentVnd` / 날짜별 공실·캘린더 / 상세주소·좌표 / 공급자 정보 / `accessType`·`accessInfo`·`wifiSsid`·`wifiPassword` / 미승인 사진·클립.
> ★ 근거: 공급자는 자기 원가를 알므로 **공개 판매가 = 마진 역산**(원칙 2). 가격은 시작가·범위 포함 어떤 형태로도 넣지 않는다.

### 4.2 노출 정책 — 테오 결정 2026-07-22
- `publicListed` 기본 **false**. 켠 빌라만 페이지·sitemap 등재
- **전체 빌라 목록/필터 페이지를 만들지 않는다**

### 4.3 robots 분기
- disallow: `/api`, `/admin`, `/dashboard`, `/villas`(운영자), `/my-villas`, `/cleaning`, `/p/`, `/g/`, `/webchat`, `/partner`, `/vendor`, `/settings`, `/login`, `/logout`, `/chat`
- **`/card/` = noindex** (개인 실명·연락처 공개 SSG)
- `intro.html`·`intro-vendor.html`·`intro-partner.html` = allow (모집 검색 유입 이득)
- ★ 제안링크 토큰(`/p/`)·게스트링크(`/g/`)는 robots + `noindex` 메타 **이중 차단**

### 4.4 i18n 예외 선언
공개 SEO 트리는 **ko 단일**로 한다. 타깃이 네이버·다음·구글 한국어 검색이며 vi 병행은 중복 콘텐츠 리스크만 만든다. 프로젝트 규칙 "모든 페이지 vi 필수"의 명시적 예외로 선언한다(다국어 확장은 hreflang과 함께 별건).

### 4.5 회귀 금지
- 세션 보유 사용자의 role 분기(OWNER/MANAGER/STAFF→`/dashboard`, CLEANER→`/cleaning`, VENDOR→`/vendor`, PARTNER→`/partner`, SUPPLIER→`/my-villas`)는 **현행 동작 100% 보존**. 과거 무한 리다이렉트 루프 전력 있음
- PWA 설치 사용자(standalone) 진입 경험 퇴행 금지

## 5. 수정 금지 구역 (다른 세션 영역)

`lib/instagram/**`, `lib/youtube/**`, `app/api/cron/instagram-*`, `app/api/cron/youtube-*`, `signing/**`, `prisma/schema.prisma`의 마케팅·계약 모델 영역. 공유 파일(`messages/ko.json`, `app/globals.css`)은 **추가만**.

## 6. 완료 기준 (테스트 가능)

1. 비로그인 `GET /` → **200** (리다이렉트 0), 공개 홈 콘텐츠 렌더
2. 로그인 5개 role 각각 → 기존 목적지로 리다이렉트 (회귀 0)
3. `GET /robots.txt` → 200, §4.3 규칙 그대로 출력
4. `GET /sitemap.xml` → 200, **`publicListed=true` 빌라만** 포함. false 빌라 URL 0건
5. `GET /feed.xml` → 200, 유효 RSS
6. `GET /{indexnow-key}.txt` → 200, 키 문자열 일치
7. `lib/seo/public-villa.ts` 직렬화 결과에 금지 키 0 — `tests/seo-leak.test.ts` 통과
8. 렌더된 공개 HTML 소스에 금액 숫자·공급자명·주소 grep **0건**
9. 소유확인 메타 3종이 env 설정 시 `<head>`에 출력, 미설정 시 미출력
10. `manifest.json` `start_url` = `/login`, PWA standalone 진입 시 기존 경험 유지
11. 공개 트리 경로에서 스플래시 오버레이 미표시
12. `publicListed` 토글 시 AuditLog 기록
13. `npm run typecheck` 0 · `npm run lint` 통과 · `npm run build` 성공 · 기존 vitest 전량 통과

## 7. 검증 방법

- 유닛: vitest (누수 테스트·robots/sitemap 생성 함수)
- 실브라우저: 로컬 dev 서버에서 비로그인/각 role 진입 실측 + 공개 HTML 소스 grep
- 빌드 게이트: 푸시 전 `next build` 필수([[deploy-build-gate]])
- ★ **QA는 작성자와 분리** — 본 계약 구현자의 자기평가는 무효. 독립 QA 세션에서 §6 전 항목 재검증 후 병합

## 8. 스키마 (additive raw SQL — `prisma db push` 금지)

```sql
ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "publicSlug" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Villa_publicSlug_key" ON "Villa"("publicSlug");
ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "publicListed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "publicListedAt" TIMESTAMP(3);
```
`prisma/migrations-manual/2026-07-22-seo-public.sql`로 보존. TDA 검토 후 라이브 적용, 적용 후 `npx prisma generate`.

## 9. 환경변수 (신규)

```
NAVER_SITE_VERIFICATION=     # 서치어드바이저 소유확인
GOOGLE_SITE_VERIFICATION=    # Search Console
BING_SITE_VERIFICATION=      # msvalidate.01
INDEXNOW_KEY=                # 32자 이상 hex — 코드 생성, public 키파일로 서빙
SEO_PUBLIC_BASE_URL=         # 기본 https://villa-go.net
```

## 10. 테오 액션 (S1 배포 후)

1. 네이버 서치어드바이저 등록 → 소유확인 → 사이트맵·RSS 제출
2. Google Search Console 등록 → 사이트맵 제출
3. Bing Webmaster (Search Console에서 import)
4. 다음 검색등록 신청(수동 1회, 심사)
