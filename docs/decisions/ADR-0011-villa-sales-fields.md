# ADR-0011: 빌라 판매용 정보 필드 확장

## 상태

채택 — 2026-06-22 (설계문서 `docs/villa-sales-data-design.md` §7 결정 7건 전부 해소, 테오 구현 승인)

## 맥락

`Villa` 모델이 내부 운영(원가·가용성·검수)에 치우쳐 한국 여행사·고객에게 팔 "판매용 정보"가 부족했다. 테오 팀이 ADMIN 폼으로 빌라 데이터를 직접 취합한다. 잠자리 구성·위치·이용규칙·셀링포인트 태그를 MVP에 **추가(additive only)** 한다.

## 결정

1. **Villa에 판매정보 스칼라 13개 추가** (additive, 기존 컬럼 무변경, 전부 nullable 또는 `@default`):
   - ③ 위치·접근성: `googleMapUrl`, `beachDistanceM`(Int·m), `areaSqm`(Int·㎡), `floors`(Int)
   - ④ 이용규칙: `checkInTime @default(840)`, `checkOutTime @default(660)`(분 단위 Int 0~1439), `smokingAllowed`/`petsAllowed`/`partyAllowed @default(false)`, `parkingSlots @default(0)`, `baseDepositVnd`(BigInt? VND 동), `wifiSsid`, `wifiPassword`
   - ⑤ 엑스트라베드: `extraBedAvailable @default(false)`(빌라 단위 토글, 침실별 아님)
2. **② 침실별 구성은 별도 모델 `VillaBedroom`** (`VillaPhoto`/`VillaAmenity`와 동일 1:N 자식 패턴) — Json 아님. 역관계명 `bedroomDetails`(기존 Int 컬럼 `bedrooms`와 충돌 회피). 한 침실에 침대 종류가 여럿이면 같은 `roomIndex` 행을 여러 개 둔다.
3. **⑤ 셀링포인트는 `VillaFeature` + `lib/features.ts` 사전** (`VillaAmenity` itemKey 패턴 재사용). `@@unique([villaId, featureKey])`로 중복 차단, custom 자유입력 미허용(ADMIN이 사전에 키 추가).
4. **enum 2종 추가**: `BedType`(KING·QUEEN·DOUBLE·SINGLE·TWIN·BUNK 6종, 테오 확정), `FeatureCategory`(VIEW·FACILITY·LOCATION).
5. **단위 정수화 — 부동소수점 전면 금지**: 해변거리=meter Int, 면적=㎡ Int, 층수 Int, 체크인/아웃=분 단위 Int. 보증금=VND BigInt.
6. **누수 차단**: `wifiPassword`·`wifiSsid`는 `/p` 공개 제안페이지 select 화이트리스트에서 제외(체크인 화면 전용). 그 외 판매정보 필드는 마진·판매가가 아니므로 공급자 노출 무방(누수 무관).
7. **AuditLog**: 변경 경로 전부 기록(entity: `Villa`/`VillaBedroom`/`VillaFeature`). `wifiPassword`는 `changes`에서 마스킹(`{ old: "***", new: "***" }`, ZaloAccount.credentials 선례).

## 근거

- **1:N 자식 모델**: 기존 프로젝트 전 부속정보(`VillaPhoto`·`VillaAmenity`·`VillaRate`·`VillaSeasonPeriod`)가 1:N 자식 모델 관례 — 컨벤션 정합 + enum/FK 검증 + 향후 검색성(예: "킹베드 보유 빌라" 인덱스).
- **분 단위 Int**: "14:00" 문자열 대비 산술·검증 용이, DST 무관, 부동소수점 회피. `@db.Time`도 가능하나 프로젝트에 시간 타입 선례 없음·과설계.
- **정수 단위**: 거리·면적은 표시 정밀도가 정수면 충분, 부동소수점 금지 원칙 준수.

## 대안 (기각)

- A. 침실 구성을 `Villa.bedrooms Json`: 검증·검색 불가, schema에 Json 구조 선례 없음 → 기각.
- B. 체크인 시간 String "14:00": 산술·검증 번거로움 → 기각.
- C. 셀링포인트를 `VillaAmenity`에 합침: 비치품목 vs 셀링포인트 의미 혼선, 불필요한 quantity/unitPrice → 별도 모델로 분리.

## 영향

- **additive 마이그레이션 1회**(`prisma db push` 무손실, 2026-06-22 Railway 반영 완료). 기존 행 백필 불필요.
- 신규: `Villa` 스칼라 +13, enum +2(`BedType`·`FeatureCategory`), 모델 +2(`VillaBedroom`·`VillaFeature`), lib 사전 +2(`lib/features.ts`·`lib/bedding.ts`).
- 후속 단계(이 ADR 범위 밖): ADMIN 판매정보 편집 폼, `VillaBedroom`/`VillaFeature` CRUD 라우트(zod + AuditLog), `/p` 표시(wifi 제외 select), 체크인 화면 wifi 표시, i18n 키 추가(`features.*`·`bedding.*`·`villaRules.*`), QA leak-checklist 항목(`/p` 응답에 wifiPassword/wifiSsid 부재).
- **롤백 안전**: additive라 롤백 시 신규 컬럼·테이블 drop만, 기존 데이터 무영향.
