# 계약: T-pwa-install — PWA 설치 기반 (매니페스트·앱 아이콘·viewport)

## 배경
CLAUDE.md 요구("Railway 배포, PWA(모바일 대응)", "베트남 사용자 모바일 우선")에도 PWA가 전무:
manifest 없음·앱 아이콘 없음·theme-color/viewport export 없음. 베트남 공급자가 폰 홈화면에
설치해 앱처럼 쓰는 시나리오(공급자 화면은 모바일 우선)를 지원하지 못함. 별도 점유 세션 없음.

## 범위 (수정/신규 파일 — 이 세션 전용)
- `app/manifest.ts` (신규) — MetadataRoute.Manifest (name·short_name·colors·display standalone·lang·icons)
- `app/icon.svg` (신규) — 파비콘 + 매니페스트 아이콘 (teal 브랜드, maskable 패딩)
- `app/apple-icon.tsx` (신규) — next/og ImageResponse 180×180 PNG (iOS 홈화면, sharp 불필요)
- `app/layout.tsx` (수정) — `export const viewport`(themeColor·viewportFit cover) + metadata appleWebApp/applicationName **추가만** (기존 NextIntlClientProvider·폰트·title 무변경)
- `docs/contracts/T-pwa-install.md`(본 파일), `TASKS.md`(신규 행 1줄 추가)

## 수정 금지 구역 (다른 세션 점유)
- app/(supplier)/my-villas/* (T1.10), app/(admin)/* layout 외, lib/cleaning·hold·proposal, schema.prisma, messages/*, LAUNCH.md, T6.7 contract
- 기존 globals.css·폰트 로딩 무변경

## 완료 기준 (테스트 가능)
1. `/manifest.webmanifest` 200 응답, display=standalone, theme_color·background_color·lang=vi·icons≥1
2. `app/icon.svg`가 파비콘으로 노출(<link rel=icon> 자동), 매니페스트 아이콘으로 참조
3. `/apple-icon` PNG 200 (iOS apple-touch-icon 자동 링크)
4. viewport themeColor 적용(모바일 상태바 teal), viewportFit=cover로 safe-area 대응(디자인 safe-bottom 정합)
5. `npm run typecheck` 통과, `npm run build` 성공(매니페스트·아이콘 라우트 빌드)
6. 기존 렌더·i18n 누수 가드(messages={{}}) 무변경 — 회귀 0

## 검증
- build 후 .next에 manifest/icon/apple-icon 라우트 생성 확인
- typecheck
- (가능 시) 로컬 dev에서 /manifest.webmanifest·/icon.svg·/apple-icon HTTP 200
