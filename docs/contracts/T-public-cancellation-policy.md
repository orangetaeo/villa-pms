# T-public-cancellation-policy — 취소·환불 정책 공개 표시 (#6b)

> 상태: **착수 선점** · 작성 2026-06-25
> 담당: BE(AppSetting 키·기본값) → FE(공개 표시 + 설정 폼) → LOC(ko/vi 라벨) → QA
> 워크트리: `wt/cancellation-policy` (origin/main 기준, 격리)

## 1. 배경
테오 2026-06-24 에픽 #6b. 공개 제안 페이지(/p)에 취소·환불 정책이 없어 여행사·여행객이 환불 조건을 모른다. 전 빌라 공용 단일 정책(빌라별 아님).

**테오 확정 정책(2026-06-25):** 체크인 30일 전까지 100% 환불 / 14일 전까지 50% / 14일 이내 환불 불가. (입금 확정 기준, 숫자는 설정에서 수정 가능)

## 2. 범위 (IN)
1. **저장소**: AppSetting 키 `CANCELLATION_POLICY` = JSON `{ fullDays, partialDays, partialPct, enabled }`. 고정 3단계 구조(전액/부분/불가) — 숫자만 가변. 스키마 무변경(키-값).
2. **기본값**: seed `buildAppSettings()` + 설정 미저장 시 폴백 = `{ fullDays:30, partialDays:14, partialPct:50, enabled:true }`.
3. **공개 표시**: `app/p/_components/villa-sales-section.tsx` "이용 안내" 섹션 보증금 안내 아래에 정책 박스 추가. `enabled=false`면 미표시. 3줄 생성(전액/부분/불가).
4. **설정 편집**: `/settings`에 카드 추가 — 숫자 3개(전액일·부분일·부분율) + 표시 토글. 기존 폼 패턴(react-hook-form/zod, PUT /api/settings) 재사용. 검증: fullDays > partialDays ≥ 0, 0≤pct≤100.
5. **감사 로그**: 저장 시 writeAuditLog (글로벌 절대 규칙).
6. **권한**: 설정 편집 API ADMIN 전용. 공개 표시는 비로그인 OK(정책은 공개 정보 — 마진·재고 아님, 누수 무관).
7. **i18n**: 설정 화면 라벨 ko+vi. 공개 표시 문구는 /p 현 정책대로 **ko 고정**(/p 다국어화는 #5 별건, 그때 함께 번역).

## 3. 비범위 (OUT)
- 빌라별 개별 정책 (전 빌라 공용 유지)
- 동적 N단계 (고정 3단계만)
- 실제 환불 처리·정산 연동 (표시 전용)
- /p 전체 다국어화 (#5)

## 4. 완료 기준 (테스트 가능)
1. /settings에서 전액일 30→20 수정·저장 → 새로고침 후 유지, 공개 페이지에 "20일 전까지 100%" 반영.
2. 표시 토글 off → 공개 페이지에 정책 박스 미표시.
3. fullDays ≤ partialDays 입력 시 검증 에러(역전 방지).
4. SUPPLIER 계정으로 설정 API 호출 시 403.
5. 저장 1건당 AuditLog 1행.
6. seed 재실행 시 기본 정책 생성(SETTING_KEYS ⊆ buildAppSettings 테스트 통과).
7. `next build` + typecheck 통과.

## 5. 검증 방법
- QA 독립 평가: ADMIN 수정→공개 페이지 반영, 토글, 검증 역전, SUPPLIER 403. 작성자 자기평가 무효.

## 6. 점유/수정 파일 (충돌 회피)
- 신규: `app/(admin)/settings/cancellation-policy-form.tsx`, `lib/cancellation-policy.ts`
- 수정(추가만): `app/(admin)/settings/validators.ts`(키 1개), `app/(admin)/settings/page.tsx`(카드), `app/p/_components/villa-sales-section.tsx`(박스), `prisma/seed.ts`(기본값 1줄), `messages/ko.json`·`vi.json`(adminSettings.cancellationPolicy)
- **수정 금지 구역**: 진행 중 동의서 리팩터링 파일(lib/agreement.ts, checkin/*), 타 워크트리 점유 영역(미니바·시트·체크인). 본 태스크는 settings·/p만 건드림.
