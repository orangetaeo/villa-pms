# 계약 — S-RBAC-2: API 라우트 권한 capability 치환 + 누수 테스트

- 출처: ADR-0013 (채택). 선행: S-RBAC-1(완료, 45ad21c). 담당: BE → QA. 날짜: 2026-06-23
- 목표: `app/api/**`의 `role === "ADMIN"` 비교(~57곳)를 `lib/permissions.ts` 헬퍼로 치환.
  ADMIN은 여전히 모든 헬퍼에 포함되어 **기존 ADMIN 동작 불변**. MANAGER/STAFF 경로가 비로소 열림.

## ⚠️ 시퀀싱 경고 (반드시 인지)

- 이 스프린트는 예약·검수 등 **운영 라우트 접근을 STAFF/MANAGER까지 넓힌다**. 하지만
  예약 상세 응답에는 KRW(판매가)가 들어있어, STAFF 응답 **필드 마스킹은 S-RBAC-3** 몫이다.
- 따라서 **실제 STAFF/MANAGER 계정 생성(S-RBAC-4)은 S-RBAC-3 완료 후**. 현재 그런 계정이 0개라
  S-RBAC-2 단계에서 실제 누수는 없다(전부 ADMIN). 이 단계는 "권한 배선"이지 "계정 오픈"이 아니다.

## 치환 규칙 (헬퍼는 `@/lib/permissions`에서 import)

- `if (role !== "ADMIN") return 401/403` → `if (!CAP(role)) return 동일응답` (CAP은 아래 표)
- `if (role === "ADMIN") { …전체조회… } else if (SUPPLIER) {…}` → `if (isOperator(role)) {…}` (ADMIN 분기를 isOperator로)
- `role !== "SUPPLIER" && role !== "ADMIN"` (SUPPLIER+ADMIN 허용) → `role !== "SUPPLIER" && !isOperator(role)` (운영자 전체 허용)
- **응답 본문·상태코드·에러 메시지는 변경 금지** — 권한 술어만 교체. 동작 동일성 유지.

## 라우트 → capability 매핑표 (기본값. ✱=BE 판단·보고 필요)

### isSystemAdmin (OWNER 전용)
- `users/route.ts`, `users/[id]/route.ts` — 계정 관리
- `settings/route.ts` — 시스템 설정
- `zalo/qr/route.ts`, `zalo/status/route.ts` — Zalo **계정 연결/세션 관리**(응대 아님)
- `seasons/route.ts`, `seasons/[id]/route.ts` — **요율 마스터 변경**(ADR 매트릭스: OWNER만)
- ✱`cost-alerts/dismiss/route.ts` — 비용 알림(시스템 모니터링). isSystemAdmin 제안, 이견 시 보고

### canViewFinance (OWNER/MANAGER)
- ✱`settlements/route.ts`, `settlements/[id]/route.ts` — **GET 조회 = canViewFinance**.
  단 같은 파일의 **정산 확정/승인 동작(POST/PATCH)** 이면 그 핸들러만 **isSystemAdmin**(OWNER 전용).
  GET/mutation 핸들러를 구분해 각각 적용하고, 어떻게 나눴는지 보고.

### canSetPrice (OWNER/MANAGER)
- `proposals/route.ts`, `proposals/[id]/route.ts`, `proposals/candidates/route.ts` — 제안링크·가격
- `villas/[id]/sales/route.ts` — KRW 판매가 설정
- `villas/[id]/rates/route.ts` — 빌라별 요율 **적용**(마스터 변경 seasons와 구분)

### canOverrideGate (OWNER/MANAGER)
- `villas/[id]/force-sellable/route.ts` — 검수 게이트 오버라이드(위험작업)

### isOperator (OWNER/MANAGER/STAFF)
- 예약: `bookings/[id]/route.ts`·`agreement`·`checkout`·`checkin`·`cancel`·`confirm`·`tamtru`
  - `confirm`(입금확인)도 isOperator. **금액 마스킹은 S-RBAC-3**, 이 단계는 접근만.
  - ✱`bookings/[id]/services/route.ts` — 부가서비스(Phase 2). 가격 변경이면 canSetPrice, 단순 운영이면 isOperator. 보고
- 청소: `cleaning-tasks/route.ts`(ADMIN 분기)·`submit`·`reject`·`approve`
- 검수/여권: `passports/[name]/route.ts`·`ocr/passport`·`uploads/passport`
- 빌라(운영자측): `villas/[id]/route.ts`·`villas/[id]/availability-checked`
- 빌라 공유(SUPPLIER+ADMIN): `villas/route.ts`(ADMIN 분기)·`villas/[id]/photos`·`uploads/route.ts`
- 캘린더(SUPPLIER+ADMIN): `calendar-blocks/route.ts`·`[id]`·`bulk`
- Zalo **응대**: `zalo/messages/route.ts`·`zalo/translate`·`zalo/transcribe`·`zalo/conversations/[id]`·`zalo/conversations/[id]/share`·`zalo/messages/[id]/translate-photo`
- ✱`services/[id]/route.ts` — 부가서비스 마스터(Phase 2). 가격이면 canSetPrice, 아니면 isOperator. 보고

## 수정 금지 구역

- `middleware.ts`(경로 게이트 = S-RBAC-3), `app/(admin)/**` UI·`lib/dashboard.ts`(필드 마스킹 = S-RBAC-3)
- `lib/permissions.ts`(시그니처 변경 금지, import만), schema, ADMIN enum 제거
- 다른 세션 pending: `lib/cleaning.ts`·`lib/hold.ts`·`lib/proposal.ts`·`messages/*.json`·`docs/DESIGN.md`
  - 단, `cleaning-tasks` **route**(app/api)는 본 계약 대상. `lib/cleaning.ts`는 건드리지 말 것(별개)

## 완료 기준 (테스트 가능)

- [ ] `app/api/**`에 `=== "ADMIN"`/`!== "ADMIN"` 잔존 0 (grep 확인). 단 SUPPLIER/CLEANER 관련 비교는 유지
- [ ] `npm run typecheck`·`npm run build` 통과
- [ ] `tests/permissions-routes-leak.test.ts` 신규 — 대표 라우트별 권한 행렬 검증(핸들러 함수 직접 호출 또는 기존 테스트 방식):
  - STAFF → 재무(settlements GET·sales·proposals·rates) **차단**
  - STAFF → 운영(bookings confirm·checkin·cleaning approve·calendar-blocks) **허용**
  - MANAGER → 재무 **허용**, 시스템(users·settings·seasons·force-sellable 중 isSystemAdmin것) **차단**, force-sellable(canOverrideGate) **허용**
  - OWNER/ADMIN → 전부 허용 (회귀 없음)
- [ ] 보고서에 ✱ 항목(settlements 분리·cost-alerts·services·bookings/services) 최종 결정 명시

## 커밋

- pathspec 명시(app/api/** 변경분 + tests/permissions-routes-leak.test.ts + 본 계약서). `git add -A` 금지.
- 금지 구역 파일이 staged에 섞이면 unstage.
