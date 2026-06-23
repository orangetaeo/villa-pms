# 계약 — S-RBAC-1: 운영자 권한 골격 (스키마 + permissions.ts)

- 출처: ADR-0013 (채택). 담당: TDA. 날짜: 2026-06-23
- 전략: **additive** — 빌드 무중단. ADMIN 값 유지, 새 역할 추가, 코드 치환은 S-RBAC-2.

## 범위 (이 계약에서 손대는 파일 — 이것만)

1. `prisma/schema.prisma` — `enum Role`에 `OWNER`, `MANAGER`, `STAFF` 추가. **ADMIN·SUPPLIER·CLEANER 유지.** additive 버전 주석 1줄.
2. `lib/permissions.ts` — **신규**. capability 헬퍼:
   - `export type Role = "OWNER" | "MANAGER" | "STAFF" | "ADMIN" | "SUPPLIER" | "CLEANER";`
   - `isOperator(r)` → OWNER·MANAGER·STAFF·**ADMIN**(transition)
   - `canViewFinance(r)` → OWNER·MANAGER·**ADMIN**
   - `isSystemAdmin(r)` → OWNER·**ADMIN**
   - `canOverrideGate(r)` → OWNER·MANAGER·**ADMIN**
   - `canSetPrice(r)` → OWNER·MANAGER·**ADMIN**
   - 각 함수 위에 "ADMIN은 transition 동안 OWNER와 동일 취급, S-RBAC-2서 제거" 주석.
3. `types/next-auth.d.ts` — `UserRole` 유니온에 OWNER·MANAGER·STAFF 추가(ADMIN 유지). 가능하면 `lib/permissions.ts`의 `Role`을 import해 단일 출처화.
4. `prisma db push` 실행 (이 프로젝트는 migrations 파일 없음) → enum 값 추가 반영.

## 수정 금지 구역 (다른 작업·후속 스프린트)

- `lib/cleaning.ts`, `lib/hold.ts`, `lib/proposal.ts`, `messages/ko.json`, `messages/vi.json` (working tree에 타 작업 pending — 건드리지 말 것)
- `middleware.ts`, `app/api/**`, `app/(admin)/**`, `lib/dashboard.ts` (role 비교 치환은 **S-RBAC-2**)
- 데이터 마이그레이션(ADMIN row → OWNER)·ADMIN enum 제거는 **이 계약 범위 아님** (S-RBAC-2/final). 기존 ADMIN 계정은 그대로 두고 permissions.ts가 OWNER와 동일 취급.

> **승인된 예외 (2026-06-23)**: enum additive 확장이 `app/(admin)/users/page.tsx:55` 한 곳을 깨뜨림
> (`users-manager.tsx`의 좁은 UserRow.role 유니온 때문). "빌드 무중단"이 최우선 지시이므로
> 해당 1줄만 `role: u.role as UserRow["role"]` 캐스트(transition 주석 포함)로 예외 허용.
> OWNER/MANAGER/STAFF 계정이 0개라 무해. UserRow 정식 확장·뱃지·i18n은 S-RBAC-3.

## 완료 기준 (테스트 가능)

- [ ] `npx prisma db push` 성공, `Role`에 6개 값 존재
- [ ] `npm run typecheck` 통과 (기존 ADMIN 참조 ~40곳 깨지지 않음)
- [ ] `npm run build` 통과
- [ ] `lib/permissions.ts` 6개 함수 export, ADMIN이 OWNER 경로에 포함됨을 단위 테스트(`tests/permissions.test.ts`)로 확인:
      `canViewFinance("STAFF")===false`, `canViewFinance("MANAGER")===true`, `isSystemAdmin("MANAGER")===false`, `isOperator("STAFF")===true`, `isSystemAdmin("ADMIN")===true`
- [ ] 기존 로그인·권한 동작 불변 (ADMIN 계정이 모든 운영 화면 접근 — 회귀 없음)

## 검증 방법

- typecheck + build + `npx tsx --test tests/permissions.test.ts`(또는 프로젝트 테스트 러너)
- QA: 권한 누수 회귀 — ADMIN 계정 기존 접근 그대로인지(additive라 변화 없어야 함)

## 커밋 규칙

- pathspec 명시: `git add prisma/schema.prisma lib/permissions.ts types/next-auth.d.ts tests/permissions.test.ts docs/contracts/S-RBAC-1.md docs/decisions/ADR-0013-operator-rbac-tiers.md docs/INDEX.md`
- `git add -A` 금지. 수정 금지 구역 파일이 staged에 섞이면 unstage.
