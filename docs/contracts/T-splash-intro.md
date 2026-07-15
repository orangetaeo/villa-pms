# T-splash-intro — villa-go.net 최초 진입 스플래시 인트로 (핀 드롭, 2.6초)

> 담당: FE(구현) · QA(검증) · 상태: 착수 (2026-07-15) · 세션: 메인 폴더 → worktree 격리

## 1. 목적·배경

- villa-go.net 최초 진입 시 2.6초(하드 상한 3.2초) 브랜드 스플래시 — 로고(지도핀+집)가 3D로 완성되는 인트로. (등장 1.3초 + 완성 로고 홀드 1초 + 페이드 0.3초. 테오 지시로 1.6초→2.6초 연장, 2026-07-15)
- 사용자 결정: 연출 3안 중 **1안 핀 드롭** 채택 (DESIGN·FE 회의 완료, 2026-07-15).

## 2. 설계 결정 (회의 요약)

- **연출 (핀 드롭)**: 핀 3D 원근 낙하(0.1–0.5s) → 착지 바운스+링 파동(0.5–0.7s) → 오렌지 지붕점 팝(0.7–0.9s) → "Villa GO" 워드마크+태그라인(0.9–1.3s) → 완성 로고 홀드(1.3–2.3s) → 페이드 아웃(2.3–2.6s). 태그라인: ko `찾던 그 빌라, 여기 있어요` / vi `Villa bạn tìm, có ở đây`.
- **마운트**: 루트 `app/layout.tsx`에 ① `<head>` 동기 인라인 게이트 스크립트(페인트 전 sessionStorage·reduced-motion·경로 판정 → `html[data-splash]` 세팅) ② `NextIntlClientProvider` **밖** 정적 `#splash` 오버레이 div(서버·클라 동일 마크업 — 하이드레이션 미스매치 0) ③ 클라 컴포넌트가 타임라인·스킵·플래그 기록. 루트 page.tsx(리다이렉트 허브)는 불변.
- **3D 기술**: CSS 3D transform + keyframes만 (신규 의존성 0). `transform`/`opacity`만 애니메이트(컴포지터 전용).
- **로고**: PNG 대신 **인라인 SVG 레이어 재구성**(둥근사각/핀/집/오렌지점 분리) — 레이어별 애니메이션 필수라 평면 PNG 부적합. 루트 untracked PNG 에셋은 건드리지 않음.
- **1회 제어**: sessionStorage(세션당 1회), 플래그 기록은 재생 완료/스킵 **시점**(중간 홉 /logout이 1회분 소진 방지).
- **제외 경로**: `/p/`(제안 링크)·`/g/`(게스트 링크)는 스플래시 미표시 — 외부 손님 링크에 지연 금지.
- **접근성**: prefers-reduced-motion=스킵(또는 ≤300ms 정적 페이드), 탭/키 입력 즉시 스킵, 오버레이 `aria-hidden` + 포커스 트랩 금지, `visibilitychange`·3.2s setTimeout 하드 종료.
- **포커스 억제(모바일 키보드 가림 방지)**: 재생 중 오버레이 밖 요소(로그인 input autoFocus 등)로 들어오는 포커스를 focusin으로 흡수·blur, 종료 시 원래 대상으로 복원(데스크톱 autoFocus UX 유지, 모바일은 인트로 종료 후에야 키보드). 스플래시 미표시 경로(재방문·reduced-motion·/p·/g)는 리스너 미등록으로 부작용 0.
- **CSP 유의**: 인라인 게이트 스크립트는 향후 CSP enforce 시 nonce 필요 — `docs/ops/` CSP 백로그(T-sec-csp-enforce)에 본 스크립트 포함하도록 명기.

## 3. 범위

- **신규**: `components/splash-intro.tsx`(클라, 타임라인·스킵), 스플래시 SVG 마크업(컴포넌트 내장).
- **수정(추가만)**: `app/layout.tsx`(게이트 스크립트+오버레이+마운트), `app/globals.css`(키프레임·`html[data-splash]` 규칙 추가만).
- **i18n**: 태그라인은 오버레이가 빈 i18n provider 밖이므로 layout(서버)에서 locale 쿠키 기반 ko/vi 선택해 prop 전달(messages/*.json 키 추가 없이 컴포넌트 상수 — 스플래시 전용 장식 텍스트).

### 수정 금지 구역
- `app/(auth)/login/**` (T-supplier-intro-page 세션 작업 중), `app/api/**`, `prisma/**`, `lib/**`, `messages/*.json`.
- 메인 폴더 루트 untracked 에셋(kakao-icon-*, villa-go-*.png, design-audit/, scripts/prod-*·seed-*) 커밋·수정 금지.

## 4. 완료 기준 (테스트 가능)

1. 비로그인 첫 진입(/login 착지): 스플래시 1회 재생 후 자동 종료, 같은 세션 내 페이지 이동·새로고침 시 재표시 없음. 새 탭(새 세션)에서는 다시 1회.
2. 탭/클릭/키 입력 시 즉시 종료. 하드 상한 3.2초 내 무조건 종료.
3. `/p/<token>`·`/g/<token>` 직접 진입 시 스플래시 미표시.
4. `prefers-reduced-motion: reduce` 에뮬레이션 시 낙하·회전 애니메이션 없음.
5. 로그인 상태 재진입(/dashboard 등 착지)에서도 세션 첫 1회만 표시, 본 화면 로딩 병행(오버레이 아래 렌더 확인).
6. 하이드레이션 에러·콘솔 에러 0. `npm run lint`+`typecheck`+`next build` 신규 에러 0.
7. 모바일 360px 가로 스크롤 없음, 태그라인 ko/vi locale 쿠키 따라 표시.
8. 콘텐츠 누수 0: 수치·마진·재고 언급 없음 (태그라인 고정 문구만).
