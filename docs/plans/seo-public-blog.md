# 기획서 — villa-go.net 공개 콘텐츠 + 검색 자동노출 (`/blog` 에픽)

> 작성 2026-07-22 · 상태: **기획(미착수)** · 후속: docs/contracts/T-seo-* 스프린트 계약 3건
> 배경: 네이버 블로그 글쓰기 API는 2020-05-06 종료(사유 = API 대량 발행 어뷰징 차단), 클립은 개발자 업로드 API 부재.
> 카페·밴드 API는 존재하나 도달이 폐쇄형. → **자사 도메인에 콘텐츠를 자동 생성하고 검색엔진에 자동 색인 요청**하는 것이 유일한 완전 자동 경로.

## 0. ★재검토 결과 (2026-07-22, 착수 직전 자기검토) — 아래 항목이 §1~§12를 덮어쓴다

기획서 작성 후 코드베이스·운영현황 재실사에서 **치명 결함 3 + 누락 4**를 발견했다. 착수 전 반드시 반영한다.

### 치명 1 — 규모 전제가 현실과 다르다 (빌라 ≈ 2개)

§1의 "빌라 100개 → 300페이지"는 **시드 데이터 시절(빌라 65개)의 감각**이다. 2026-07-15 실전 와이프로 테스트 38,308행이 삭제됐고, PROGRESS 2026-07-21 기록은 "**첫 빌라 2개 등록** 후 홍보 자동생성 점검"이다. 현재 실빌라는 2~5개로 추정된다(DB 실측은 연결 타임아웃, **테오 확인 필요**).

이 전제로 §4를 그대로 실행하면:
- 빌라 상세 2~5, 지역 허브 1~2, **테마 조합은 "3개 미만 미생성" 가드에 전부 걸려 0개**, 가이드 0
- → 총 공개 페이지 **5개 미만**. 신규 도메인 + 5페이지는 검색엔진이 사실상 무시한다.

**결론: 빌라 데이터에 의존하지 않는 가이드 콘텐츠(`/blog`)가 초기 주력이어야 한다.** §9 스프린트 순서를 뒤집는다(S3 → S1). 빌라·지역·조합 페이지는 "빌라가 늘면 자동으로 늘어나는 구조"로 깔아두되, 초기 유입 기대치는 가이드 글에 둔다.

### 치명 2 — 자동생성 대량 발행 = 스팸 정책 정면 (신규 도메인)

구글은 2024년 3월 **scaled content abuse**(대량 자동생성 콘텐츠) 정책을 명문화했고, 네이버도 유사 어뷰징 필터를 운영한다(애초에 블로그 API를 닫은 이유가 이것). **신뢰도 0의 신규 도메인에서 자동생성 페이지 수백 개를 일괄 발행 + IndexNow 일괄 핑**은 전형적인 스팸 시그널이다. §5는 "빨리 많이 넣는" 설계인데, 이건 위험 방향이다.

**대응 (필수 반영)**
- **점진 발행(drip)**: 신규 페이지는 **하루 최대 5개**(초기 4주), 이후 하루 10개로 완화. `publishedAt` 예약 발행 큐로 제어
- **IndexNow 핑도 동일 상한**. 일괄 폭탄 금지
- 페이지당 **최소 실질 콘텐츠 분량 하한**(빌라 상세 = 사진 8장 + 본문 600자 이상, 미달 시 발행 보류)
- 가이드 글은 사람 승인 게이트 유지(§6) — 이게 "대량 자동생성"과 "편집된 콘텐츠"를 가르는 실질 근거가 된다

### 치명 3 — PWA `start_url` 충돌 (공개 홈이 공급자 앱의 첫 화면을 뺏는다)

[app/manifest.ts](../../app/manifest.ts)의 `start_url: "/"`, `scope: "/"` 이고 주석에 **"설치 경험 기준은 공급자"** 라고 명시돼 있다. 루트를 공개 마케팅 홈으로 바꾸면 **비로그인 상태의 공급자가 PWA를 열었을 때 로그인 대신 마케팅 홈을 보게 된다** — 베트남 공급자 UX 퇴행이고, 이 프로젝트는 과거 PWA 변경으로 반복 파손된 이력이 있다([[ios-pwa-splash-and-statusbar-install-cache]]).

**대응**: `start_url`을 `/login`(또는 `/app`)으로 분리하고, 루트 공개 홈은 **세션 있으면 기존 role 분기 100% 보존**. PWA standalone 감지 분기까지 포함해 실기기 검증을 완료 기준에 넣는다. 과거 무한 리다이렉트 루프 전력이 있으므로 회귀 테스트 필수.

### 누락 1 — Stitch 디자인 선행 규칙

공개 홈·빌라 상세·`/blog` 전부 **신규 UI**인데 기획서에 디자인 단계가 없다. 프로젝트 규칙은 "UI는 `design/stitch/` export 변환, 없으면 디자인 먼저"([[stitch-design-first-rule]], docs/DESIGN.md). **DESIGN 에이전트 선행 → 화면 3종 export → 변환** 단계를 S1 앞에 추가하고, 일정을 +1.5일 한다.

### 누락 2 — 스플래시 게이트 제외 목록에 공개 트리가 없다

[app/layout.tsx](../../app/layout.tsx)의 `SPLASH_GATE` 실제 제외 경로는 `/p/`·`/g/`·`/webchat`·`/chat`·`/privacy`·`/card` **뿐이다. 루트 `/` 는 제외 대상이 아니다.** 공개 홈·`/villas`·`/blog`·`/areas`·`/collections`를 제외 목록에 추가해야 한다. 구글은 렌더링을 수행하므로 전면 오버레이가 콘텐츠를 가리면 인터스티셜 이슈가 될 수 있다.

### 누락 3 — i18n "모든 페이지 vi 필수" 규칙과 충돌

프로젝트 규칙은 [[all-pages-vietnamese-required]](하드코딩 한국어 금지, ko+vi 동시)인데, 공개 SEO 페이지의 타깃은 **네이버·다음·구글 한국어 검색**이다. vi 병행은 SEO상 이득이 없고 중복 콘텐츠 리스크만 만든다.
**결정: 공개 SEO 트리는 `ko` 단일로 하되, 규칙 예외를 계약서에 명시 선언한다.** (다국어 확장은 hreflang과 함께 별건 — 러·중·영 타깃은 `/partner` 소개 자산이 이미 6개 언어로 존재)

### 누락 4 — robots 정책 미결 항목

`/card/{taeo,dokyung,taejin}` 명함 페이지는 **개인 실명·연락처가 있는 공개 SSG**다. 검색 색인 허용 여부는 개인정보 판단이 필요하다 → **기본 `noindex` 권장**(명함은 QR·링크로 직접 전달하는 용도). 반대로 `public/intro*.html`(공급자·벤더·파트너 모집)은 **색인 허용이 이득**이다. robots.ts 작성 시 이 둘을 명시 분기한다.

### 재조정 — 성공지표

§1의 "8주 내 색인 100+"는 신규 도메인엔 비현실적이다. 네이버는 신규 사이트 수집이 특히 느리다.
**수정: 12주 기준 — 수집 URL 100+ / 색인 50+ / 자연 유입 주 30+ / 상담 전환 1%+.** 8주 시점은 "수집 시작 확인"만 본다.

### ★테오 결정 (2026-07-22) — 확정, 변경 시 이 문서 갱신

**결정 1 — 빌라 노출 = 「소비자 검색형 공개 사이트」** ※ 2026-07-22 테오 재지시로 **개정**(초안의 "대표 빌라만 선별·목록 없음"은 폐기)

- 전제 정정: 현재 빌라 2개는 사업 초창기 상태일 뿐, **300~400개까지 확장 예정**이다. 그 규모에서 검색·필터가 없는 사이트는 성립하지 않는다.
- **소비자가 조건으로 찾아 들어오는 사이트**를 만든다 — 목록 + 필터(지역·이용시설·인원 등). 운영자 검색 기준을 소비자용으로 이식한다.
- `Villa.publicListed`는 **유지하되 성격이 바뀐다**: "선별 노출"이 아니라 **품질·동의 게이트**(사진/소개문 미비, 공급자 비동의, 분쟁 중 빌라를 빼는 스위치). 검수 통과 빌라는 원칙적으로 공개한다.
  - 300~400개를 수동 토글하는 것은 비현실적이므로 `AppSetting: SEO_AUTO_LIST_ON_SELLABLE`(기본 on)으로 **검수 통과(`isSellable`) 시 자동 공개**, 예외만 운영자가 끈다.
- ⚠ **감수하는 대가(테오 인지 후 결정)**: 목록·필터·sitemap이 공개되므로 **경쟁사가 우리 라인업을 조건별로 열람**할 수 있다. 300~400개 소비자 사이트에서 검색을 막으면 사이트가 성립하지 않으므로 이 비용은 치르고 간다. 완화책은 §2 공개경계(가격·공실·주소·공급자 비노출) 유지가 전부다.
- ★ **날짜 검색은 절대 제공하지 않는다** — "8/1~8/5 가능한 빌라" 검색은 그 자체가 **공실 현황 공개(원칙 1 정면 위반)**다. `VillaSearchFilters`의 `checkIn`·`checkOut`·`dateRangeValid`는 공개 필터에서 제외하고, 날짜는 상담 CTA로 넘긴다.

**결정 2 — 착수 범위 = 「인프라 + 가이드 콘텐츠 우선」**
- 공개 홈 · 색인 인프라(sitemap/robots/RSS/IndexNow/소유확인 메타) · `/blog` 가이드 자동생성까지가 1차 범위
- 빌라·지역·조합 페이지는 **구조만 깔고**(빌라 늘면 자동 증가), 초기 콘텐츠 주력은 가이드 글
- 이 범위만 배포돼도 네이버·구글·Bing·다음 4개 등록이 전부 가능하다

### 소비자 검색 설계 — 패싯(facet) SEO 구조 ※ 결정 1 개정에 따른 신설

**문제**: 필터를 쿼리스트링(`?tags=privatePool&minGuests=8`)으로만 만들면 크롤러가 색인하지 않는다. 검색엔진에 잡히는 건 **URL을 가진 페이지**뿐이다. 반대로 모든 필터 조합을 URL로 열면 조합 폭발 → 중복·얇은 콘텐츠 대량 발생.

**해법**: 가치 있는 패싯만 **정적 경로**로 승격하고, 나머지는 쿼리스트링 + `noindex` + canonical.

```
/villas                              전체 목록 (페이지네이션, index)
/villas/area/[code]                  지역·단지별      ← ComplexArea.code 재사용
/villas/feature/[key]                이용시설·특징별   ← FEATURE_ITEMS 사전 재사용
                                       (privatePool·kidsPool·bbq·viewSea·beachFront·golfNearby·gym·elevator·generator·marketNearby·viewMountain·viewCity)
/villas/guests/[n]                   인원별 (4·6·8·10·12·16…)
/villas/bedrooms/[n]                 침실 수별
/villas/area/[code]/feature/[key]    2단 조합 — 화이트리스트 조합만 sitemap 등재
?minBedrooms=&beach=&bedType=…       그 외 세부 필터 = 쿼리스트링, noindex + canonical→정적 경로
```

- **정적 경로 = 각각 고유 H1·도입문·메타디스크립션을 갖는 "페이지"** 로 취급한다(목록만 있는 껍데기 금지). 이것이 "블로그처럼 만든다"의 실제 구현이다.
- 필터 UI는 클라이언트 인터랙션으로 제공하되, **선택 결과가 정적 경로에 해당하면 그 URL로 이동**시킨다(크롤 가능 + 공유 가능).
- 조합 폭발 가드: 2단까지만, 그리고 **매칭 빌라 3개 미만이면 생성·등재하지 않는다**(빌라 2개 시점에는 대부분 생성 안 됨 → 정상. 빌라가 늘면 자동으로 열린다).
- 필터 소스는 **`lib/villa-search.ts`를 재사용**하되 공개용 서브셋만 노출:
  - 허용: `area` · `minBedrooms` · `minGuests` · `pool` · `breakfast` · `smoking` · `pets` · `party` · `extraBed` · `bedType` · `beach` · `tags`
  - **금지: `checkIn`·`checkOut`(공실 노출) · `supplierId` · `sellable`(내부값) · `q`의 주소·공급자명 매칭**(빌라명·단지명만 허용)

### 재편된 스프린트 (§9를 대체)

| 스프린트 | 범위 | 예상 |
|---|---|---|
| **S0 — 디자인** | DESIGN: 공개 홈 · 빌라 상세 · 목록(필터) · 가이드 글 4화면 Stitch export (`design/stitch/`) | 2일 |
| **S1 — 공개 기반·색인 인프라** | 공개 홈(+PWA start_url 분리·스플래시 제외·회귀), robots/sitemap/feed, IndexNow, 소유확인 메타 3종, 공개 직렬화 봉인 + 누수 테스트, Villa 공개 플래그 | 3일 |
| **S2 — 소비자 검색 사이트** | 빌라 상세, `/villas` 목록·페이지네이션, **패싯 정적 경로**(area·feature·guests·bedrooms + 2단 조합), 필터 UI, 3개 미만 미생성 가드, canonical·noindex 규칙, 내부 링크, JSON-LD | 4일 |
| **S3 — 가이드 콘텐츠 자동화** | `SeoArticle` 스키마, `seo-draft` cron(주제 풀), admin `/marketing/seo` 승인 큐, **점진 발행 큐(하루 5개 상한)**, 발행 시 IndexNow 핑, GA4·전환추적·CSP 갱신 | 3일 |

**착수 순서 = S0 → S1 → S2 → S3.** S1 완료 시점에 테오가 4개 검색엔진 등록을 진행한다.
> 빌라 2개 시점에는 S2의 패싯 페이지가 "3개 미만 미생성" 가드에 대부분 걸려 실제로 생성되지 않는다. **이는 정상이며 의도된 동작** — 빌라가 늘면 코드 변경 없이 자동으로 페이지가 열린다. 그 사이 검색 유입은 S3 가이드 콘텐츠가 담당한다.

## 1. 목표

| | 내용 |
|---|---|
| 사업 목표 | 한국 여행객·여행사의 **검색 유입을 사람 손 없이** 확보 → /chat 상담 전환 |
| 기술 목표 | 빌라·지역 데이터에서 공개 페이지를 **자동 생성 → 자동 색인 요청(IndexNow)** 하는 파이프라인 |
| 규모 목표 | 빌라 100개 기준 **자동 생성 페이지 300+**(빌라 100 · 지역 N · 테마조합 N · 가이드 글 주 3편) |
| 비목표 | 네이버 블로그 플랫폼 내부 자동 발행(불가·제재 리스크), 공개 예약·결제(직판 확대 시 별건) |

**성공 지표 (배포 후 8주)**
1. 네이버 서치어드바이저 수집 URL 200+ / 색인 100+
2. 네이버·구글 자연 유입 세션 주 100+
3. 공개 페이지 → `/chat` 상담 시작 전환율 2% 이상
4. 사람이 투입한 시간 = 주 30분 이하(가이드 글 승인만)

## 2. ★최우선 제약 — 사업 4대 원칙과의 충돌 해소

공개 콘텐츠는 CLAUDE.md 원칙 1(재고 비공개)·2(마진 비공개)와 정면으로 만난다. **아래 경계가 이 에픽의 헌법이며, 위반 시 기능 자체를 롤백한다.**

### 2.1 공개해도 되는 것 / 절대 금지

| 구분 | 항목 | 근거 |
|---|---|---|
| ✅ 공개 | 빌라명(name·nameVi), 단지명(complex), 침실·욕실·최대인원, 수영장·조식 여부, 해변거리(m), 면적·층수, 체크인/아웃 시각, 흡연·반려동물·파티 가능 여부, 주차 대수, VillaFeature, **승인된(APPROVED) 사진·클립**, 소개문(description) | 이미 인스타·유튜브로 공개 발행 중인 자산과 동일 범위 |
| ❌ 금지 | **판매가·원가·마진·baseDepositVnd·monthlyRentVnd** | 원칙 2. ★공급자는 자기 원가를 알므로 **공개 판매가 = 마진 역산**이다. 가격은 어떤 형태로도 페이지에 넣지 않는다 |
| ❌ 금지 | **날짜별 공실·캘린더·"예약 가능" 표시** | 원칙 1. 재고 현황은 운영자 전용 |
| ❌ 금지 | 상세 주소(번지)·정확 좌표, 공급자 정보(이름·연락처·Zalo) | 직거래 우회·무단 방문 차단 = 사업 보호 |
| ❌ 금지 | accessType·accessInfo·wifiSsid·wifiPassword | 기존 /p·/g 공개경계 규칙 그대로 승계 |
| ❌ 금지 | 미승인 사진·클립, 검수 미통과 빌라 | 원칙 3(검수 게이트) 승계 |

### 2.2 봉인 방식 (코드 강제)

- `lib/seo/public-villa.ts` 에 **공개 직렬화 단일 관문**을 만든다. 기존 `lib/instagram/caption.ts`의 `VillaPublicInfo` 패턴을 그대로 확장 — Prisma `select` 화이트리스트 + 반환 타입 봉인.
- 공개 라우트는 Villa 모델을 **직접 조회 금지**. 반드시 이 모듈 경유.
- `tests/seo-leak.test.ts` — 직렬화 결과 JSON에 금지 키(`price|krw|vnd|cost|margin|deposit|supplier|access|wifi|address`)가 하나라도 있으면 실패. `.claude/skills/qa/leak-checklist.md`에 항목 추가.
- QA 게이트: 실제 렌더된 HTML 소스에 금액 숫자·공급자명 grep 0 확인(작성자 자기평가 무효, 독립 QA).

### 2.3 가격 미표시의 대가와 대응

숙박 검색에서 가격 없는 페이지는 이탈률이 높다. 원칙이 우선이므로 가격은 넣지 않되, 다음으로 보완한다.
- CTA를 **"1분 견적 상담"**(→ `/chat?src=seo`)으로 통일, 페이지당 3곳(상단·중단·하단) 배치
- 인원·침실·테마 기준 스펙을 상세히 노출해 "조건 맞음" 판단은 페이지에서 끝내고, 가격만 상담으로 넘김
- B2B(여행사) 유입은 `/partner` 소개로 분기 — 기존 `public/intro-partner.html`(6개 언어) 재사용

### 2.4 공급자 동의

빌라 사진의 공개 웹 노출은 이미 인스타·유튜브 발행으로 선례가 있으나, **계약서 정본(signing/)에 "마케팅 목적 사진·영상의 공개 게시" 조항이 있는지 확인**하고 없으면 다음 개정 때 추가한다. (차단요인은 아님 — 확인 항목)

## 3. 현재 코드베이스 실사 (착수 전 확인 완료)

| 항목 | 현재 상태 | 영향 |
|---|---|---|
| `app/page.tsx` | 비로그인 → `/logout` 리다이렉트. **공개 홈 없음** | ★최우선 블로커. 크롤러가 사이트 루트에서 튕긴다 |
| `app/sitemap.ts` · `robots.ts` | **둘 다 없음** | 신규 작성 |
| 스플래시 게이트 | 최초 진입 2.3초 인트로(`/chat` 은 제외 처리됨) | 공개 콘텐츠 경로도 **제외 필수** — 크롤러 차단 방지 |
| `middleware.ts` | `PUBLIC_PATHS = ["/forgot-password","/reset-password","/logout"]` | 공개 콘텐츠 경로 추가 필요 |
| `ComplexArea` 마스터 | ADR-0046, 시드 4개(Sonasea/Sunset Sanato/Vinpearl/Greenbay), `code`=라틴 슬러그 | **지역 허브 URL에 그대로 사용** — 신규 설계 불필요 |
| `VillaPhoto` · `VillaClip` | space 분류, VillaClip은 APPROVED 게이트 존재 | 사진 선별 로직(`select-diverse-photos`) 재사용 |
| 콘텐츠 생성 | `lib/instagram/caption.ts`(Gemini+카피가이드+금칙어), `content-guide.ts`, `templates.ts`(satori) | **본문 생성기 재사용** — 신규 개발 최소 |
| 승인 큐 | `instagram-draft` cron → 운영자 승인 → 발행 | 가이드 글에 동일 패턴 적용 |
| 이미지 | R2 + `next/image` remotePatterns 설정됨 | 그대로 사용 |
| CSP | Report-Only, `script-src 'self' 'unsafe-inline' challenges.cloudflare.com` | **GA4/gtag 도메인 추가 필요** |
| 도메인 | `villa-go.net` (Railway `villa-pms-production.up.railway.app`) | 서치어드바이저·Google Ads 등록 대상 |

## 4. URL·페이지 구조

```
/                         공개 홈 (비로그인) — 브랜드 + 지역 허브 + 추천 빌라 + 최신 글
                          ※ 로그인 세션은 기존 role 분기 유지 (하위호환)
/villas/[slug]            빌라 상세          — 빌라 1개당 1페이지  (자동, 승인된 빌라만)
/areas/[code]             지역·단지 허브      — ComplexArea.code 재사용 (자동)
/collections/[theme]      테마 조합          — 롱테일 대응 (자동, 조건부 생성)
/blog                     콘텐츠 허브 (목록)
/blog/[slug]              가이드 글          — Gemini 초안 → 승인 → 발행
/sitemap.xml  /robots.txt  /feed.xml         색인 자동화
```

**테마 조합(`/collections`)이 규모를 만드는 지점.** 예: `가족 8인 이상`, `프라이빗 풀`, `해변 도보 5분`, `골프장 근처`, `BBQ 가능`, `조식 포함`, `단지별 × 인원대`.
- ⚠ **얇은 콘텐츠 방지 가드**: 매칭 빌라 **3개 미만이면 페이지를 생성하지 않는다**(sitemap에도 미포함). 저품질 판정은 도메인 전체에 번진다.
- 각 조합 페이지는 목록만 두지 않고 **고유 도입문(Gemini 1회 생성, 캐시)** 을 갖는다.

**내부 링크 규칙** (색인 촉진): 빌라 상세 ↔ 지역 허브 ↔ 테마 조합 ↔ 관련 가이드 글 상호 링크. 고아 페이지 0.

## 5. 색인 자동화 파이프라인 (핵심)

| 산출물 | 내용 |
|---|---|
| `app/sitemap.ts` | DB 기반 동적 생성. 승인된 빌라 + 지역 + 조건 충족 조합 + 발행된 글. `lastModified` = 실제 updatedAt |
| `app/robots.ts` | 공개 트리만 allow, `/admin`·`/api`·`/p/`·`/g/`·`/my-villas` 등 **전부 disallow**(★제안링크 토큰 색인 절대 금지) |
| `app/feed.xml/route.ts` | RSS — 서치어드바이저 RSS 제출용 |
| `lib/seo/indexnow.ts` | **IndexNow 핑** — 페이지 발행·수정 시 네이버(`searchadvisor.naver.com/indexnow`)·Bing(`bing.com/indexnow`) 동시 호출. **키 1개를 두 엔진이 공유**(IndexNow는 공용 프로토콜). 키 파일 `public/{key}.txt` 서빙 |
| `app/api/cron/seo-indexnow` | 발행 훅 실패분 재시도 + 일 1회 변경분 일괄 핑. Railway cron 등록(GraphQL 방식, memory 참조) |
| 소유확인 메타 | `NAVER_SITE_VERIFICATION` · `GOOGLE_SITE_VERIFICATION` · `BING_SITE_VERIFICATION`(`msvalidate.01`) env → root layout `<meta>` 주입. **Bing Webmaster는 Search Console에서 사이트 가져오기(import)** 가 되므로 구글 먼저 등록하면 Bing은 클릭 몇 번으로 끝난다 |
| JSON-LD | 빌라=`LodgingBusiness`(가격 필드 제외), 글=`Article`, 홈=`Organization` |
| 크롤러 통과 | 스플래시 게이트 제외 + `PUBLIC_PATHS` 추가 + 비로그인 200 응답 QA 실측 |

### 5.1 검색엔진별 등록·자동화 매트릭스

| 엔진 | 등록처 | 소유확인 | 새 글 자동 색인요청 | 비고 |
|---|---|---|---|---|
| **네이버** | searchadvisor.naver.com/start | 메타태그 | ⭕ **IndexNow** + 사이트맵·RSS 제출 | 주 타깃. 웹문서 영역 노출 |
| **구글** | Search Console | 메타태그 | ❌ IndexNow 미지원 → 사이트맵 + 크롤 예산에 의존 | Google Ads 랜딩 품질과 직결 |
| **Bing** | bing.com/webmasters | 메타 or **GSC import** | ⭕ **IndexNow**(네이버와 키 공유) | AI 검색(ChatGPT·Copilot) 소스 |
| **다음(카카오)** | register.search.daum.net | 카카오 계정 신청 | ❌ **수동 1회 등록·심사만**. 웹마스터도구·사이트맵 제출 채널 없음 | 등록 후에는 크롤러 재방문에 맡김 |

→ **코드가 자동화하는 건 네이버·Bing(IndexNow)과 구글(사이트맵)** 이고, 다음은 테오의 1회 등록으로 끝난다. 다음은 크롤러 재방문 주기에 의존하므로, `robots.txt`·사이트맵을 표준대로 두고 내부 링크를 촘촘히 하는 것이 사실상의 대응이다.

## 6. 콘텐츠 자동 생성

| 유형 | 생성 방식 | 발행 게이트 |
|---|---|---|
| 빌라 상세 | **데이터 파생** — 스펙 표 + 공간별 사진 + `caption.ts` 확장 본문(Gemini, 카피가이드·금칙어 적용) | **자동 발행** (운영자가 `publicListed` 켠 빌라만). 사실 기반이라 승인 불필요 |
| 지역 허브 | 소속 빌라 집계 + 지역 소개문(Gemini 1회, 캐시) | 자동 |
| 테마 조합 | 조건 쿼리 + 도입문(Gemini 1회, 캐시) | 자동 (3개 미만 미생성) |
| 가이드 글 | `seo-draft` cron이 주 3편 초안 생성(주제 풀: 푸꾸옥 이동·시즌·아이동반·골프·맛집·빌라 고르는 법) | **승인 필요** — Gemini 창작물은 허위정보 위험. admin `/marketing/seo` 승인 큐. 승인 1건당 30초 |

금칙어·과장광고 가드는 `content-guide.ts`의 기존 `getBannedTerms()` 재사용(허위 통계·최상급 표현 금지 — intro 페이지 선례 동일).

## 7. 스키마 변경 (additive raw SQL — `prisma db push` 금지)

```sql
-- Villa: 공개 게시 제어
ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "publicSlug" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Villa_publicSlug_key" ON "Villa"("publicSlug");
ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "publicListed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Villa" ADD COLUMN IF NOT EXISTS "publicListedAt" TIMESTAMP(3);

-- 가이드 글 (빌라·지역·조합은 런타임 파생이라 모델 불필요)
CREATE TYPE "SeoArticleStatus" AS ENUM ('DRAFT','APPROVED','PUBLISHED','REJECTED');
CREATE TABLE IF NOT EXISTS "SeoArticle" (...slug UNIQUE, title, bodyJson, coverPhotoUrl,
  relatedVillaIds, status, publishedAt, lastPingAt, createdAt, updatedAt);
```
적용 SQL은 `prisma/migrations-manual/2026-07-XX-seo-public.sql` 로 보존. 적용 후 `npx prisma generate` 필수. TDA 검토 대상.

`publicListed` 토글·`SeoArticle` 상태 변경은 **전부 `writeAuditLog()` 동반**(글로벌 절대 규칙).

## 8. 측정·광고 연동 (테오 등록 계획 반영)

- **GA4 + Google Ads 전환추적**: `/chat` 상담 시작, 카카오·Zalo CTA 클릭, `/partner` 문의를 전환 이벤트로 정의. gtag 스니펫은 **공개 트리에만** 주입(관리자·공급자 화면에는 미주입 — 개인정보·성능).
- **CSP 갱신 필수**: `script-src`에 `https://www.googletagmanager.com`, `connect-src`에 `https://*.google-analytics.com` 추가. 현재 Report-Only라 즉시 차단은 없지만 enforce 전환 시 터진다 → `csp-enforce-blockers` 메모에 항목 추가.
- **Google Ads 심사 대응**: 여행·숙박 카테고리는 랜딩 심사가 까다롭다. 랜딩에 ① 명확한 서비스 설명 ② 연락 수단 ③ 개인정보처리방침 링크(`/privacy` 기존) ④ 사업자 정보가 있어야 반려를 피한다. 공개 홈 설계에 포함.
- 서치어드바이저: 사이트 등록 → 소유확인 → **사이트맵·RSS 제출** → 웹마스터 도구에서 수집 현황 주 1회 확인.

## 9. 스프린트 분할

| 스프린트 | 범위 | 산출물 | 예상 |
|---|---|---|---|
| **S1 — 기반·봉인** | 공개 홈, 빌라 상세, 공개 직렬화 봉인 + 누수 테스트, sitemap/robots/feed, IndexNow, 소유확인 메타, 미들웨어·스플래시 크롤러 통과, admin 빌라 공개 토글 | 색인 가능한 최소 사이트 | 3일 |
| **S2 — 규모** | 지역 허브, 테마 조합(얇은 콘텐츠 가드), 내부 링크, JSON-LD, OG 태그, GA4·전환추적·CSP | 페이지 300+ | 2일 |
| **S3 — 콘텐츠 자동** | `seo-draft` cron(주 3편), admin `/marketing/seo` 승인 큐, 발행 시 IndexNow 핑, `seo-indexnow` cron 등록 | 손 안 대는 콘텐츠 공급 | 3일 |

S1만 배포해도 테오의 서치어드바이저·Google Ads 등록이 가능하다(등록 선행 조건 = 공개 홈 + 소유확인 메타 + 사이트맵).

## 10. 리스크

| 리스크 | 대응 |
|---|---|
| **누수** — 공개 페이지에 가격·공실·공급자 유출 | §2.2 단일 관문 + 누수 테스트 + 독립 QA. 이 에픽의 릴리스 게이트 |
| **저품질 판정** — 얇은/중복 콘텐츠 | 조합 3개 미만 미생성, 빌라별 고유 본문, 가이드 글 승인제 |
| 네이버 웹문서는 블로그 탭보다 노출 약함 | 사실. 무료 유입은 보조로 보고 **Google Ads·네이버 검색광고 API로 확실한 유입을 병행**(별도 에픽) |
| 제안링크·게스트링크 토큰 색인 | robots disallow + `noindex` 메타 이중 차단, QA에서 실측 |
| 공개 홈 도입으로 기존 로그인 리다이렉트 회귀 | 세션 있으면 기존 role 분기 100% 보존, 회귀 테스트 필수(과거 무한 리다이렉트 루프 전력 있음) |
| 스플래시 게이트가 크롤러 차단 | `/chat` 제외 선례 그대로 적용 + 실제 UA로 200 확인 |

## 11. 테오 액션 (코드와 병렬)

1. 네이버 서치어드바이저(`searchadvisor.naver.com/start`) 사이트 등록 → **소유확인 메타값 전달** → 사이트맵·RSS 제출
2. Google Search Console 등록 → 소유확인 메타값 전달 → 사이트맵 제출
3. Bing Webmaster Tools(`bing.com/webmasters`) 등록 → **Search Console에서 import** 하면 소유확인·사이트맵 자동 승계. IndexNow 키는 우리 코드가 생성해 전달
4. 다음 검색등록(`register.search.daum.net`) 신청 → 심사 대기(수동 1회). ★공개 홈이 살아있어야 심사를 통과하므로 **S1 배포 이후** 신청
5. Google Ads 계정 생성 → 전환 ID·라벨 전달 (전환추적 심기용)
6. (확인) 계약서 정본에 마케팅 목적 사진·영상 공개 게시 조항 유무

> Bing 등록의 부가 효과: Bing 인덱스는 **ChatGPT·Copilot 등 AI 검색의 소스**로 쓰인다. 한국 여행객이 AI에게 "푸꾸옥 가족 빌라" 를 물을 때 노출될 통로가 하나 더 생긴다. IndexNow는 네이버·Bing이 같은 프로토콜을 쓰므로 **핑 1회로 두 엔진 동시 색인 요청**이 된다 — 구글만 IndexNow 미지원이라 사이트맵·Search Console 경로를 쓴다.

## 12. 착수 조건

- 병렬 세션 규칙 0에 따라 **worktree 격리 후 착수** (`scripts\wt-new.ps1 -Name seo-blog`)
- S1 계약서 `docs/contracts/T-seo-public-s1.md` 단독 커밋으로 선점
- 스키마 변경은 TDA 검토 후 raw SQL 적용
