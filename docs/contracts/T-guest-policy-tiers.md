# T-guest-policy-tiers — 고객 취소 정책 N단계 + 취소 금액 자동 산출 (S3)

> 상태: **착수 선점** · 작성 2026-07-22
> 담당: BE(정책 v2·산출기) → FE(설정 폼·취소 화면) → LOC(공개 5개국어) → QA
> 워크트리: `.claude/worktrees/cancel-tiers`, branch `worktree-cancel-s3` (S2 `worktree-cancel-nego` 위에 스택)
> 기획 원본: `docs/plans/supplier-cancellation-tiers-negotiation.md` §5.3 · §6 S3

## 1. 배경

S1에서 **공급자 지급**을 5단계로 만들었지만, **고객 환불**은 여전히 3단계 고정(`fullDays`/`partialDays`/`partialPct` = 30/14/50)이다. 두 표의 일수 경계가 어긋나면 그 구간에서 회사가 손실을 본다 — back-to-back이 깨진다.

또한 실제 취소가 발생했을 때 **얼마를 환불하고 얼마를 지급해야 하는지 시스템이 알려주지 않는다**. 운영자가 표를 보고 손으로 계산 중이다.

## 2. ★ 테오 미결 항목에 대한 처리 (기획 §4 쟁점 5)

"고객 정책도 5단계로 교체할 것인가"는 **고객 대면 약관 변경**(무료취소 30일 → 14일 축소)이라 사업 판단이다. 답을 기다리지 않고 진행하되, **살아 있는 정책 값은 바꾸지 않는다**:

- 코드는 **N단계를 지원**하도록 확장하고, 현재 저장된 v1 값(30/14/50)은 **파싱 시 3단계로 자동 승격**되어 동작·표시가 지금과 완전히 동일하다(무변경).
- `/settings`에 **「공급자 계약과 맞추기」 프리셋 버튼**을 넣어, 테오가 결정하면 클릭 한 번으로 5단계로 전환된다.
- 두 표가 어긋나 회사 손실이 나는 구간이 있으면 **설정 화면과 취소 화면에 경고**를 띄운다 — 결정을 미루더라도 위험은 보이게.

## 3. 범위 (IN)

1. **`lib/cancellation-policy.ts` v2** — `{ tiers: {fromDays, refundPct}[], enabled }`.
   - `fromDays` 내림차순, 마지막 `-1`(노쇼·체크인 후), `0`=체크인 당일 허용. 환불률 비증가. 2~8행.
   - **v1 JSON 자동 승격**(하위호환) — 라이브 AppSetting 무변경으로 동작.
   - `SUPPLIER_ALIGNED_PRESET` — S1 공급자 5단계와 back-to-back인 고객 환불표.
2. **표시 라벨 단일화** — `cancellationTierLabel(row, fragments)` 순수 함수. 공개 제안 페이지와 예약 동의 화면이 **같은 함수**를 쓴다(현재 각자 JSX로 3단계를 하드코딩 중 → 중복 제거).
   - `public-i18n.ts`에 `cancelSameDay`·`cancelNoShow` 조각 추가(**ko·en·ru·zh·vi 5개국어**).
3. **동의 스냅샷 v2** — `policyConsentJson.policy.tiers` 저장. ★ 기존 예약의 v1 스냅샷은 **절대 재해석하지 않는다**(동의 당시 조건이 증빙 정본).
4. **`lib/cancellation-breakdown.ts`** — 순수 산출기.
   - 입력: 체크인일·취소 시각·고객 정책·공급자 계약 단계표·판매총액(KRW)·원가(VND)·노쇼 여부
   - 출력: 남은 일수, 적용 티어, 고객 환불액/위약금(KRW), 공급자 지급액(VND), **회사 손실 위험 %**(지급률 − 위약금률 > 0)
   - ★ 통화 혼합 환산(KRW↔VND) 안 함 — 환율은 회사 부담이라 계약이 정한 대로 **통화별로** 보여준다.
5. **화면** — `/settings` 티어 편집 + 프리셋 + 정합성 경고 / 예약 취소 확인 박스에 산출 결과 표시(`canViewFinance`).
6. i18n ko+vi(관리자) + 공개 5개국어, 테스트.

## 4. 비범위 (OUT)

- 실제 환불·지급 **집행**(정산 반영·결제 취소) — 표시·산출까지. 집행은 기존 수납/정산 경로 유지
- 빌라별 개별 고객 정책 (전 빌라 공용 유지)
- 파트너(B2B) 등급별 정책과의 통합 — 별도 규칙이라 이번 산출기 대상 아님(취소 화면에서 파트너 예약이면 경고만)
- KRW↔VND 환산 손익 표시

## 5. 완료 기준 (테스트 가능)

1. 라이브 v1 JSON(`{fullDays:30,partialDays:14,partialPct:50,enabled:true}`)을 파싱하면 3단계로 승격되고, 공개 페이지 문구가 **현재와 동일**.
2. `/settings`에서 「공급자 계약과 맞추기」 → 5단계 저장 → 공개 페이지에 5줄 표시(당일·노쇼 문구 포함), 5개국어 모두 한국어 잔존 없음.
3. 고객 환불률과 공급자 지급률이 어긋나 손실이 나는 구간이 있으면 설정 화면에 경고.
4. 취소 산출: 체크인 10일 전 취소 + 5단계 정책 → 환불 50%·지급 50%·손실 0으로 계산. 노쇼 → 환불 0·지급 100%.
5. 기존 예약(v1 스냅샷 보유)의 취소 산출은 **스냅샷 기준**으로 판정(정책이 바뀌어도 불변).
6. `npm run typecheck` + `next build` + 전체 테스트 통과.

## 6. 검증 방법

QA 독립 평가: 위 6개 + 공개 페이지 5개국어 실렌더 + SUPPLIER 계정에서 취소 산출 미노출(canViewFinance) 확인.

## 7. 점유/수정 파일

- 신규: `lib/cancellation-breakdown.ts`, `tests/cancellation-policy-v2.test.ts`, `tests/cancellation-breakdown.test.ts`
- 수정: `lib/cancellation-policy.ts`, `lib/public-i18n.ts`, `app/(admin)/settings/cancellation-policy-form.tsx`, `app/p/_components/villa-sales-section.tsx`, `app/p/_components/booking-form.tsx`, `app/p/[token]/book/[itemId]/page.tsx`, `app/api/p/[token]/hold/route.ts`, `app/(admin)/bookings/[id]/page.tsx`, `app/(admin)/bookings/[id]/action-panel.tsx`, `messages/{ko,vi}.json`, `prisma/seed.ts`
- **수정 금지 구역**: `prisma/schema.prisma`(S3는 스키마 변경 없음 — AppSetting 값 구조만 변경), `Villa`·`VillaClip` 영역(타 세션 작업 중)
