# T-blog-video-articles — 블로그 개별 영상 글 (category="video")

- 상태: 초안 (QA 합의 전 — 합의 전 코딩 금지)
- 근거: ADR-0049-blog-video-articles.md (설계 정본 — 본 계약과 상충 시 ADR 우선)
- 파이프라인: TDA(본 설계) → BE(S1) → FE(S1 후반) → QA(독립 평가) → PM 보고
- 착수 조건: ADR-0049 §11 열린 질문 3건 테오 답변 (미답 시 권고 기본값: Q1 UPLOADED만·Q2 소급 백필·Q3 상한 공유)

## 1. 범위 (S1 — 단일 스프린트)

### BE (Opus)

1. **카테고리 추가** — `lib/seo/categories.ts`: `SEO_ARTICLE_CATEGORIES`에 `"video"`, 라벨 `{ ko: "영상", vi: "Video" }`.
2. **발행 자격 분기** — `lib/seo/article.ts`: `MIN_VIDEO_ARTICLE_BODY_CHARS = 300` 신설,
   `isArticlePublishable(blocks, category?)` 옵셔널 파라미터 확장(기존 호출부 하위호환).
   video 카테고리 = video 블록 ≥1 + h2 ≥1 + 텍스트 ≥300자. `bodyTextLength`의 영상=0 규칙은 불변.
3. **초안 생성기 신설** — `lib/seo/video-article-draft.ts`:
   - 입력: YoutubeShort(+villa-prep 관문 필드). **Villa.name/nameVi를 타입에서 원천 배제**(DTO 봉인 패턴).
   - 산출: title·summary·bodyJson(p → video → h2 → ul → CTA p, ADR §5 구조)·coverPhotoUrl=posterUrl.
   - copy-guide 주입 필수(6번째 경로) + 금칙어 가드(flaggedTerms, 기존 패턴).
4. **seo-draft ⑤ 브랜치** — `app/api/cron/seo-draft/route.ts`:
   - 선정: `YoutubeShort{status:PUBLISHED, ytVideoId≠null, sourceType:UPLOADED, villaId≠null}`
     중 `SeoArticle{topicKey:"video-"+id}` 미존재분 1건(오래된 publishedAt 순).
   - 생성: `category:"video"`, `topicKey:"video-"+shortId`, `status:PENDING_APPROVAL`, `relatedVillaIds:[villaId]`,
     `createdBy:"cron:seo-draft"` + **AuditLog 기록**(기존 브랜치 패턴 동일).
   - 우선순위: 기존 ①~④ 뒤 ⑤ (한 실행에 전체 브랜치 중 기존 규칙대로).
5. **비디오 사이트맵 확장** — `app/sitemap-video.xml/route.ts`: 기존 빌라 루프 유지 + category="video"
   발행 글 루프 추가(loc=`/blog/[slug]`, player_loc=YT embed, thumbnail_loc=posterUrl→i.ytimg 폴백,
   publication_date=publishedAt). **메인 sitemap.ts·robots.txt는 수정 금지.**

### FE (Opus)

6. **JSON-LD VideoObject** — `app/blog/[slug]/page.tsx`: category="video"일 때 VideoObject 병기
   (name=title·embedUrl=youtube-nocookie·thumbnailUrl·uploadDate·duration ISO8601).
   duration은 bodyJson의 video 블록 원천 쇼츠 durationSec — 조회 불가 시 생략(필드 자체를 빼기, 0 금지).
7. **카테고리 노출 확인** — `/blog/category/video` 목록·뱃지·운영자 승인 큐 필터가 신규 값으로 정상 동작
   (기존 화이트리스트 소비 코드라 대부분 무수정 예상 — 하드코딩 4종 배열이 있으면 정본 import로 교정).
   운영자 화면 신규 문구는 ko+vi 동시([[admin-screens-need-vi-json]]).

### QA (Opus — 독립 평가)

8. 회귀테스트 확장: `tests/public-name-leak.test.ts`(영상 글 경로)·`tests/copy-guide-injection.test.ts`(6번째 경로).
9. 완료 기준 전 항목 검증(§2) + 권한·누수 체크리스트.

## 2. 완료 기준 (테스트 가능)

| # | 기준 | 검증 방법 |
|---|---|---|
| C1 | 조건 충족 쇼츠(PUBLISHED·ytVideoId·UPLOADED·villaId)가 있으면 seo-draft 실행 시 category="video" 글이 PENDING_APPROVAL로 1건 생성 | 크론 수동 호출 → DB 확인. 기발행 실쇼츠 2건이 회차마다 1건씩 백필됨 |
| C2 | 같은 쇼츠로 글이 2번 생성되지 않는다 (topicKey 존재 검사) | 크론 2회 연속 호출 → 동일 topicKey 1행 |
| C3 | VILLA_AUTO·PLACE_AUTO·미업로드(ytVideoId null)·villaId null 쇼츠는 글화되지 않는다 | 각 케이스 시드 후 크론 호출 → 생성 0건 |
| C4 | 승인 → 발행 크론 → PUBLISHED + IndexNow, 일 상한 SEO_PUBLISH_PER_DAY 집계에 포함 | 승인 후 seo-publish 호출 → 상태·lastPingAt·당일 집계 확인 |
| C5 | video 글 발행 자격: video 블록 없거나 텍스트 <300자면 발행 안 됨. 기존 카테고리는 800자 하한 그대로(회귀 0) | isArticlePublishable 유닛테스트 (category 유/무 양쪽) |
| C6 | `/blog/[slug]` 상세에서 9:16 유튜브 임베드 렌더 + VideoObject JSON-LD 유효 | Playwright 렌더 + JSON-LD 파싱 검증 |
| C7 | `/blog/category/video` 목록 200 + 카드 썸네일(posterUrl) 표시, 페이지네이션 서버 skip/take | Playwright |
| C8 | **메인 sitemap.xml에 `video:` 문자열 0건** (네이버 함정), robots.txt 불변 | `curl … \| grep -c "video:"` = 0 · git diff robots 없음 |
| C9 | sitemap-video.xml에 영상 글 `<url>` 등장 + XML 유효 + 기존 빌라 엔트리 회귀 없음 | curl + xmllint(또는 파서) 검증 |
| C10 | **실명 누수 0**: 생성된 title·summary·slug·bodyJson·JSON-LD 어디에도 villa.name/nameVi 미등장. 생성기 입력 타입에 name/nameVi 부재(컴파일 봉인) | tests/public-name-leak.test.ts 확장분 PASS + 산출물 grep |
| C11 | copy-guide 주입 6경로 테스트 PASS | tests/copy-guide-injection.test.ts |
| C12 | publicHidden=true 시 공개 목록·상세·RSS·sitemap-video 전부에서 제외 | 토글 후 4개 표면 확인 |
| C13 | `npm run lint && npm run typecheck && next build` 통과 (배포 빌드 게이트) | CI/로컬 |

## 3. 검증 방법

- QA는 정착 커밋에서 독립 실행(작성자 자기평가 무효). Playwright는 로컬 dev로 충분(공개 페이지 위주),
  발행 파이프라인은 크론 수동 호출(CRON_SECRET) + DB 확인.
- 프로덕션 배포 후 스모크: 메인 sitemap `grep -c "video:"`=0(C8), sitemap-video.xml 200(C9).
- GSC sitemap-video 재제출은 OPS/테오 수동(코드 범위 밖 — 완료 보고에 안내만 포함).

## 4. 수정 금지 구역

| 대상 | 사유 |
|---|---|
| `prisma/schema.prisma` · `prisma/migrations-manual/` | **이 태스크는 스키마 무변경이 계약** — 컬럼이 필요해 보이면 중단하고 TDA 재검토 |
| `app/api/cron/seo-publish/route.ts` 발행 로직 | isArticlePublishable 호출부에 category 인자 전달 1줄 외 불변 |
| `app/sitemap.ts` · `app/robots.ts`(robots.txt) | 네이버 함정 — video: 확장·Sitemap 줄 추가 절대 금지 |
| `components/seo/article-body.tsx` video 렌더러 | 기존 임베드 재사용 — 스타일 변경 금지 |
| YT 업로드·렌더 파이프라인 (`lib/youtube/*` 업로드 경로) | 트리거는 draft 크론 스캔 방식 — 업로드 경로에 훅 넣지 않는다 |
| 타 세션 진행 중 파일 (착수 시 git status 재확인) | 병렬 세션 규칙 |

## 5. 규모·리스크

- 규모: BE 5항목 + FE 2항목 + QA 2항목 = **1스프린트**(수정 ~8파일 + 테스트). 스키마 0.
- 리스크: 낮음 — 신규 공개 표면 없음(기존 블로그 파이프라인 통과), 마이그레이션 없음.
  주의점 2개: ① isArticlePublishable 시그니처 확장의 기존 호출부 회귀(C5) ② 생성 프롬프트 실명 누수(C10).
