# 계약서 — T-admin-batchA-villa-fields (관리자 비품 CRUD · 침실별 욕실 · 수영장 연동)

회의 결정(2026-06-23) 기반 Phase 1 보강 3건. 요금 재설계(Batch B)는 별도 ADR로 분리.

## 범위 (3 작업)

### 1) 수영장 연동 (스키마 변경 없음)
- 관리자 판매정보 폼(sales-editor.tsx)에 `hasPool` 토글 추가
- 저장 시: `privatePool` 또는 `kidsPool` 셀링포인트 태그가 켜져 있으면 `hasPool=true` 자동 보정 (해제 시 자동 OFF 안 함 — 수동 토글 존중)
- `PATCH /api/villas/[id]/sales`에 `hasPool` 수신 + 자동보정 로직

### 2) 비품 ADMIN CRUD (스키마 변경 없음)
- `PATCH /api/villas/[id]/amenities` 권한을 ADMIN(canSetPrice 계열)까지 확장 (기존 SUPPLIER 유지)
- 관리자 빌라 상세의 읽기전용 비품 카드 → 편집 가능 UI(공급자 amenities-editor 패턴 재사용)
- 미니바 단가(고객청구가)는 관리자 노출·편집 OK (원가 아님)

### 3) 침실별 전용욕실 (스키마 마이그레이션 필요 — 단독 세션 전담)
- `VillaBedroom.bathroomCount Int @default(0)` 추가 (additive only)
- 판매정보 폼 침실 카드에 전용욕실 개수 스테퍼
- 저장 시 `Villa.bathrooms` = Σ(침실별 전용욕실) + 기존 공용 보정 로직 (자동 합산)

## 테스트 가능한 완료 기준
- [ ] 셀링포인트 풀 태그 체크 후 저장 → 기본정보 요약 "수영장 있음" 표시 (재현: 쏘나씨 V11)
- [ ] 관리자가 비품 추가/수정/삭제 저장 → 영속 + AuditLog 기록
- [ ] 침실 카드에 전용욕실 입력 → 저장 후 총 욕실수 자동 반영
- [ ] `npm run typecheck` 통과, 관련 vitest 통과
- [ ] QA 누수 점검: 공급자 화면에 판매가·마진 미노출 유지

## 수정 금지 구역 (다른 세션 작업 중)
- `lib/cleaning.ts`, `lib/hold.ts`, `lib/proposal.ts`, `docs/DESIGN.md` — **절대 수정 안 함**
- `messages/ko.json`·`vi.json` — 키 **추가만**, hunk 선별 스테이징

## 비고
- 요금 다기간화(Batch B)는 본 계약서 범위 외. ADR 신규 후 별도 진행.
