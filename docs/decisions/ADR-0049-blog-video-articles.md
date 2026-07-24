# ADR-0049: 블로그 개별 영상 글(standalone video post) — category="video"

- 상태: 제안 (TDA 설계 확정, 테오 열린 질문 3건 답변 대기 — §8)
- 날짜: 2026-07-24
- 작성: TDA
- 관련: T-seo-s3(블록 파이프라인)·T-seo-category(카테고리)·T-seo-media(비디오 사이트맵 분리)·PR #440(공개 실명 금지)·marketing-content-lifecycle-rules

## 1. 문제

빌라 등록 영상 → IG 릴스·YT 쇼츠 자동 생성 파이프라인은 가동 중이나, 그 영상이 **우리 도메인 블로그에
개별 영상 글로 등록되는 경로가 없다.** 현재는 빌라 글 하단에 `villa.videos[0]` 임베드 1회가 전부.

사업 근거(테오 확정):
- 영상 트래픽을 유튜브·인스타로만 흘리지 않고 우리 사이트에 체류시킨다(이탈 방지)
- 영상 SEO 노출 추가 확보 (구글 비디오 검색·비디오 사이트맵)
- 이미 만든 영상 자산의 재활용 — 쇼츠 1건 = 글 1건

## 2. 결정 (요약)

| 축 | 결정 |
|---|---|
| 데이터 모델 | **A안: SeoArticle 재사용 + category="video"** — 신규 모델 없음, **DB 마이그레이션 0건** |
| 원천 | `YoutubeShort` (status=PUBLISHED · ytVideoId≠null · sourceType=**UPLOADED** · villaId≠null) |
| 생성 트리거 | **seo-draft cron ⑤ 브랜치** (빌라①→서비스②→장소③→가이드④→**영상⑤**), PENDING_APPROVAL |
| 중복 방지 | topicKey = `video-<youtubeShortId>` (기존 topicKey 중복 방지 축 그대로) |
| 플레이어 | **유튜브 임베드** — 기존 `video` 블록(`ytVideoId`) + 기존 렌더러 재사용. R2 mp4 자체호스팅 기각 |
| 발행 자격 | 카테고리별 분량 하한 도입 — video는 **300자 + video 블록 1개 필수** (800자 일괄 하한의 예외) |
| 사이트맵 | 메인 sitemap = plain URL만(video: 확장 **절대 금지**, 네이버 함정). 기존 `sitemap-video.xml`에 영상 글 루프 추가 |
| 프라이버시 | title·summary·slug·JSON-LD 전부 `publicVillaLabel()` 경유. 실명·정확위치 금지. 회귀테스트 2종 확장 |
| 중복 노출 | 빌라 글 하단 임베드 + 개별 영상 글 **병존 허용(의도)** — §7 |

## 3. 데이터 모델: A안 vs B안

### A안 (채택): SeoArticle + category="video"

- `SeoArticle.category`는 **String + 코드 화이트리스트**(`lib/seo/categories.ts`, enum 아님 — ALTER TYPE 회피가
  설계 의도였고 이번이 바로 그 케이스). `SEO_ARTICLE_CATEGORIES`에 `"video"` 1줄 추가로 끝.
- **prisma/schema.prisma 변경 없음, raw SQL 없음.** `prisma/migrations-manual/`에 넣을 것이 없다.
- 승인 큐(PENDING_APPROVAL)·점진 발행(SEO_PUBLISH_PER_DAY)·IndexNow·publicHidden·금칙어 가드·
  `/blog/[slug]` 렌더·`/blog/category/[cat]` 목록·RSS — **전부 기존 파이프라인 그대로 통과.**
- 본문 `video` 블록 타입과 9:16 임베드 렌더러(`components/seo/article-body.tsx`)가 **이미 구현돼 있다**
  (parseArticleBody의 `isValidYtVideoId` 검증 포함). 신규 블록 타입 불필요.
- coverPhotoUrl = `YoutubeShort.posterUrl`(R2 = `isAllowedImageUrl` 통과) → 없으면 satori 썸네일 폴백.

### B안 (기각): YoutubeShort를 원천으로 새 공개 표면(/videos 등)

- 승인·발행·drip·publicHidden·IndexNow·RSS·카테고리 목록·썸네일을 **전부 재구현**해야 한다.
- YoutubeShort.title/description은 유튜브용 산출물이지 우리 도메인 SEO 문서가 아니다 — 결국 글 필드를
  덧대게 되고 SeoArticle의 열화 복제가 된다.
- 공개 경계가 하나 늘어난다(실명 누수·가격 누수 감사 표면 증가). 기각.

### 역참조 설계 — YoutubeShort.seoArticleId를 쓰지 않는 이유

기존 `YoutubeShort.seoArticleId`는 **"이 글을 소재로 만든 쇼츠"**(글→쇼츠 방향, 장소 글 도배 방지 축)다.
영상 글은 방향이 반대(쇼츠→글)라 이 FK를 재사용하면 의미가 충돌하고 기존 "한 글당 쇼츠 1개" 판정을
오염시킨다. → 역참조는 **topicKey `video-<youtubeShortId>`** 로만 유지(FK 없음). relatedVillaIds가 이미
FK-less + 렌더 관문 패턴의 선례. 원천 조회가 필요하면 topicKey에서 id를 잘라 조회한다(생성·감사 시점만).

## 4. 생성 트리거: seo-draft ⑤ 브랜치 (인라인 훅 기각)

**후보 비교**

| 후보 | 판정 |
|---|---|
| (a) YT 업로드 성공 시 인라인 생성 | 기각 — 업로드 크론에 글 생성 실패 경로가 끼면 업로드 트랜잭션이 지저분해지고, 크래시 시 고아·누락을 별도 리퍼로 메꿔야 함([[publishing-orphan-reaper]] 교훈). 생성 경로 이원화는 장소 글에서 이미 사고 낸 패턴("cron 자체 구현 → 개선 한쪽만 반영") |
| (b) seo-draft ⑤ 브랜치 스캔 | **채택** — 멱등(topicKey 존재 검사)·배치·기존 우선순위 파이프라인 준수·**기발행 쇼츠 2건 자동 백필**·실패해도 다음 실행이 회수 |
| (c) 빌라 영상 등록 시점 | 기각 — ytVideoId가 아직 없어 임베드 불가. 승인·업로드 전 영상을 글화하면 반려 시 글 고아 발생 |

**⑤ 브랜치 선정 조건** (모두 AND):

```
YoutubeShort WHERE
  status = PUBLISHED
  AND ytVideoId IS NOT NULL          -- 임베드 가능 조건 (이게 곧 트리거의 본질)
  AND sourceType = UPLOADED          -- 실촬영 투어만. §8 Q1
  AND villaId IS NOT NULL            -- 공개 빌라 관문(getPublicVillas) 통과 빌라만
  AND NOT EXISTS SeoArticle(topicKey = 'video-' || YoutubeShort.id
                            AND status NOT IN (REJECTED))   -- 취소·반려분 슬롯 해방
```

- 실행당 1건 생성(기존 브랜치들과 동일한 절제 — scaled content abuse 방지 기조).
- `status NOT IN (REJECTED)` 제외 조건 = [[cancelled-content-must-free-slot]] 교훈 선반영. 단 반려가
  "이 영상은 글화하지 말 것" 의사표시일 수 있으므로 **반려 후 재생성은 하지 않는 게 기본** —
  구현은 `NOT EXISTS(topicKey=...)` 단순 존재 검사로 하고(반려분도 존재로 침), 주석으로 명시한다.
  재생성 원하면 운영자가 반려 글을 하드 삭제(기존 규칙상 DRAFT·REJECTED는 삭제 가능).
- VILLA_AUTO(사진 슬라이드쇼)·PLACE_AUTO 제외 근거: 슬라이드쇼는 얇은 콘텐츠(실촬영 대비 체류 가치 낮음),
  PLACE_AUTO는 이미 장소 글에 연결돼 있어 글화하면 같은 소재 이중 문서.
- IG 릴스는 원천으로 삼지 않는다 — 릴스 임베드는 외부 스크립트(CSP 위반 + 추적)이며, 동일 콘텐츠가
  YoutubeShort로 크로스포스팅되므로 YT 쪽만 글화하면 손실이 없다.

## 5. 본문 구성·플레이어·발행 자격

### 플레이어: 유튜브 임베드 (R2 mp4 자체호스팅 기각)

- 기존 `video` 블록 + `article-body.tsx` 9:16 youtube-nocookie 임베드(lazy)를 그대로 쓴다. **코드 0줄.**
- R2 mp4 기각 근거: ① 대역폭 종량 비용 + `<video>` 플레이어(포스터·컨트롤·모바일 자동재생 정책) 신규 구현
  ② 구글 비디오 SEO는 `video:player_loc`(YT embed)로 충분히 인정 ③ YT 임베드 시청은 채널 성장(구독·알고리즘)
  에도 기여 — 영상 자산이 두 곳에서 일하게 된다. 체류는 임베드 재생으로도 우리 페이지에서 일어난다.

### 본문 구조 (Gemini 생성, PENDING_APPROVAL)

```
[p]     도입 — 이 영상이 보여주는 것 (publicVillaLabel 기반, 2~3문장)
[video] ytVideoId + title (쇼츠 제목 재사용 — PR #440으로 이미 실명 무결)
[h2]    영상 하이라이트
[ul]    공간별 볼거리 3~5개 (VillaClip.space·쇼츠 컷 정보 기반)
[p]     마무리 + 카카오 상담 CTA (기존 글 CTA 패턴 재사용)
```

- 생성 프롬프트는 **villa-prep 관문 필드만** 입력으로 받는다(name/nameVi 원천 차단, DTO 봉인 패턴).
- 카피 규칙: [[copy-guide-must-inject-all-paths]] — 새 생성 경로이므로 copy-guide 주입 **6번째 경로**로 등록,
  `tests/copy-guide-injection.test.ts` 확장 필수.

### 발행 자격 — 카테고리별 하한 (핵심 설계 변경점)

현행 `isArticlePublishable`은 800자 일괄 하한 + 영상은 분량 0으로 센다 → 영상 글은 구조상 발행 불가.
800자를 채우려 억지 텍스트를 생성하는 것이 오히려 스팸 시그널(영상 페이지의 정상 형태는 짧은 텍스트).

```ts
// lib/seo/article.ts
export const MIN_ARTICLE_BODY_CHARS = 800;            // 기존 (텍스트 글)
export const MIN_VIDEO_ARTICLE_BODY_CHARS = 300;      // 신설 (영상 글)

export function isArticlePublishable(blocks: ArticleBlock[], category?: SeoArticleCategory): boolean {
  if (category === "video") {
    // 영상 글: 영상 블록 1개 필수 + 최소 소개 텍스트 300자
    if (!blocks.some((b) => b.type === "video")) return false;
    return bodyTextLength(blocks) >= MIN_VIDEO_ARTICLE_BODY_CHARS && blocks.some((b) => b.type === "h2");
  }
  if (bodyTextLength(blocks) < MIN_ARTICLE_BODY_CHARS) return false;
  return blocks.some((b) => b.type === "h2");
}
```

- category 파라미터는 **옵셔널(기존 호출부 무수정 하위호환)**. seo-publish의 호출부만 category를 넘기도록 수정.
- "미디어 도배로 하한 우회 방지"(bodyTextLength가 영상=0으로 세는 규칙)는 그대로 유지 — video 카테고리도
  텍스트 300자는 텍스트로만 채워야 한다.

## 6. 공개 렌더·목록·썸네일·사이트맵·구조화 데이터

- `lib/seo/categories.ts`: `"video"` 추가 + 라벨 `{ ko: "영상", vi: "Video" }`. `/blog/category/video`는
  기존 `isSeoArticleCategory` 검증 라우트가 자동 수용.
- 썸네일: coverPhotoUrl = `posterUrl`(R2) → 목록 카드는 기존 `thumbnailUrl ?? coverPhotoUrl` 규칙 그대로.
  satori 텍스트 썸네일 파이프라인도 기존 경로 재사용([[satori-korean-orphan-headline-wrap]] 주의).
- JSON-LD: 영상 글 상세에 `VideoObject` 추가 — `name`(publicLabel 기반 제목)·`embedUrl`
  (youtube-nocookie)·`thumbnailUrl`·`uploadDate`(publishedAt)·`duration`(durationSec→ISO8601).
  기존 Article JSON-LD와 병기.

### 사이트맵 (★네이버 함정 — [[naver-sitemap-rejects-video-extension]] 준수)

| 표면 | 처리 |
|---|---|
| 메인 `app/sitemap.ts` | 영상 글 URL은 **plain `<url>`로 자동 포함**(발행 글 일괄). `video:` 확장 **추가 금지** |
| `app/sitemap-video.xml/route.ts` | **기존 파일 확장** — 현행 빌라 페이지 루프에 더해, category="video" 발행 글 루프 추가(`loc=/blog/[slug]`, `player_loc=YT embed`, `thumbnail_loc=posterUrl 또는 i.ytimg`). 구글 GSC 수동 제출 전용 유지 |
| robots.txt | **불변** — Sitemap: 줄에 sitemap-video.xml 넣지 않는다 (기존 주석 규약 유지) |

검증: 배포 후 메인 sitemap `grep -c "video:"` = **0** (QA 하드 체크).

## 7. 중복 노출 정책 — 병존 허용 (의도)

같은 영상이 (기존) 빌라 글 하단 임베드 + (신규) 개별 영상 글 양쪽에 나온다. **허용하고 의도로 명시한다.**

- 검색 의도가 다르다: 빌라 글 = 정보 탐색(800자+ 텍스트), 영상 글 = 시청 의도. 본문 텍스트가 상이해
  중복 콘텐츠 패널티 대상이 아니다(같은 건 iframe src뿐).
- 사이트맵도 분리돼 있다: 빌라 페이지의 video 엔트리는 기존 루프, 영상 글은 신규 루프 — 같은 ytVideoId가
  두 `<url>`에 나오는 것은 구글 규격상 문제 없음(페이지 단위 선언).
- 내부 링크: 영상 글 → 해당 빌라 글(relatedVillaIds 기존 렌더), 빌라 글 쪽은 현행 유지(추후 IDEAS).

## 8. 라이프사이클

- **비노출**: 기존 `publicHidden` 그대로 (공개 조회 2곳 게이트, 상태 전이 없음).
- **원천 쇼츠 삭제**: 기존 규칙상 PUBLISHING·PUBLISHED 쇼츠는 하드 삭제 금지(marketing-content-lifecycle-rules)
  → 발행된 영상 글의 원천이 DB에서 사라지는 경로는 없다. 글은 어차피 ytVideoId 문자열만 들고 있어(FK 없음)
  쇼츠 행 삭제와 렌더가 결합돼 있지 않다.
- **유튜브에서 외부 삭제·비공개 전환**: 임베드가 깨진다 → 운영자가 해당 글 publicHidden 처리(수동 운영 절차,
  승인 큐 화면에서 접근 가능). 자동 감지는 IDEAS(YT videos.list 성과 크론이 이미 돌고 있어 확장 후보).
- **빌라 삭제**: `YoutubeShort.villaId` SetNull(기존) + 글 relatedVillaIds는 렌더 관문이 걸러냄(기존 패턴).
  글 자체는 유지 — 영상이 유튜브에 살아있는 한 콘텐츠 가치가 있다. 필요 시 publicHidden.
- **영상 글 삭제**: 기존 규칙 동일 — DRAFT·PENDING·REJECTED는 하드 삭제 가능, PUBLISHED는 publicHidden만.

## 9. 프라이버시 (사업원칙 1 — 공개 실명 금지)

적용 지점 전수:

| 표면 | 규칙 |
|---|---|
| title·h1·summary | Gemini 프롬프트 입력을 villa-prep 관문 필드로 한정(name/nameVi 부재) + publicVillaLabel 표시명 |
| slug | `buildArticleSlug('video-<shortId>')` — 실명·단지 정밀명 미포함(topicKey가 id 기반이라 구조적으로 안전) |
| video 블록 title | `YoutubeShort.title` 재사용 — PR #440에서 이미 실명 무결 보장된 산출물 |
| JSON-LD VideoObject.name | 글 title 재사용(위 규칙 승계) |
| sitemap-video 신규 루프 | title·description = 글 title·summary (승계) |
| 위치 | 영상 글에 지도 블록 없음. 본문에 주소·정확위치 금지(기존 공개 경계 §4.1 승계) |

회귀테스트 확장 2종 (QA 게이트):
- `tests/public-name-leak.test.ts` — 영상 글 생성 경로(프롬프트 입력 타입·산출 title/summary/slug) 커버 추가
- `tests/copy-guide-injection.test.ts` — 신규 생성 프롬프트를 주입 경로 목록에 추가

## 10. 마이그레이션

**없음.** category는 String(화이트리스트 정본 = 코드), 신규 컬럼·모델·enum 없음.
`prisma/migrations-manual/` 추가 파일 0건. `npx prisma generate` 불필요(스키마 무변경).
— A안의 최대 근거이며, 이 ADR의 스키마 관련 리스크는 0이다.

## 11. 열린 질문 (테오 판단 필요)

| # | 질문 | TDA 권고 기본값 |
|---|---|---|
| Q1 | VILLA_AUTO 사진 슬라이드쇼 쇼츠도 글화할까? | **제외** — 실촬영(UPLOADED)만. 슬라이드쇼는 얇은 콘텐츠로 도메인 신뢰도에 역효과 |
| Q2 | 기발행 실촬영 쇼츠 2건(88초·43초) 소급 글화? | **예** — ⑤ 브랜치가 조건 충족분을 자동 백필(별도 작업 불필요) |
| Q3 | 영상 글도 SEO_PUBLISH_PER_DAY(일 5건) 상한 공유? | **공유** — 별도 상한 불필요. 어차피 실행당 1건 생성이라 유량이 작다 |

답변 없으면 권고 기본값으로 진행한다(확인 질문 최소화 규칙).

## 12. 결과

- 구현 규모: 1스프린트(계약서 T-blog-video-articles.md). 스키마 0·신규 모델 0·신규 블록 타입 0.
- 수정 파일 예상 ~8개: categories.ts(+1값·라벨)·article.ts(publishable 분기)·seo-draft cron(⑤)·
  영상 글 초안 생성기(신규 lib/seo/video-article-draft.ts)·sitemap-video.xml(루프 추가)·
  블로그 상세(JSON-LD VideoObject)·테스트 2종 확장.
