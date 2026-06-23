# 계약 — S-RBAC-3: 경로 게이트 + STAFF 재무 마스킹 + 역할별 대시보드

- 출처: ADR-0013(채택). 선행: S-RBAC-1(45ad21c)·S-RBAC-2(40444b7). 담당: FE → QA. 날짜: 2026-06-23
- 목표: STAFF/MANAGER가 운영 화면에 **들어올 수 있게** 하되, STAFF에게는 **돈(판매가·마진·정산·매출통계)을 화면·응답 모두에서 가린다.**

## 핵심 원칙 (한 줄)

**STAFF 재무 가시성 = SUPPLIER와 동일(원가 VND만).** 판매가(KRW·VND)·마진·정산금액·매출/이윤을
차단하면 마진(=판매가−원가)이 자동으로 숨겨진다. → **기존 SUPPLIER cost-only select 패턴 재사용.**
게이트 술어: 판매가/마진/정산/통계 = `canViewFinance(role)`(OWNER/MANAGER/ADMIN). 원가(VND)는 STAFF도 OK.

> ⚠️ 클라이언트 조건부 렌더만으로는 누수(ADR-0011 wifiPassword 교훈). **서버 select에서 제외**가 1차, 클라 숨김은 2차 방어.

## A. 경로 게이트 — middleware.ts + admin layout

### A1. `app/(admin)/layout.tsx`
- 현재: `if (!session || session.user?.role !== "ADMIN") redirect("/login")`
- 변경: `import { isOperator } from "@/lib/permissions"` → `if (!session?.user?.id || !isOperator(session.user.role)) redirect("/login")`
- 즉 OWNER/MANAGER/STAFF/ADMIN 모두 운영 영역 진입 허용. (마스킹은 각 화면이 책임)

### A2. `middleware.ts` — 경로별 capability 게이트로 재구성 (`@/lib/permissions` import)
운영 영역 경로를 3등급으로:
- **isSystemAdmin(OWNER만)**: `/users`, `/settings`
- **canViewFinance(OWNER/MANAGER)**: `/settlements`, `/cost-alerts`, `/proposals` (제안=가격), `/earnings`
- **isOperator(전체 운영자)**: `/dashboard`, `/villas`, `/bookings`, `/inspections`, `/messages`, `/calendar`, `/cleaning`, `/my-villas`
- 미인증·역할부족 시 기존과 동일하게 `/login` 리다이렉트. locale 쿠키 로직은 보존.
- 기존 `ADMIN_ONLY_PATHS`/`ROLE_ALLOWED_PATHS` 구조를 위 등급표로 교체. SUPPLIER/CLEANER 경로 규칙 유지.

> 결과: STAFF는 `/settlements`·`/cost-alerts`·`/proposals`·`/users`·`/settings` 페이지 자체에 진입 불가(coarse 차단). MANAGER는 재무 OK, 시스템(users/settings)만 차단.

## B. STAFF 필드 마스킹 — 화면 + 피드 select (canViewFinance 분기)

각 server component에서 `const showFinance = canViewFinance(session.user.role)` 구하고, prisma select와 렌더를 분기.

### B1. 예약 상세 `app/(admin)/bookings/[id]/page.tsx` (L50-81 select, L108·L267 렌더)
- STAFF: `totalSaleKrw`·`totalSaleVnd` **select 제외 + 렌더 제외**. `supplierCostVnd`는 유지(원가 OK).
- "가격 스냅샷" 섹션: showFinance=false면 판매가 행 숨김(원가만 표시).
- 입금확인 버튼/플로우는 유지하되 **금액 숫자 비표시**(§6.1 — 상태만). 🟢/🔴 자동매칭 위젯은 Phase 2이므로 이번엔 "확정 처리" 액션만, 금액 미노출.

### B2. 빌라 상세 요율 `app/(admin)/villas/[id]/page.tsx`(L85-92) + `rate-editor.tsx`
- STAFF: `rates`의 `salePriceVnd`·`salePriceKrw`·`marginType`·`marginValue` **select 제외**. `supplierCostVnd`만.
- RateEditor는 **편집 권한이 가격설정**(canSetPrice)이므로 STAFF에겐 **읽기전용 원가 뷰**로 강등하거나 섹션 숨김. 최소: showFinance=false면 요율 편집 UI 미렌더(원가 목록만 또는 섹션 생략).

### B3. 대시보드 `app/(admin)/dashboard/page.tsx` + `lib/dashboard.ts`
- `lib/dashboard.ts` `loadDashboardStats`는 금액을 안 싣지만 `settlementPendingCount`(정산 신호)를 포함. STAFF에는 이 카운트·관련 위젯 비표시.
- 대시보드 페이지: showFinance=false면 정산/매출 성격 위젯(있다면) 제거, 운영 큐(체크인·체크아웃·청소대기·홀드)만. **lib/dashboard.ts 시그니처는 가급적 불변** — 페이지단에서 위젯 조건부 렌더로 처리(파일 충돌 최소화).

### B4. 빌라 목록 `app/api/villas/route.ts`(GET)
- 현재 운영자(isOperator) 분기가 `rates`에 `salePriceKrw` 포함(L181-192). STAFF면 SUPPLIER select(원가만, L217-220)와 동일하게. 즉 `isOperator && canViewFinance`면 판매가 포함, STAFF면 원가만.

### B5. 검증만(이미 안전 — 수정 불필요, 확인 후 보고)
- `/p/[token]` 공개페이지(고객 KRW 정상), `app/(admin)/villas/page.tsx` 목록(rates 미select), `/api/proposals` GET(판매가만), `messages` 공유 후보(상대타입별 분기). STAFF가 이들에 도달 가능한지/누수 없는지만 확인.
- proposals/new·settlements·cost-alerts 화면은 A2에서 STAFF 진입차단되므로 내부 마스킹 불필요(이중방어 원하면 페이지 상단 canViewFinance 가드 1줄 추가 가능).

## C. 수정 금지 구역

- `lib/permissions.ts` 시그니처 변경 금지(import만). 필요한 술어는 이미 있음(canViewFinance/isSystemAdmin/isOperator/canSetPrice).
- `prisma/schema.prisma`, ADMIN enum 제거, S-RBAC-4(계정생성 UI)
- 다른 세션 pending: `lib/cleaning.ts`·`lib/hold.ts`·`lib/proposal.ts`·`messages/*.json`·`docs/DESIGN.md`
- `app/api/**`의 S-RBAC-2 권한 술어(이미 완료) — B4 villas select 분기만 추가, 권한 술어는 건드리지 말 것

## D. 완료 기준 (테스트 가능)

- [ ] STAFF 세션으로: `/settlements`·`/cost-alerts`·`/proposals`·`/users`·`/settings` 진입 시 redirect(미들웨어). `/dashboard`·`/bookings/[id]`·`/villas/[id]`·`/cleaning`·`/calendar` 진입 가능.
- [ ] STAFF의 `/bookings/[id]` 응답·렌더에 `totalSaleKrw`·`totalSaleVnd` **부재**(원가만). MANAGER/OWNER엔 존재.
- [ ] STAFF의 `/villas/[id]` 요율에 `salePrice*`·`margin*` **부재**.
- [ ] STAFF의 `GET /api/villas` 응답 rates에 `salePriceKrw` **부재**.
- [ ] MANAGER는 위 재무 전부 보임 + `/users`·`/settings` 차단.
- [ ] ADMIN(테오) 모든 화면·필드 **불변**(회귀 0).
- [ ] `tests/permissions-masking.test.ts` 신규 — booking/villa select 분기·middleware 등급을 역할별로 검증(서버 함수/술어 단위). middleware 경로등급은 매핑 테이블로 고정.
- [ ] `npm run typecheck`·`build` 통과. 기존 누수 테스트(permissions-routes-leak) 회귀 없음.

## E. 검증 방법

- 역할별(OWNER/MANAGER/STAFF/ADMIN) 단위 테스트 + QA가 Playwright로 STAFF 계정 시뮬레이션(임시 시드)으로 예약상세 KRW 부재 육안 확인.
- QA는 leak-checklist.md 기준 마진·판매가 노출 0 확인. 발견 패턴은 skills/qa에 축적.

## F. 커밋

- pathspec 명시: middleware.ts, app/(admin)/layout.tsx, app/(admin)/bookings/[id]/page.tsx, app/(admin)/villas/[id]/page.tsx, app/(admin)/villas/[id]/rate-editor.tsx, app/(admin)/dashboard/page.tsx, app/api/villas/route.ts, tests/permissions-masking.test.ts, 본 계약서. `git add -A` 금지. 금지구역 staged 혼입 시 unstage.
