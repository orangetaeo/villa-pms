# T-supplier-intro-page — 공급자 모집용 사업 소개 페이지 (/intro.html) + 로그인 진입 링크

> 담당: UX-VN(구현) · QA(검증) · 상태: 착수 (2026-07-15) · 세션: 메인 폴더 → worktree `wt/intro-page`

## 1. 목적·배경

- 테오가 빌라 관리인(가입 전 공급자)에게 사업 소개·등록 유도를 할 수 있는 **영업용 소개 문서**를 웹에서 상시 제공.
- 기존 T4.3 `/guide`는 **가입 후 사용법** 가이드 — 본 태스크는 **가입 전 설득/모집** 문서로 별개.
- 원본: 아티팩트로 제작 완료된 단일 HTML (vi 기본 + ko 토글, Villa GO 브랜딩 teal/orange, 모바일 우선).

## 2. 설계 결정 (Triage·회의 요약)

- **정적 파일 `public/intro.html`로 저장** — 앱 라우트(next-intl) 변환 대신 자체 VI/KO 토글을 가진 자기완결 HTML 유지.
  근거: ① 비로그인 공개 문서라 앱 셸·세션 불필요 ② Zalo 공유·오프라인 영업에 같은 URL 재사용 ③ i18n 키 수십 개 추가 대비 유지비 최소. 마케팅 문서이므로 Stitch design-first 규칙의 앱 화면 대상 아님(원본이 이미 디자인 완료물).
- **로그인 화면에는 소개 전문을 넣지 않고 링크만 추가** — 로그인은 가볍게 유지. `auth.login` NS에 키 추가(추가만).
- 콘텐츠 원칙: 마진·판매가 언급 0(재고·마진 비공개), 허위 통계 0(정성 표현만).

## 3. 범위

- **신규**: `public/intro.html` — 완전한 HTML 문서(doctype/head/meta/og 포함)로 변환한 빌라 관리인(공급자) 소개 페이지. vi 기본 + KO 토글.
- **신규(범위 확장 2026-07-15)**: `public/intro-vendor.html` — 부가서비스 업체(마사지·입장권·BBQ 등) 소개 페이지. vi 기본 + KO 토글.
- **신규(범위 확장 2026-07-15)**: `public/intro-partner.html` — 여행사·랜드사(B2B 파트너) 안내 페이지. ko 기본 + 6개 언어(ko/en/vi/ru/zh/hi) JS 사전 토글.
- **추가만(공유 파일)**: `messages/ko.json`·`messages/vi.json` — `auth.login` NS에 `introHeading`·`introVilla`·`introVendor`·`introPartner`(문구) 키 추가. 기존 키 수정 0. (기존 브랜치에서 추가했던 `introLink` 단일 키는 3링크 블록 개편으로 대체·제거)
- **안전 수정**: `app/(auth)/login/LoginForm.tsx` + `page.tsx` — signup 링크 아래에 소개 링크 블록(헤딩 + 3링크: `/intro.html`·`/intro-vendor.html`·`/intro-partner.html`) 추가. 로직 변경 0.

### 수정 금지 구역
- `app/api/**`, `prisma/schema.prisma`, `lib/**`, 그 외 로그인 플로우 로직(actions.ts) 일체.
- 메인 폴더 루트의 untracked 마케팅 에셋(kakao-icon-*, villa-go-*.png, design-audit/, scripts/prod-*·seed-*)은 타 세션/사용자 소유 — 커밋·수정 금지.

## 4. 완료 기준 (테스트 가능)

1. 비로그인 상태 `GET /intro.html` 200 렌더 (미들웨어 인증 우회 확인) — vi 기본, KO 토글 동작.
2. `/login` 화면에 소개 링크 노출, 클릭 시 `/intro.html` 이동. ko·vi 양쪽 키 존재(누락 시 next-intl throw).
3. 콘텐츠 누수 0: 판매가·마진·재고 수치·타 공급자 정보 미포함 (QA leak-checklist).
4. `npm run lint` + `npm run typecheck` + `next build` 신규 에러 0.
5. 모바일(360px)에서 가로 스크롤 없음.
