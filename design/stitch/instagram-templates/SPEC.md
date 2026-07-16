# Instagram 오버레이 템플릿 4종 — 디자인 SPEC

> 대상: 한국인 대상 푸꾸옥 풀빌라 인스타그램 캐러셀. 브랜드 **VILLA GO**.
> 기획 근거: `docs/marketing/instagram-marketing-plan.md` §2-2(오버레이 스타일)·§3-2(satori 런타임 렌더).
> **이 SPEC만 보고 BE가 satori 템플릿으로 변환 가능하도록** 작성됨.

- 아트보드: **1080 × 1350 (세로 4:5)** 고정 — 전 템플릿 공통.
- 산출 파일: `cover/ info/ service/ cta/` 각 폴더의 `index.html`(satori-safe 시안) + `preview.jpeg`(1080×1350 렌더 확인, **랜덤 placeholder 사진** — 레이아웃만 참고).
- `cover/stitch-original.html` = Stitch MCP 1차 생성 원본(방향 참고용, 최종본 아님).

---

## 0. 왜 이 형태인가 (Stitch → satori 변환 전제)

Stitch MCP로 커버 방향을 생성(`cover/stitch-original.html`)한 뒤, **런타임 렌더러가 satori**이므로 4종 전부를 satori-safe로 직접 정제했다. satori는 CSS 부분집합(flexbox 중심)만 지원하므로 아래 규칙을 **전 템플릿에서 강제**했다:

### satori 호환 규칙 (변환 시 반드시 유지)
1. **레이아웃은 flexbox + absolute positioning 만.** `display:grid` / `float` 없음.
2. **금지 속성 미사용**: `backdrop-filter`, `filter`, `transform`, `box-shadow`(→ 대신 `border`·반투명 fill 사용), `background-size:cover`(→ 사진은 `<img object-fit:cover>` 레이어로).
3. **satori 규칙: 자식이 2개 이상인 모든 요소는 `display:flex`** 를 명시해야 함(satori는 다자식 블록에서 throw). 본 템플릿의 모든 다자식 컨테이너에 `display:flex` 지정 완료.
4. satori가 지원하는 것만 사용: `linear-gradient` 배경 ✅, `text-shadow` ✅, `border-radius` ✅, `letter-spacing` ✅, `word-break:keep-all` ✅, `object-fit` ✅.
5. **텍스트 데이터 주입점은 전부 단일 요소** — `data-inject="<token>"` 속성으로 표시. satori JSX에서 해당 노드의 children만 교체하면 됨.

### 사진 레이어 처리 (cover·info·service)
- 프리뷰 HTML은 사진을 `<img class="photo" data-inject="photoUrl">` 절대배치 레이어(z0)로 렌더.
- **런타임 2가지 선택지**(기획 §3-2 파이프라인은 후자 권장):
  - (A) satori에 사진 `<img src="{photoUrl}">` 그대로 주입 — 공개 R2 URL. 간단하지만 satori가 원격 이미지 fetch.
  - (B) **satori는 배경 투명 오버레이(스크림+텍스트+뱃지)만 렌더 → sharp로 사진 위 composite** (기획 권장, 성능↑). 이 경우 `.photo` 레이어를 제거하고 아트보드 배경을 `transparent`로 두면 됨. 스크림 그라디언트는 오버레이의 일부이므로 satori가 렌더.
- **cta**는 사진 없음 — satori가 teal 그라디언트 배경까지 전부 렌더.

### 폰트 (satori에 파일 번들 필요)
| 용도 | family | weight | 라이선스 |
|---|---|---|---|
| 감성 헤드라인(serif) | **Nanum Myeongjo** | 700/800 | 상업적 무료 |
| 정보·라벨·브랜드(sans) | **Pretendard** (프리뷰는 Public Sans 폴백) | 300/600/700 | 상업적 무료 |
- satori는 웹폰트 링크를 못 읽으므로 두 폰트의 `.ttf/.otf`를 `satori({ fonts: [...] })`에 buffer로 전달. 한글 글리프 포함 서브셋 필수.
- 프리뷰 HTML은 Google Fonts로 Nanum Myeongjo + Public Sans 로드(한글은 시스템 폰트 폴백으로 렌더됨).

### ⚠ 이모지 (info 템플릿 전용 gotcha)
info 정보바의 `🛏 👨‍👩‍👧 🏖` 는 **satori 기본 렌더 불가**. 두 방법 중 택1:
- (A) `satori`의 `loadAdditionalAsset` + **twemoji** SVG 로더 연결.
- (B) **권장**: `.ico` span을 번들 **모노크롬 SVG 아이콘 `<img>`** 로 교체(침대/가족/해변). 각 아이콘이 독립 요소라 교체 쉬움. 브랜드 톤(크림색 라인 아이콘)에 더 맞음.

---

## 1. 공통 색상 토큰

| 토큰 | HEX | 용도 |
|---|---|---|
| `brand-teal` | `#0D9488` | 브랜드 주색 · 라벨 pill · cta 배경 |
| `brand-teal-deep` | `#0F766E` / `#115E59` | cta 그라디언트 하단 |
| `cream` | `#FFF9F0` | 텍스트(사진 위)·price 뱃지 배경 |
| `sand-accent` | `#F59E0B` | 디바이더·구분 점(dot)·decor circle |
| `kakao-yellow` | `#FEE500` | 카카오 상담 chip/버튼 |
| `kakao-ink` | `#191600` | 카카오 chip 텍스트 |
| `scrim` | `rgba(10,17,20,α)` | 사진 위 가독성 그라디언트 |
| `price-teal` | `#0D9488` / `#0F766E` | price 뱃지 텍스트 |

타이포 스케일(1080px 기준): eyebrow/label 24–34px · 정보텍스트 36px · price 26/34px · 감성 헤드라인 60–68px(serif) · 브랜드 워드마크 36–44px(letter-spacing .24em) · handle 20–22px · helper 30px.

---

## 2. 템플릿별 레이어 구조 + 데이터 주입점

모든 좌표/여백은 1080×1350 절대 기준. `data-inject` 값 = 주입 토큰.

### 2-1. `cover/` — 커버(1장째, 감성 헤드라인)
레이어(z 오름차순):
1. `.photo` — 빌라 사진 full-bleed `<img object-fit:cover>` · `{photoUrl}`
2. `.scrim-top`(상단 460px, black .55→0) + `.scrim-bottom`(하단 420px, black .62→0)
3. `.top`(상단, 중앙정렬, padding-top 150px): `.eyebrow` → `.headline` → `.divider`(amber 68×2px)
4. `.bottom`(하단, flex row space-between): 좌 `.brand`+`.handle` / 우 `.slide-hint`

| 토큰 | 기본값 | 비고 |
|---|---|---|
| `photoUrl` | (placeholder) | 대표컷(수영장/외관) 권장 |
| `eyebrow` | `PHU QUOC PRIVATE POOL VILLA` | 라틴 소문자대문자, 고정 문구 성격 |
| `headline` | `푸꾸옥에서<br>눈 뜨자마자 수영장` | **serif, `<br>` 허용**, keep-all. 카피가이드 생성 |
| `brandName` | `VILLA GO` | 고정 |
| `handle` | `@villago.phuquoc` | 고정 |
| `slideHint` | `밀어서 더보기 →` | 캐러셀 어포던스, 고정 |

### 2-2. `info/` — 정보바(침실·인원·해변 + 가격 뱃지)
레이어:
1. `.photo` · `{photoUrl}`
2. `.scrim-bottom`(하단 470px, 3-stop black .86→.62→0) — 정보바 가독성
3. `.top`(flex row, 우측정렬): `.price-badge`(크림 pill) = `1박` + `.price-value`
4. `.bottom`(하단 flex column): `.villa-name`(serif) → `.info-row`(아이콘+텍스트 3항목, `.dot` amber 구분)

| 토큰 | 기본값 | 비고 |
|---|---|---|
| `photoUrl` | (placeholder) | |
| `priceBadge` | `45만원~` | **"1박 "은 템플릿 고정, 값만 주입.** 구체가 박제 지양 — 항상 "~" 시작가(기획 §4 #10). 미표기 옵션 시 `.top` 전체 hide |
| `villaName` | `쏘나씨 오션 풀빌라` | serif, 선택(빈값 시 정보바만) |
| `bedrooms` | `3` | `침실 {bedrooms}` 형태, 숫자만 주입 |
| `maxGuests` | `8` | `최대 {maxGuests}인` |
| `beachDistance` | `도보 5분` | `해변 {beachDistance}` (문자열, 예: "도보 5분"·"차 10분") |
- 아이콘: `.ico` 3개(🛏/👨‍👩‍👧/🏖) → satori에서 SVG `<img>`로 교체(§0 ⚠). **에셋 준비됨**: `assets/icons/info-bed.svg`·`info-guests.svg`·`info-beach.svg`(단색 크림 `#FFF9F0`, 32×32, satori-safe). 순서=침실→인원→해변, 권장 `height:40px`.
- 정보바 3항목 합계 폭이 912px(1080−좌우84×2) 초과하지 않도록 `beachDistance` 문자열 길이 제한(권장 ≤6자).

### 2-3. `service/` — 부가서비스(라벨 + 카톡 견적, **가격 없음**)
레이어:
1. `.photo`(서비스 사진) · `{photoUrl}`
2. `.scrim-top`(400px) + `.scrim-bottom`(480px, 3-stop)
3. `.top`(상단): `.label-pill`(teal) = `.label-dot`(amber) + `.label-text`
4. `.bottom`(하단 flex column): `.cta-copy`(serif, 편의성 카피) → `.cta-sub`(flex row): `.kakao-tag`(옐로 pill) + `.brand`

| 토큰 | 기본값 | 비고 |
|---|---|---|
| `photoUrl` | (placeholder) | 서비스 사진(마사지/BBQ 등) |
| `serviceLabel` | `빌라로 찾아오는 출장 마사지` | 카테고리 라벨, 편의성 중심 카피 |
| `serviceHeadline` | `장보기부터 세팅까지,<br>손 하나 안 대셔도 됩니다` | serif, `<br>` 허용 |
| `serviceCtaText` | `카톡 문의 시 견적 안내` | 옐로 tag, **가격 절대 미포함**(마진 비공개) |
| `brandName` | `VILLA GO` | 고정 |
- **금칙(기획 §2-4)**: 원가·마진 추정 표현, 확정 판매가 박제 금지. 견적은 항상 "카톡 문의".

### 2-4. `cta/` — 마지막 장(사진 없음, 브랜드 배경)
배경: 아트보드 `linear-gradient(150deg, #0D9488 0%, #0F766E 52%, #115E59 100%)` — satori 렌더.
레이어:
1. `.decor-1`/`.decor-2` — 반투명 원(크림 .06 / 앰버 .08), 절대배치 depth 요소(블러 없음)
2. `.top`(상단 중앙): `.brand`(워드마크) + `.handle`
3. `.center`(중앙): `.divider`(amber) → `.headline`(serif) → `.kakao-btn`(옐로 pill)
4. `.bottom`(하단): `.helper`

| 토큰 | 기본값 | 비고 |
|---|---|---|
| `brandName` | `VILLA GO` | 고정 |
| `handle` | `푸꾸옥 프라이빗 풀빌라` | 서브라인 |
| `ctaHeadline` | `예약 · 견적 문의는<br>프로필 링크 →<br>카카오톡 상담` | serif, `<br>` 허용, keep-all |
| `kakaoLabel` | `카카오톡으로 상담하기` | 옐로 버튼 |
| `ctaHelper` | `프로필 링크를 눌러 카카오 채널로 연결됩니다` | 인스타 링크 정책(캡션 링크 불가) 반영 |

---

## 3. 재고·마진 비공개 원칙 준수 (전 템플릿)

- **판매가·마진·원가·환율·KRW↔VND 환산값 절대 미노출.** info의 `priceBadge`는 "1박 45만원~" **시작가(~) 표기만** 허용(기획 §4 #10).
- service는 **가격 요소 자체가 없음** — 카톡 견적으로 통일.
- 전체 공실 리스트/재고 노출 콘텐츠 금지 — 개별 빌라 쇼케이스만(기획 §4 #12).

---

## 4. 디자인 평가 4기준 — 1차 자가검토 (DESIGN)

> 최종 채점은 QA. 아래는 제출 전 자가 채점 + "다듬기 vs 미학 전환" 판단.

| 기준 | 자가 채점 | 근거 |
|---|---|---|
| **디자인 품질** | 상 | 4종이 하나의 정체성으로 응집 — cream/teal/sand + kakao-yellow 팔레트, Nanum Myeongjo(감성) × 산세리프(정보) 페어링, amber 디바이더/점 액센트 반복, 84–96px 여백 리듬 통일. 부품 나열 아님. |
| **독창성** | 상 | 여행 매거진 에디토리얼 방향(레터스페이스 eyebrow, serif 헤드라인, 앰버 액센트) — AI 기본값(흰 카드+보라 그라디언트) 탈피. cta의 반투명 원 depth는 블러 없이 satori-safe하게 의도적 선택. |
| **완성도** | 중상 | 타이포 위계 명확(eyebrow<headline, label<copy), 스크림으로 대비 확보, 간격 일관. info 아이콘=모노크롬 SVG 3종 제작 완료(assets/icons/)로 폰트/이모지 의존 해소, BE 통합만 남음. |
| **기능성** | 상 | satori 변환 관점: flexbox 전용·단일 주입점·다자식 flex 규칙 준수로 "SPEC만 보고 변환 가능". 뷰어 관점: CTA 경로(카톡)·정보·시작가가 추측 없이 읽힘. |

**전략 판단(1회 수행)**: Stitch 1차 커버(단독 화면)를 **현재 에디토리얼 방향으로 다듬어 4종 시스템으로 확장** — 미학 전환보다 방향 심화가 정답. 이유: 커버의 serif+cream 톤이 이미 프리미엄 여행 계정 벤치마크(기획 §2-2)와 정합하고, 브랜드 teal과 충돌 없이 cta에서 수렴 가능했음.

**BE 변환 인계 시 확인 요청 3건**:
1. 이모지→모노크롬 SVG 아이콘 교체(info) — **에셋 완료(assets/icons/, BE 통합 대기)**. 단색 크림(`#FFF9F0`) 32×32 path 기반 3종: `info-bed.svg`(침실)·`info-guests.svg`(인원)·`info-beach.svg`(해변, 파라솔). gradient·filter·text 미포함 satori `<img>` 안전. info 템플릿의 `.ico` span 3개(🛏/👨‍👩‍👧/🏖)를 각 `<img src=".../info-*.svg" height="40">`로 교체하면 됨(현재 앰버 dot 대체 상태 해소). 34px 높이 렌더 식별성 자가검증 완료.
2. 사진 레이어 (A)satori img 주입 vs (B)sharp composite 중 파이프라인 확정(기획은 B 권장).
3. Nanum Myeongjo·Pretendard 한글 서브셋 폰트 buffer 번들.

---

## 5. 파일 목록
```
design/stitch/instagram-templates/
├─ SPEC.md                     ← 본 문서 (변환 기준)
├─ cover/   index.html · preview.jpeg · stitch-original.html
├─ info/    index.html · preview.jpeg
├─ service/ index.html · preview.jpeg
└─ cta/     index.html · preview.jpeg
```
