# ADR-0049: 공개 블로그(SeoArticle) 완전 다국어화 — ko 캐논 + 4개 언어 번역 테이블 + /[locale]/blog 라우트

- 상태: 승인 (TDA, 2026-07-24)
- 배경: 테오 결정(2026-07-24) — 해외 검색 노출·트래픽 획득. 지원 언어 ko(캐논)·en·vi·ru·zh.
  공개 홈 UI 5개 언어 스위처(pub-locale 쿠키, 060d406e)는 이미 배포됨. 이번 결정은 **콘텐츠(글 본문) 자체의
  언어별 인덱서블 URL** 확보가 목적이다.

## 결정

1. **저장: `SeoArticleTranslation` 별도 테이블** (articleId+locale 유니크, ko 행 금지 — ko는 SeoArticle 본체가 캐논).
   `sourceHash`(캐논 title+summary+bodyJson sha256)로 stale 감지. 행 존재+READY=서빙 가능,
   stale은 재번역 전까지 **기존 번역을 계속 서빙**(없는 것보다 낫다). 적용은 additive raw SQL
   (`prisma/migrations-manual/2026-07-24-seo-article-translation.sql`), migrate dev·db push 금지(기존 규약).
2. **slug는 언어 공통** — 언어별 slug를 만들지 않는다. hreflang 매핑이 자명해지고 "slug 불변" 규약이 유지된다.
3. **URL: `app/[locale]/blog/**` 명시 라우트 트리** — ko는 프리픽스 없이 기존 `/blog` 유지, en/vi/ru/zh만
   `/{locale}/blog/...`. 기존 page 본체를 공용 서버 컴포넌트로 추출해 양쪽 thin wrapper가 호출.
   `/ko/blog/*`는 `/blog/*`로 301. 미들웨어 rewrite 방식은 기각(로케일이 헤더로 암묵 전달되어 metadata·디버깅
   결합도가 나쁘고, 미들웨어가 이미 auth/DDoS/RBAC로 밀도가 높음).
4. **번역 생성: 별도 cron(drip)** — 발행 cron에 인라인하지 않는다. **텍스트 필드만 Gemini에 보내고 구조는
   로컬 재조립**(img url·ytVideoId는 프롬프트에 아예 넣지 않아 변조가 구조적으로 불가능). 산출물은
   parseArticleBody 재검증 + 실명·금액 누수 가드 통과 시에만 저장. 재번역은 sourceHash 불일치 시에만.
5. **폴백: 번역 없으면 해당 언어 글 URL은 404** — ko 본문을 /en URL에 내보내지 않는다(중복 콘텐츠·클로킹 위험).
   비-ko 목록 페이지는 READY 번역이 있는 글만 나열. 스위처는 번역 없는 언어를 그 언어 허브로 보낸다.
6. **hreflang은 페이지 메타로만, sitemap은 plain 엔트리로만** — sitemap xhtml:link 확장은 넣지 않는다.
   근거: 네이버 서치어드바이저가 표준 외 확장(video:)을 파싱 거부한 실측 선례. 구글은 페이지 레벨
   hreflang 한 채널이면 충분하다. hreflang 세트는 단일 헬퍼에서 생성해 상호 대칭을 보장한다.
7. **쿠키(pub-locale)와의 관계**: 블로그의 콘텐츠 언어 진실원천은 **URL**이다(크롤러는 쿠키가 없다).
   쿠키는 홈 등 쿠키-렌더 페이지의 UI 선호로만 남는다. 쿠키 기반 /blog 자동 리다이렉트는 하지 않는다.
8. **thumbnailUrl(텍스트 구운 썸네일)은 언어별 재생성하지 않는다(Phase 1)** — 한국어 텍스트 썸네일은
   카톡/국내 SNS CTR 장치이고, 해외 SERP에는 og:image가 노출되지 않는다. satori에 키릴·간체 폰트 추가라는
   별도 작업 비용 대비 효과가 0에 가깝다. 비-ko 페이지 og:image는 coverPhotoUrl(무텍스트) 폴백.
9. **범위 분할**: Phase 1 = 글(article)+허브+카테고리. Phase 2 = 빌라/패싯 페이지(사전 기반, Gemini 불요).
   Phase 3(선택) = 언어별 썸네일·빌라 소개문 번역·홈 URL 로케일화·RSS 언어별.

## 결과

- 공개 경계(가격·주소·실명 금지)는 번역 파이프라인에서도 유지된다: 입력이 이미 경계 통과분이고,
  출력에 누수 가드(실명·통화 패턴 스캔)를 추가로 건다.
- 기존 ko URL·sitemap 엔트리는 변화 0(추가만) — 축적된 SEO 자산 보존.
- blogPaths는 trailing optional locale 인자(기본 "ko")로 확장 — 기존 호출부 전부 무수정 호환.
