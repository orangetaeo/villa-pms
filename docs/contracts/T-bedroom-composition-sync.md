# T-bedroom-composition-sync — 빌라 등록 개편: 잠자리 구성 단일 원천 + 등록 필수정보 4종 추가

- 상태: **확정** (2026-07-10 회의 완료 — UX-VN·QA 검토 반영 + 테오 추가 지시 4건 포함)
- 담당: BE(스키마·API·백필) → UX-VN(마법사) → FE(관리자 편집기·체크인 표시) → QA / TDA 설계 승인
- 배경: 쏘나씨 V21 — 기본정보 `bedrooms=2` vs 잠자리 구성 4개 방. 별도 입력·별도 저장이라 어긋나도 모른다.
  욕실만 자동 싱크(v1.4), 침실·인원 방치. **테오 지시: 등록 시점부터 잠자리 구성으로 입력받고 침실·욕실·인원을 파생·싱크. 추가로 셀링포인트 태그·위치접근성·와이파이·출입정보(도어락/스마트키)도 등록 시 필수 수집.**

## 설계 결정 (TDA)

**원칙: 방별 구성(VillaBedroom)이 진실의 원천. `Villa.bedrooms/bathrooms/maxGuests`는 서버가 계산하는 파생 스칼라(목록·검색 캐시)로 유지.** (ADR-0011 additive 원칙 유지)

파생 규칙 — `lib/bedding.ts` 순수함수 단일 구현, 3경로(POST villas / PUT villas/[id] / PATCH sales) 공유:
| 파생 필드 | 규칙 |
|---|---|
| `bedrooms` | distinct roomIndex 개수 (저장 시 roomIndex 1..N 재정규화) |
| `bathrooms` | 방별 전용욕실(bathroomCount, roomIndex별 1회) 합 + `commonBathrooms` |
| `maxGuests` | 방별 capacity 합, **50 클램프**. 모든 방 capacity 존재 시에만 — 아니면 기존값(생성 시엔 body 스칼라) 보존 |

경계·모순 해소 (QA 합의):
- bedroomDetails **미전송 = 빈 배열 = 스칼라 보존/폴백** — 3경로 동일. 파생 0 저장 금지(bedrooms·bathrooms·maxGuests min 1 불변식 유지)
- bedroomDetails 전송 시 **body 스칼라(bedrooms/bathrooms/maxGuests) 무시**하고 파생값 저장
- roomIndex·방 수 상한 **20으로 3스키마 통일** (기존 sales zod max 50 → 20)

신규 스키마(전부 additive — 라이브는 raw SQL ALTER, db push 금지 [[db-is-railway-postgres]]):
- `Villa.commonBathrooms Int @default(0)` — 방에 속하지 않는 공용 욕실
- `Villa.doorAccessType String?` — zod 화이트리스트: `DOORLOCK_PIN | SMART_KEY | PHYSICAL_KEY | OTHER` (Prisma enum 대신 String+zod — enum 드리프트 함정 회피 [[servicetype-fruit-enum-drift]])
- `Villa.doorAccessCode String?` — ⚠ 도어락 비번/키 전달 메모. **wifiPassword와 동일 비공개 등급**: /p 공개페이지 절대 노출 금지, select 화이트리스트, 체크인 화면 전용

## 범위

### A. 등록 마법사 개편 (UX-VN) — 관리자 직접등록도 동일 마법사(isAdmin)라 자동 커버
1. **잠자리 구성 = 독립 신규 스텝** (기본정보 다음, 총 스텝 +1). Step 1(기본정보)은 빌라명·단지·수영장/조식만 남김
2. **2단 구조**: "침실 몇 개?" 스테퍼(1~20) → 그 수만큼 방 카드 자동 생성 (라벨 자동 "침실 N/Phòng N" — 텍스트 입력 없음)
3. 방 카드: **침대종류 아이콘 칩(BedType 6종) + 개수 스테퍼** (셀렉트 금지, sales-editor feature 칩 스타일 차용 — 신규 Stitch 생성 없음)
4. capacity = 침대종류·개수에서 **자동 추론**(KING/QUEEN/DOUBLE/BUNK=2인, SINGLE/TWIN=1인 × 개수) 후 "인원 조정" 펼침에서만 수동 조정
5. 전용욕실 = "전용욕실 있음" 토글(기본 ON=1), 2개 이상 희소 케이스만 스테퍼 펼침. **공용 욕실 = 방 카드 밖 스테퍼(0~10, 기본 0)**
6. maxGuests: 공급자 화면에서 **자동 고정** — 스테퍼 제거, 읽기전용 요약("침실 N · 욕실 N · 기준인원 N")만. 오버라이드는 관리자 sales-editor 전용
7. **셀링포인트 태그**: 잠자리 스텝 또는 위치 스텝에 기존 사전(lib/features.ts) 칩 다중선택 (sales-editor와 동일 featureKey, 카테고리 VIEW/FACILITY/LOCATION)
8. **위치 스텝 확장**: googleMapUrl(공유링크 붙여넣기 1칸) + beachDistanceM(프리셋 칩 <100/300/500/1000m + 직접 조정)
9. **이용규칙 스텝 확장**: 와이파이(wifiSsid·wifiPassword) + 출입정보(doorAccessType 아이콘 칩 4종 + doorAccessCode)
10. 재제출(edit) 프리필: villaToWizardState가 bedroomDetails·features·신규 필드 전부 복원. 방 수 축소 재제출 시 초과 사진 slot drop 기존 로직 유지
11. buildPhotoSlots는 파생 bedrooms/bathrooms(전용합+공용)로 기존 동작 유지 — **슬롯 id 문법 `bedroom-N`/`bathroom-N` 변경 금지**
12. i18n: 신규 키 ko+vi 동시 추가

### B. API·스키마 (BE)
1. bedroom zod 스키마·방단위 동일값 검증(capacity·bathroomCount)을 sales route에서 `lib/villa-schema.ts`로 추출 — 3경로 공유. hasPool 보정 규칙(풀 태그→true)도 공유
2. **POST /api/villas**: bedroomDetails[]·features[]·commonBathrooms·googleMapUrl·beachDistanceM·wifiSsid·wifiPassword·doorAccessType·doorAccessCode 수용 → 같은 트랜잭션에서 VillaBedroom·VillaFeature 생성 + 파생 스칼라 서버 계산. 미전송 시 기존 스칼라 폴백(하위호환). AuditLog에 신규 항목 기록(단, doorAccessCode·wifiPassword **값은 로그 금지** — 존재 여부만)
3. **PUT /api/villas/[id]**(재제출): 동일 — VillaBedroom·VillaFeature 전체 교체 + 파생 재계산
4. **PATCH /api/villas/[id]/sales**: bedrooms 자동 갱신 추가, bathrooms=전용합+commonBathrooms, maxGuests 조건부 갱신, commonBathrooms 수용
5. 마이그레이션: 신규 3컬럼 additive — prisma schema + 라이브 raw SQL
6. **백필 스크립트**: bedroomDetails 있는 빌라 → **bedrooms만** 보정. bathrooms는 bathroomCount 데이터가 실제 있는 빌라 한정, maxGuests는 **리포트-only**(자동 덮어쓰기 금지). dry-run 리포트 → 별도 승인 후 실행
7. 공급자 GET·/p 응답에 신규 필드 추가 시 **명시 select만**(include 금지) — wifiPassword·doorAccessCode는 /p·공급자 목록 절대 미포함

### C. 관리자 편집기·체크인 (FE)
1. sales-editor: 공용 욕실 입력 + 출입정보(doorAccessType·doorAccessCode) 편집 추가, maxGuests 수동 오버라이드 유지
2. 체크인 상세 화면: wifiPassword 표시되는 위치에 출입정보 병기 (수집만 하고 안 보이는 죽은 데이터 방지)

### D. 범위 외 (기록만)
- 공급자의 등록 후 잠자리 편집(현행 관리자 전용 유지) → IDEAS
- 제안서/고객 화면 잠자리 표기 개선 → 기존 표시 로직 유지

## 완료 기준 (테스트 가능 — QA 합의본)
1. 마법사: 방 3개(전용욕실 각 1·킹1) + 공용욕실 1 등록 → bedrooms=3, bathrooms=4, maxGuests=6, VillaBedroom 6행 아님 3행+침대행, VillaFeature 저장, 신규 필드 저장
2. 사진 스텝: 침실 3·욕실 4 슬롯 자동 생성. 방 4→2 재제출 시 bedroom-3/4 사진 drop + 무크래시
3. bedroomDetails 빈 배열/미전송 → 3경로 모두 스칼라 보존(0 저장 없음). 전송 시 body 스칼라 무시(불일치 주입 테스트)
4. capacity 부분입력→maxGuests 보존 / 전원입력→합 갱신 / 합>50→50 클램프. roomIndex 비연속 입력→1..N 재정규화
5. 관리자 판매정보에서 방 4개로 저장 → bedrooms 자동 4 (V21 재발 불가)
6. commonBathrooms>0 빌라의 청소 제출 게이트·기준 페어링 회귀 없음
7. 누수 0: /p·공급자 목록 응답에 wifiPassword·doorAccessCode·마진·판매가 부재 (기존 /p 정적 테스트 확장). AuditLog에 비밀값 평문 없음
8. 백필 dry-run: V21 bedrooms 2→4 잡힘, bathrooms는 데이터 있는 빌라만, maxGuests 리포트-only
9. 기존 테스트 전건 + 신규 파생 규칙 단위 테스트. `npm run lint && npm run typecheck && next build` 통과
10. 세 스키마 roomIndex·방 수 상한 20 통일

## 수정 금지 구역
- 슬롯 id 문법 `bedroom-N`/`bathroom-N` 및 buildPhotoSlots 슬롯 계약 (lib/cleaning-photo-pairs.ts·lib/cleaning.ts 페어링 파손)
- app/p/** 공개 select 화이트리스트 패턴 (include 금지 유지)
- booking-form maxGuests 소비 경로, representativeRatesBySeason 요율 재구성 경로
- prisma 기존 컬럼 변경(additive만), 예약/정산/Zalo 경로, 비품 저장 경로(custom 행 보존 [[amenity-quantity-custom-2026-07-10]])
