# T-supplier-info-features-wifi-access — 공급자 정보수정에 셀링포인트·와이파이·출입정보 추가

## 배경 (테오 요청 2026-07-13)
공급자(빌라 관리자) "이용 규칙 · 정보 수정"(/my-villas/[id]/info)에서 셀링포인트가 누락.
전수 비교 결과 승인 후 공급자가 수정 불가한 항목: ① features(셀링포인트) ② wifiSsid/wifiPassword ③ accessType/accessInfo ④ bedroomDetails(잠자리 구성).
①②③은 공급자가 아는 사실 속성이므로 info 페이지·API에 추가. ④는 파생 스칼라(bedrooms/bathrooms/maxGuests) 3경로 공유 구조라 **범위 밖** (별도 태스크).

## 범위
- `app/(supplier)/my-villas/[id]/info/page.tsx` — select에 features/wifiSsid/wifiPassword/accessType/accessInfo 추가(자기 빌라 스코프라 비공개 필드 허용, edit/page.tsx 전례), initial 매핑
- `app/(supplier)/my-villas/[id]/info/info-editor.tsx` — 섹션 추가: 셀링포인트 칩 다중선택(FEATURE_ITEMS 사전), 와이파이 2필드, 출입방식 칩(ACCESS_TYPES)+출입정보 textarea. 마법사 step-location(features)·step-rules(wifi·access) UI 패턴 재사용
- `app/api/villas/[id]/info/route.ts` — zod에 features(featureRowSchema+refineFeatures)·wifiSsid·wifiPassword·accessType·accessInfo additive 추가. features는 전달 시에만 전체 교체(deleteMany→createMany, sales 라우트 ⓒ 패턴). hasPoolFeatureTag → hasPool=true 보정 동일 적용. AuditLog 유지(wifiPassword 값은 마스킹)
- `messages/ko.json` + `messages/vi.json` — supplierInfo NS 키 추가(동시). 셀링포인트 아이템 라벨은 기존 `features.items.*` 재사용
- 낡은 주석 갱신(info route "⛔ features·wifi 미수신" 등)

## 수정 금지 구역
- sales-editor·/api/villas/[id]/sales (운영자 경로 불변)
- villa-sales-section.tsx (읽기전용 표시 유지)
- prisma/schema.prisma (스키마 변경 없음 — 기존 컬럼만 사용)

## 완료 기준 (테스트 가능)
1. 공급자가 자기 빌라 info 페이지에서 셀링포인트 토글·와이파이·출입정보 저장 → DB 반영 + AuditLog 기록
2. 타인 빌라 PATCH → 404 (존재 비노출 유지)
3. 판매가·마진·KRW 필드 조회·응답 0건 (누수 0 유지)
4. features 미전달 PATCH는 기존 태그 보존(교체는 전달 시에만)
5. ko/vi 키 동시 존재, 하드코딩 한국어 0
6. `npm run build` 통과

## 검증
QA 에이전트가 코드 리뷰(누수·권한·zod 우회)·빌드로 검증. 작성자 자기평가 무효.
