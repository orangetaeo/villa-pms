# 계약: T-admin-villa-register — ADMIN 빌라 직접 등록 (공급자 선택 귀속)

> 착수: 2026-06-22 / 담당: BE+UX-VN(본 세션) / 상태: 선점

## 배경
테오 팀이 빌라 데이터를 직접 수집(메모리 villa-data-collection-expansion). 현재 `POST /api/villas`는
SUPPLIER 전용이고 `/my-villas/new`도 ADMIN을 `/`로 redirect → ADMIN(테오)이 빌라를 등록할 수 없다.
`Villa.supplierId`는 **필수**이므로 ADMIN 등록 시 귀속 공급자를 정해야 한다.

**테오 결정(2026-06-22): 등록 시 공급자 목록에서 선택.** (placeholder 전용계정 방식 채택 안 함)

## 범위 (additive only, 스키마 변경 0건)
1. `POST /api/villas` — ADMIN도 허용. ADMIN이면 `body.supplierId` 필수(검증: 존재하는 role=SUPPLIER User).
   SUPPLIER면 기존대로 세션 id 강제(바디 supplierId 무시). AuditLog actor=세션 사용자 + 귀속 supplierId 기록.
2. `lib/villa-schema.ts` — `supplierId` optional 필드 추가(서버에서 role별 처리).
3. `app/(supplier)/my-villas/new/page.tsx` — ADMIN 진입 허용. ADMIN이면 prisma로 공급자 목록 조회해 wizard에 전달.
4. `villa-wizard.tsx` / `wizard-types.ts` / `step-basic.tsx` — ADMIN 전용 공급자 `<select>` (필수 검증), state.supplierId 추가, POST 바디에 포함.
5. `messages/ko.json`·`vi.json` — 키 추가만(공급자 선택 라벨/플레이스홀더/검증). 빠른 커밋.

## 수정 금지 구역 (다른 세션 미커밋)
- `app/(admin)/messages/*`, `app/api/zalo/*`, `lib/zalo-*`, `lib/cleaning.ts`, `lib/hold.ts`, `lib/proposal.ts`,
  `prisma/schema.prisma`, `docs/DESIGN.md`, `design/stitch/a16-sales-info-vi/` (TDA 판매정보 폼 — 본 태스크와 별개)
- `messages/ko.json`은 **추가만**, 다른 세션 미커밋분 휩쓸지 않도록 커밋 직전 재확인.

## 완료 기준 (테스트 가능)
1. ADMIN이 `/my-villas/new` 진입 가능(redirect 안 됨), 공급자 선택 UI 노출.
2. ADMIN 공급자 미선택 제출 → 차단(검증 메시지).
3. ADMIN 공급자 선택+등록 → 201, `villa.supplierId`=선택 공급자, `status=PENDING_REVIEW`, AuditLog 기록.
4. SUPPLIER 등록 회귀 없음(세션 강제, 바디 supplierId 무시).
5. ADMIN이 비SUPPLIER id를 supplierId로 전송 → 검증 실패(400).
6. `npm run typecheck` + build 통과. i18n ko/vi 키 동등.

## QA
누수 점검(본 기능 마진·판매가 노출 없음 — 물리적 등록 데이터만), route 첫 줄 role 검사, supplierId 위조 차단.
