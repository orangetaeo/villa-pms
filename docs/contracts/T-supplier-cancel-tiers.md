# T-supplier-cancel-tiers — 공급자 계약 취소 수수료 5단계표 (S1)

> 상태: **착수 선점** · 작성 2026-07-22
> 담당: BE(스키마·렌더) → FE(관리자 폼) → LOC(ko/vi 라벨·정본) → QA
> 워크트리: `.claude/worktrees/cancel-tiers` (branch `worktree-cancel-tiers`, origin/main 기준)
> 기획 원본: `docs/plans/supplier-cancellation-tiers-negotiation.md`

## 1. 배경

테오 2026-07-22 요구 — 체크인 시점별 **고객 환불률 / 공급자 지급률** 5단계표를 빌라 공급자 계약에 넣어 제안한다.
현재 계약 별표2는 2필드(`cancelFreeDays`=14, `cancelPartialPct`=50) 3행 고정이라 5단계 표현이 불가능하다.

**테오 확정 기본값(제안 프리셋):**

| 취소 접수 시점 | 고객 환불 | 공급자 지급 |
|---|---|---|
| 체크인 14일 전까지 | 100% | 0% |
| 8~13일 전 | 80% | 20% |
| 1~7일 전 | 50% | 50% |
| 체크인 당일 | 20% | 80% |
| 노쇼·체크인 후 | 0% | 100% |

설계 근거: 각 단계에서 `고객 위약금률 = 공급자 지급률`이므로 회사 몫은 항상 **마진 × 위약금률** → 어떤 시점에 취소돼도 회사 손실 0, 손실은 공급자와 동일 비율로 분담. 이것이 공급자 설득 논리이자 서버 검증 상한의 근거다.

**기획 §4 쟁점 중 1~3은 권고안대로 확정(테오 "시작해줘"):**
1. 위약금 기준 = **총 예약금액**(부분입금 무관) — 별표2 주석에 명시
2. 환율 변동 = **회사 부담**, 공급자 지급액은 원가(VND) 고정 — 별표2 주석에 명시
3. 부가서비스·티켓 발주분 = **표 적용 제외** — 별표2 주석에 명시
4. 고객 정책 5단계 교체 여부 = **S3로 이월**(본 계약서 범위 아님)
5. 협의 루프(C안) = **S2로 이월**

## 2. 범위 (IN)

1. **termsJson 확장** — `villaSupplyTermsSchema`에 `cancelTiers` 배열 추가(선택 필드).
   - 행 구조 `{ fromDays, guestRefundPct, supplierPayPct }`. `fromDays`=구간 하한만 두어 **구간 겹침·구멍이 구조적으로 불가능**하게 한다. `0`=체크인 당일, `-1`=노쇼·체크인 후.
   - 기존 `cancelFreeDays`·`cancelPartialPct`는 **레거시 호환용으로 존치**(서명 완료 계약 렌더 보존).
2. **정합성 검증(서버·zod superRefine)** — 2~8행, `fromDays` 엄격 내림차순, 마지막 행 `-1` 필수, 첫 행 ≥1, `guestRefundPct` 비증가, `supplierPayPct` 비감소, **`supplierPayPct ≤ 100 − guestRefundPct`(회사 손실 방지 상한)**. 위반 시 400.
3. **정본 렌더** — 별표2의 하드코딩 표를 토큰 `{{cancelTiersTable}}` 하나로 교체. 표(헤더 포함)를 로케일 라벨로 코드가 생성.
   - ★ **레거시 폴백**: `cancelTiers` 부재(기존 계약) → 종전 2열 3행 표를 **문자열까지 동일하게** 재현 → 서명 완료 계약의 렌더 결과 불변(contentHash 증빙 정합 유지).
4. **정본 md ko/vi** — 별표2 교체 + 적용범위·기준금액·환율 3줄 주석 추가, 제5조 3항 기본값 문구를 별표2 참조로 갱신. 내부 초안 `01-villa-supply-agreement.md` 동시 동기.
5. **표준버전** `CURRENT_STANDARD_VERSION` v0.4 → **v0.5**.
6. **관리자 계약 작성 폼** — 빌라 공급 선택 시 5행 티어 편집 UI(기본값 프리셋 자동 채움, 행 추가·삭제, 클라 검증 = 서버 규칙 대칭). 기존 2필드 입력은 폼에서 제거(신규 계약은 티어만 생성).
7. **i18n** — `adminContracts` NS에 티어 라벨 키 ko+vi 동시 추가.
8. **테스트** — `lib/business-contract.test.ts`에 티어 검증·렌더·레거시 폴백 케이스 추가.

## 3. 비범위 (OUT)

- 협의(네고) 루프 — `ContractNegotiation` 테이블·포털 UI (**S2**)
- 고객(게스트) 취소 정책 5단계 확장 (`lib/cancellation-policy.ts`) (**S3**)
- 취소 시 실제 지급액 자동 산출·정산 연동 (**S3**)
- 이미 서명된 계약의 소급 적용 (봉인 — 재계약은 VOID 후 신규, 기존 규칙 유지)
- 스키마(Prisma) 변경 — **없음**(termsJson 내부 확장)

## 4. 완료 기준 (테스트 가능)

1. 관리자 신규 빌라 공급 계약 작성 → 5행 프리셋이 폼에 채워지고, 저장 후 계약 상세 렌더 별표2에 **3열 5행 표**가 나온다(ko·vi 모두).
2. `supplierPayPct`를 상한 초과(예: 고객환불 80% + 공급자지급 30%)로 저장 시도 → **400** + 폼에 에러 표시.
3. `fromDays`가 내림차순이 아니거나 마지막 행이 `-1`이 아니면 400.
4. **레거시 계약**(termsJson에 `cancelFreeDays`만 있는 기존 서명 계약) 렌더 → 별표2가 **종전과 문자열 동일**(2열 3행).
5. termsJson에 원가·마진·판매가 키를 넣으면 여전히 `.strict()`가 거부(마진 비공개 회귀 없음).
6. `npm run typecheck` + `next build` 통과, `business-contract` 테스트 전부 green.

## 5. 검증 방법

QA 독립 평가(작성자 자기평가 무효): ADMIN 계정으로 신규 계약 생성→상세 렌더 확인, 상한 위반 400, 레거시 계약 렌더 문자열 비교(회귀), SUPPLIER 계정 API 403 유지.

## 6. 점유/수정 파일 (충돌 회피)

- 수정: `lib/business-contract.ts`, `lib/business-contract.test.ts`, `app/(admin)/contracts/contract-create-form.tsx`, `docs/business/contracts/signing/villa-supply.{ko,vi}.md`, `docs/business/contracts/01-villa-supply-agreement.md`, `messages/{ko,vi}.json`(adminContracts 키 **추가만**)
- 신규: 없음
- **수정 금지 구역**: `lib/cancellation-policy.ts` 및 고객 정책 관련 파일(S3 범위), `prisma/schema.prisma`
