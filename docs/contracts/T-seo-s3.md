# T-seo-s3 — 가이드 콘텐츠 자동 생성·승인·점진 발행 (SEO 에픽 S3)

> 상위 기획: docs/plans/seo-public-blog.md · 선행 완료: T-seo-s1(PR #358·#359·#362)
> worktree: `.claude/worktrees/seo-blog` / 브랜치 `wt/seo-s3`

## 1. 배경 — 왜 S2보다 먼저인가

실빌라가 2개(공개 0)라 S2(소비자 목록·패싯)를 만들어도 **패싯 페이지가 "3개 미만 미생성" 가드에 전부 걸려 생성되지 않는다.** 즉 지금 S2는 검색 유입을 만들지 못한다.
빌라 수와 무관한 **가이드 콘텐츠가 현 시점의 유일한 유입원**이므로 순서를 바꾼다(기획 §0 치명1의 결론).

## 2. 범위 (In)

| # | 항목 | 산출물 |
|---|---|---|
| A | 스키마 | `SeoArticle` + `SeoArticleStatus`(별도 enum) additive raw SQL |
| B | 도메인 로직 | `lib/seo/article.ts` — 공개 조회·발행 자격·**점진 발행 상한** |
| C | 초안 생성 | `lib/seo/article-draft.ts` — 주제 풀 + Gemini 본문 생성(금칙어 가드 재사용) |
| D | cron | `app/api/cron/seo-draft` — 주 N편 초안 생성 → 승인 대기 + 운영자 알림 |
| E | 발행 cron | `app/api/cron/seo-publish` — 승인분을 **하루 최대 5건** 발행 + IndexNow 핑 |
| F | 공개 페이지 | `/blog` 허브 · `/blog/[slug]` 글 상세 (ko 단일, JSON-LD Article) |
| G | 승인 큐 | admin `/marketing/seo` — 초안 확인·수정·승인·반려 |
| H | sitemap | 발행 글 등재 + **발행 글이 1건 이상일 때만** `/blog` 허브 등재 |

## 3. 범위 밖 (Out)

- 소비자 목록·패싯 페이지·빌라 상세 → **S2**(빌라가 늘어난 뒤)
- GA4·전환추적·CSP 갱신 → S2로 이관
- 다국어(hreflang) → 별건

## 4. 절대 규칙

### 4.1 대량 자동생성 스팸 방지 (기획 §0 치명2)
- **발행은 하루 최대 5건**(초기 4주). `SEO_PUBLISH_PER_DAY` AppSetting으로 조정, 기본 5
- IndexNow 핑도 동일 상한을 공유한다
- **본문 최소 분량 하한 미달이면 발행하지 않는다**(빈약한 글 대량 투입 = 저품질 판정)
- ★ **승인 게이트 필수** — Gemini 창작물을 무검토 발행하지 않는다. 사람 승인이 "대량 자동생성"과 "편집된 콘텐츠"를 가르는 실질 근거다

### 4.2 콘텐츠 안전
- 금칙어·과장광고 가드는 `lib/instagram/content-guide.ts`의 `getBannedTerms()` 재사용
- **허위 통계·최상급 표현 금지**(intro 페이지 선례 동일)
- ★ **가격·공실·주소·공급자 정보 금지** — 글 본문도 T-seo-s1 §4.1 공개 경계를 그대로 승계한다
- 빌라를 언급할 때는 `lib/seo/public-villa.ts` 관문을 경유한 정보만 사용

### 4.3 URL 안정성
`slug`는 발급 후 **불변**(URL = SEO 자산). 제목이 바뀌어도 slug는 유지한다.

### 4.4 i18n
공개 SEO 트리는 **ko 단일**(T-seo-s1 §4.4 예외 선언 승계).

## 5. 수정 금지 구역

`lib/instagram/**`(읽기 전용 재사용만), `lib/youtube/**`, `app/api/cron/instagram-*`, `app/api/cron/youtube-*`, `signing/**`.
공유 파일(`messages/ko.json`·`vi.json`, `PROGRESS.md`)은 **추가만**.

## 6. 완료 기준

1. `GET /blog` → 200, 발행 글 목록 렌더 (0건이면 안내 문구, sitemap 미등재)
2. `GET /blog/{slug}` → 200, 본문·JSON-LD Article·canonical 출력
3. 미발행(DRAFT/PENDING/REJECTED) 글 slug → **404**
4. `sitemap.xml`에 발행 글만 등재, 등재 URL 전수 200
5. `seo-draft` cron: 인증 없으면 401, 실행 시 `PENDING_APPROVAL` 생성 + AuditLog + 운영자 알림
6. `seo-publish` cron: **하루 상한 초과분은 발행하지 않는다**(단위 테스트로 증명)
7. 발행 시 IndexNow 핑 호출, 실패해도 발행 트랜잭션은 성공
8. admin `/marketing/seo` 승인·반려 동작 + AuditLog
9. 공개 렌더 HTML에 금액·공급자·주소 grep **0건**
10. `npm run typecheck` 0 · lint · build · 기존 테스트 회귀 0

## 7. 스키마 (additive raw SQL)

```sql
CREATE TYPE "SeoArticleStatus" AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','PUBLISHED','REJECTED');
CREATE TABLE "SeoArticle" (... slug UNIQUE, title, summary, bodyJson JSONB, topicKey, coverPhotoUrl,
  relatedVillaIds TEXT[], status, approvedAt, publishedAt, lastPingAt, rejectionReason, createdBy, ...);
```
본문은 **블록 JSON**(`{type:'h2'|'p'|'ul', ...}`)으로 저장한다 — 마크다운 렌더러 의존성 추가를 피하고(package.json 동결 원칙) XSS 표면도 만들지 않는다.

## 8. 환경변수 / 설정

```
SEO_DRAFTS_PER_RUN=      # 1회 cron 초안 수 (기본 1)
SEO_PUBLISH_PER_DAY=     # 일 발행 상한 (기본 5) — AppSetting 우선
```
