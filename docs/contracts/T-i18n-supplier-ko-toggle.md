# 계약: 공급자·인증 화면 한국어 전환 (T-i18n-supplier-ko-toggle)

## 배경
공급자(빌라 관리자) 화면이 베트남어로만 렌더된다. 운영자(테오)가 직접 테스트하기 어렵고,
한국인 관리자도 있을 수 있어 **언어 전환** 기능이 필요하다. 기본은 베트남어(vi), 한국어(ko)로 전환 가능.
로그인·회원가입 화면도 한국어를 지원해야 한다.

## 현황 (탐색 결과)
- `next-intl` 완전 배선됨. `messages/ko.json`·`vi.json` 모두 공급자·인증 네임스페이스 100% 번역 완료.
- 막는 지점 2개:
  1. `middleware.ts` 가 공급자/인증 경로에 `locale=vi` 쿠키를 **매 요청 강제** → 사용자 선택을 덮어씀.
  2. 언어 전환 UI 자체가 없음. 공급자 페이지는 `session.user.locale`(가입 기본 vi)로 locale 결정.

## 범위 (수정 파일 — 이 파일들만 스테이징)
- `lib/locale.ts` (신규) — `getSupplierLocale()` 헬퍼: `pref-locale` 쿠키 > 계정 locale > vi
- `components/locale-switcher.tsx` (신규) — 클라이언트 전환 토글(VI/KO), 우측 상단 고정
- `app/api/locale/route.ts` (신규) — 로그인 사용자 locale DB 영속 + AuditLog(UPDATE User)
- `middleware.ts` — 공급자/인증 경로 locale 쿠키를 `pref-locale` 우선으로 산출(vi 기본 유지)
- `app/(supplier)/layout.tsx` — 전환 토글 마운트 + locale 산출을 헬퍼로 교체
- `app/(auth)/layout.tsx` — 전환 토글 마운트(우측 상단)
- 공급자 RSC 페이지 locale 산출 헬퍼 교체:
  `my-villas/page`, `my-villas/[id]/page`, `my-villas/[id]/amenities/page`,
  `calendar/page`, `cleaning/page`, `cleaning/[id]/page`, `earnings/page`, `guide/page`
- `app/(auth)/login/page.tsx`·`signup/page.tsx` — 탭 타이틀 metadata 현지화(선택)
- `app/layout.tsx` — `<html lang>` 를 locale 쿠키 기반 동적화(접근성)

## 수정 금지 구역 (다른 세션 작업 중)
- `app/(admin)/messages/page.tsx`, `app/api/zalo/**`, `lib/zalo*.ts`, `lib/cleaning.ts`,
  `lib/hold.ts`, `lib/proposal.ts`, `lib/zalo-inbound.ts`, `tests/zalo-*` — **건드리지 않음**
- `messages/ko.json`·`vi.json` — 추가 키 불필요(이미 완비). 수정하지 않음
- `prisma/schema.prisma` — `User.locale` 이미 존재. 마이그레이션 없음

## 완료 기준 (테스트 가능)
1. 로그인 화면 우측 상단 토글로 KO 선택 → 화면 즉시 한국어. VI 선택 → 베트남어.
2. 회원가입 화면 동일.
3. 공급자 로그인 후 모든 화면(빌라/캘린더/청소/수익/가이드) 우측 상단 토글로 KO↔VI 즉시 전환.
4. 새로고침·재방문 시 선택 언어 유지(쿠키 1년). 로그인 사용자는 DB에도 반영.
5. 운영자(ADMIN) 대시보드는 영향 없음(ko 유지). 마진·판매가 누수 없음(클라이언트 직렬화 화이트리스트 유지).
6. `npm run lint && npm run typecheck` 통과.

## 검증 방법
- 로컬 typecheck/lint. 가능 시 Playwright로 프로덕션 토글 동작 확인.
- QA: 권한·누수 체크리스트(공급자 클라이언트 payload에 adminXxx 미포함).
