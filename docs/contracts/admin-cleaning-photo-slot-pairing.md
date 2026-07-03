# 계약: 관리자 청소 검수 연동 — 제출 사진 슬롯 페어링 (admin-cleaning-photo-slot-pairing)

**세션/브랜치**: wt/admin-cleaning-check · 2026-07-03
**배경**: PR #178에서 청소 제출이 선택 슬롯(발코니·수영장) 스킵을 허용하게 됨.
제출은 `slots.map(...).filter(Boolean)`로 건너뛴 슬롯을 **압축**해 URL 배열만 저장하는데,
관리자 검수 뷰는 제출사진↔기준사진을 **인덱스 순서로 페어링**한다.
→ 수영장 있는 빌라에서 발코니만 건너뛰면 수영장 사진이 한 칸 당겨져 "발코니 기준" 옆에 오배치.
개수 불일치로 청소원 읽기전용 뷰 라벨도 사라짐.

## 범위 (수정 파일)

1. `prisma/schema.prisma` — CleaningTask에 `photoSlots String[]` **additive** 추가
   (라이브 Railway Postgres에는 raw SQL `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
   `prisma db push` 금지)
2. `app/(supplier)/cleaning/[id]/cleaning-submit.tsx` — 제출 시 photoUrls와 병렬로 슬롯 id 배열 전송
3. `app/api/cleaning-tasks/[id]/submit/route.ts` — photoSlots(optional, 길이 일치 검증) 수용
4. `lib/cleaning.ts` — submitCleaningPhotos에 photoSlots 저장(기본 [])
5. `lib/cleaning-photo-pairs.ts` (신규) — 페어링 순수 함수(슬롯 매칭 + 레거시 인덱스 폴백)
6. `lib/cleaning-photo-pairs.test.ts` (신규) — 단위 테스트
7. `app/(admin)/inspections/page.tsx` + `inspections-view.tsx` — 슬롯 매칭 페어링 사용
8. `app/(supplier)/cleaning/[id]/page.tsx` — 읽기전용 라벨을 슬롯 id 기준으로

## 완료 기준 (테스트 가능)

- [x] 수영장 빌라에서 발코니 스킵 제출 → 관리자 검수 뷰에서 수영장 사진이 **수영장 기준** 옆에 표시
      (단위테스트 ★핵심 케이스 + 라이브 E2E: 욕실2 기준↔bathroom-2 제출 정확 페어·베란다 기준행 제출없음)
- [x] 청소원 읽기전용 뷰: 슬롯 스킵 제출에서도 공간 라벨 표시 — 라이브 7장 vi 라벨 전부 확인
- [x] photoSlots 없는 **레거시 제출**은 기존 인덱스 페어링 그대로 (단위테스트 + 라이브 photoUrls 행 0건이라 실데이터 회귀 없음)
- [x] 승인(approve)은 장수 무관 — 라이브 7장(8슬롯 중 발코니 스킵) 승인 성공·gateOpened:true
- [x] tsc 0 / 테스트 2276 통과(신규 8) / next build 통과
- [x] 누수 체크: 검수 select 추가는 photoSlots(슬롯 id 문자열)뿐 — 독립 QA PASS

## 수정 금지 구역

- messages/ko.json·vi.json 은 키 **추가만** (기존 키 수정 금지 — 이번 작업은 기존 키 재사용 예정)
- lib/cleaning.ts 의 상태기계·게이트 로직 (photoUrls→photoSlots 저장 추가 외 무변경)
- (supplier) layout.tsx (화이트리스트 — 기존 수정 금지 구역)

## 검증 방법

- 단위: cleaning-photo-pairs.test.ts (스킵·레거시·중복 기준사진·초과 사진 케이스)
- 라이브: Playwright — CLEANER(0791234560)로 발코니 스킵 제출 → ADMIN으로 검수 뷰 페어 확인
