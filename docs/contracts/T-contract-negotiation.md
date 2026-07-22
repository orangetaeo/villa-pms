# T-contract-negotiation — 계약 조항 협의(네고) 루프 (S2)

> 상태: **착수 선점** · 작성 2026-07-22
> 담당: TDA(스키마) → BE(API·알림) → UX-VN(포털 UI) → FE(관리자 패널) → LOC(ko/vi) → QA
> 워크트리: `.claude/worktrees/cancel-tiers`, branch `worktree-cancel-nego` (S1 `worktree-cancel-tiers` 위에 스택)
> 기획 원본: `docs/plans/supplier-cancellation-tiers-negotiation.md` §5.4 **C안 채택**

## 1. 배경

현재 계약은 `DRAFT → SENT → SIGNED`뿐이라 상대방은 **서명하거나 안 하거나** 둘 중 하나다. 조건이 마음에 안 들면 아무 일도 일어나지 않고, 협의는 Zalo 채팅으로 흩어져 **어느 조항에 대한 이의였는지 이력이 남지 않는다**. S1에서 취소 단계표를 "제안"으로 넣었으므로, 그 제안을 되받을 창구가 없으면 반쪽이다.

**C안 채택 근거(A·B 대비):** A(오프라인 Zalo)는 증빙·조항 특정이 안 된다. B(`BusinessContractStatus`에 `NEGOTIATING` 추가)는 enum ALTER + 전 switch 영향이라 되돌리기 비싸다. C는 **테이블 1개 additive**로 끝나고, 서명 차단은 상태가 아니라 "미해결 협의 존재" **파생 판정**이라 롤백이 쉽다.

## 2. 범위 (IN)

1. **`ContractNegotiation` 모델**(additive raw SQL, Prisma 관계 미설정 — `BusinessContract` 관례 동일)
   - `contractId, clauseKey, reason, proposedJson?, note?, status(OPEN|ACCEPTED|REJECTED), createdById, resolvedById?, resolvedNote?, createdAt, resolvedAt?`
   - `status`·`clauseKey`·`reason`은 **String + zod 화이트리스트**(enum ALTER 회피 — 값 추가가 잦을 영역)
2. **상대방 협의 요청** `POST /api/business-contracts/[id]/negotiations`
   - 게이트: 본인 계약 + `status=SENT`만. 같은 조항에 OPEN이 이미 있으면 409(중복 스팸 차단)
   - ★ 베트남 UX: **자유 서술 강요 금지** — 조항 선택 + 프리셋 사유 칩 + (취소표는) 숫자 역제안. 메모는 선택
   - 취소 단계표 역제안은 **S1과 동일한 `cancelTiersSchema`로 검증**(회사 손실 상한 포함). 상한을 넘는 요구는 `OTHER` + 메모로 표현
3. **서명 게이트** — OPEN 협의가 있으면 `sign` 라우트 409(`NEGOTIATION_OPEN`) + 포털 서명 폼 대신 "협의 진행 중" 안내
4. **관리자 해소** `POST /api/admin/business-contracts/[id]/negotiations/[negId]`
   - `ACCEPT`(+선택 `terms`) → termsJson 갱신(SIGNED·VOID는 불가) + 협의 ACCEPTED / `REJECT`(+사유) → REJECTED
   - `canViewFinance` 게이트, 감사 로그 필수
5. **알림 2종**(신규 NotificationType — `docs/NOTIFICATIONS.md` 동시 갱신)
   - `CONTRACT_NEGOTIATION_REQUEST` → 운영자(ko), `GROUP_ROUTED_TYPES` 등재
   - `CONTRACT_NEGOTIATION_RESOLVED` → 상대방(payload.locale ko/vi)
6. **화면** — 포털 계약 카드에 협의 요청 폼 + 내 협의 이력, 관리자 계약 상세에 협의 패널(수용/거절)
7. i18n ko+vi 동시, 테스트

## 3. 비범위 (OUT)

- `BusinessContractStatus` enum 변경 (파생 판정으로 대체)
- 조항별 자유 편집기(운영자는 기존 계약 수정 경로 사용) · 다자 협의 · 첨부파일
- 고객(게스트) 정책 5단계 확장 + 취소 시 지급액 자동 산출 (**S3**)

## 4. 완료 기준 (테스트 가능)

1. 공급자가 SENT 계약에서 「취소 조건 협의」 → 프리셋 사유 + 역제안 단계표 제출 → 201, 운영자 Zalo 통지 1건.
2. 같은 조항 재요청 → 409(중복 차단). 다른 조항은 허용.
3. OPEN 협의가 있는 동안 서명 시도 → **409 `NEGOTIATION_OPEN`**, 포털에 서명 폼 미표시.
4. 운영자 수용(terms 포함) → 계약 termsJson 갱신 + 협의 ACCEPTED + 상대방 통지 + 감사 로그 1행 → 포털 재조회 시 **새 조건이 본문에 반영**되고 서명 가능.
5. 운영자 거절(사유) → REJECTED + 사유가 상대방 화면에 노출 + 서명 가능.
6. 남의 계약에 협의 요청 → 403. SIGNED 계약에 협의 요청 → 409.
7. 역제안이 회사 손실 상한 위반 → 400.
8. `npm run typecheck` + `next build` + 전체 테스트 통과.

## 5. 검증 방법

QA 독립 평가: 위 8개 + 권한 누수(타 계약·원가·마진 미노출) 확인. 작성자 자기평가 무효.

## 6. 점유/수정 파일

- 신규: `lib/contract-negotiation.ts`, `lib/contract-negotiation-notify.ts`, `app/api/business-contracts/[id]/negotiations/route.ts`, `app/api/admin/business-contracts/[id]/negotiations/[negId]/route.ts`, `components/business-contract/negotiation-panel.tsx`, `app/(admin)/contracts/[id]/negotiation-actions.tsx`, `prisma/migrations-manual/2026-07-22-contract-negotiation.sql`, `tests/contract-negotiation.test.ts`
- 수정: `prisma/schema.prisma`(★ additive only), `lib/zalo.ts`(case 2종), `lib/operator-notify.ts`(화이트리스트 1줄), `app/api/business-contracts/mine/route.ts`, `app/api/business-contracts/[id]/sign/route.ts`, `components/business-contract/counterpart-contract-view.tsx`, `app/(admin)/contracts/[id]/page.tsx`, `messages/{ko,vi}.json`, `docs/NOTIFICATIONS.md`
- **수정 금지 구역**: `prisma/schema.prisma`의 `Villa`·`VillaClip`·`VillaPhoto` 영역 — **타 세션(villa-clip-narration P1)이 메인 폴더에서 작업 중**. 파일 끝에 append만 한다
- ★ 공유 `node_modules` 회피: 이 워크트리는 **자체 node_modules를 설치**(npm ci)해 `prisma generate`가 타 세션 타입을 되돌리지 않게 한다 ([[shared-node-modules-generate-race]])
