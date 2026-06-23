# 계약 — S-RBAC-4: 계정 생성·역할부여 UI (OWNER 전용) + 역할명 i18n

- 출처: ADR-0013(채택). 선행: S-RBAC-1·2·3(완료). 담당: FE → QA. 날짜: 2026-06-23
- 목표: OWNER(테오)가 **실제로 MANAGER·STAFF·SUPPLIER·CLEANER 계정을 만들고 역할을 바꿀 수 있게** 한다.
  `/users` 페이지는 이미 `isSystemAdmin`(OWNER) 게이트(S-RBAC-2/3) 아래 있음.

## A. API — `app/api/users/route.ts` POST 신규 + `[id]/route.ts` CHANGE_ROLE 액션

### A1. `POST /api/users` (계정 생성)
- 권한: `isSystemAdmin(role)` (OWNER만). 미인증 401 / 비OWNER 403.
- body(zod): `{ name: string(min1), phone: string, password: string(min8), role: 부여가능역할, locale?: "ko"|"vi" }`
- **부여 가능 역할 = MANAGER · STAFF · SUPPLIER · CLEANER** (OWNER·ADMIN은 UI로 생성 불가 — 권한상승 표면 차단·단일 OWNER 유지). 화이트리스트 외 400.
- phone **숫자 정규화** 후 저장(메모리 phone-digit-normalization: 로그인은 정확매칭, 폼이 비숫자 제거 → 시드/생성 전화는 숫자형식이어야 로그인됨). 빈/중복 phone → 409 PHONE_TAKEN(`phone @unique`).
- password: `bcryptjs`로 해시(auth.ts와 동일 라이브러리). passwordHash 저장, 응답엔 절대 미포함.
- locale 기본: SUPPLIER/CLEANER=vi, MANAGER/STAFF=ko(운영자) — 합리적 기본, body로 덮어쓰기 가능.
- `isActive: true`로 생성. **감사 로그 CREATE User**(writeAuditLog, 글로벌 절대규칙) — changes에 role·name·phone(비밀번호 제외).
- 응답: 생성 user select 화이트리스트(id·role·name·phone·isActive·createdAt). 201.

### A2. `PATCH /api/users/[id]` — `CHANGE_ROLE` 액션 추가
- 기존 discriminatedUnion에 `{ action: "CHANGE_ROLE", role: 부여가능역할 }` 추가.
- 권한 동일(isSystemAdmin). **가드**:
  - 본인 역할 변경 금지: `id === session.user.id` → 400 `CANNOT_CHANGE_OWN_ROLE`(자기 강등·락아웃 방지).
  - 부여 가능 역할 화이트리스트(MANAGER/STAFF/SUPPLIER/CLEANER). OWNER/ADMIN로 변경 불가.
  - **빌라 고아 방지**: 대상이 현재 SUPPLIER이고 villas 보유(>0)인데 비SUPPLIER로 변경 시 → 409 `HAS_VILLAS`(villa.supplierId 스코프 깨짐 방지). 명확한 에러로 반환.
  - 트랜잭션 내 처리 + **감사 로그 UPDATE**(role old→new).
- 응답에 변경된 role 포함.

## B. UI — `app/(admin)/users/page.tsx` + `users-manager.tsx`

### B1. UserRow.role 확장 (S-RBAC-1 transition 캐스트 제거)
- `users-manager.tsx` `UserRow.role` 타입을 `@/lib/permissions`의 `Role`(6값)로 교체.
- `ROLE_BADGE_CLASS`·`AVATAR_CLASS` Record에 **OWNER·MANAGER·STAFF 색 추가**(DESIGN.md 역할 시맨틱: 예 OWNER=amber, MANAGER=indigo, STAFF=slate/green — 6역할 전부 키 존재해야 Record 타입 충족).
- `page.tsx`의 `role: u.role as UserRow["role"]` 캐스트를 `role: u.role`로 환원(이제 타입 일치).

### B2. 계정 생성 폼 (OWNER)
- "사용자 추가" 버튼(헤더, 현재 미구현 자리 L359 주석) → 모달/패널.
- 필드: 이름, 전화번호, 비밀번호, 역할 select(MANAGER/STAFF/SUPPLIER/CLEANER). 제출 → `POST /api/users` → `router.refresh()`.
- 에러 매핑: 409 PHONE_TAKEN, 400 VALIDATION(min8 등) → i18n 메시지. 성공 토스트.

### B3. 역할 변경 (OWNER)
- 역할 컬럼 또는 행 액션에 역할 변경 진입(select 또는 작은 메뉴). 본인 행은 비활성(self-guard, selfId 이미 props).
- 확정 시 `PATCH {action:"CHANGE_ROLE", role}` → refresh. 409 HAS_VILLAS·400 CANNOT_CHANGE_OWN_ROLE → i18n 에러.
- (선택) 역할 탭에 MANAGER/STAFF 추가 — 운영자 필터. 과하면 생략 가능.

## C. i18n — ko + vi **추가만** (스테이징은 오너 세션이 hunk 선별)

`adminUsers.roles`에 **OWNER·MANAGER·STAFF** 추가(ko: 오너/매니저/직원 또는 적절어, vi 동등). 새 UI 문자열:
- `adminUsers.addUser.*`(버튼·모달제목·필드라벨·제출·취소·성공), `adminUsers.roleChange.*`(라벨·확인·성공), 에러 키(`errors.phoneTaken`·`errors.passwordTooShort`·`errors.hasVillas`·`errors.cannotChangeOwnRole`).
- **ko·vi 동시 추가 필수**(메모리 admin-screens-need-vi-json·all-pages-vietnamese-required — 미추가 시 키 원문 깨짐). 키 누락 0.
- ⚠️ **messages/ko.json·vi.json은 다른 세션이 수정 중** — 키 **추가만** 하고 **stage/commit 하지 말 것**(오너 세션이 surgical staging). 기존 키 수정·삭제·재배열 금지.

## D. 수정 금지 구역

- `lib/permissions.ts`(시그니처), `prisma/schema.prisma`, ADMIN enum 제거(=S-RBAC-final), middleware·layout(S-RBAC-3 완료분), S-RBAC-2 권한 술어.
- 다른 세션 pending: `lib/cleaning.ts`·`lib/hold.ts`·`lib/proposal.ts`·`docs/DESIGN.md`·`app/(admin)/messages/*`. messages/*.json은 **추가만**(C 규칙).

## E. 완료 기준 (테스트 가능)

- [ ] OWNER가 `POST /api/users`로 STAFF·MANAGER·SUPPLIER·CLEANER 생성 가능, 비밀번호 해시 저장·응답에 해시 부재, 중복 phone 409, role 화이트리스트 외 400, 감사로그 기록.
- [ ] `CHANGE_ROLE`: 본인 400, SUPPLIER+빌라보유 비SUPPLIER 변경 409, 정상 변경 OK + 감사로그.
- [ ] UserRow.role=Role(6값), page.tsx 캐스트 제거, 6역할 뱃지·아바타 렌더(타입 충족).
- [ ] 생성한 STAFF 계정으로 **로그인 가능**(phone 숫자정규화 일치) — 시드/수동 확인.
- [ ] i18n: roles.OWNER/MANAGER/STAFF + addUser·roleChange 문자열 ko·vi 양쪽 존재(키 누락 0).
- [ ] `npm run typecheck`·build 통과. 기존 권한/마스킹 테스트 회귀 0. 신규 `tests/users-create-role.test.ts`(POST·CHANGE_ROLE 가드 단위).
- [ ] **커밋·스테이징 금지** — 변경만 하고 보고(오너 세션이 surgical staging + 커밋).

## F. 검증

- 역할 가드 단위 테스트 + (권장) QA Playwright: OWNER로 STAFF 생성 → 로그아웃 → STAFF 로그인 → 예약상세 KRW 부재(S-RBAC-3 연계) 육안.
