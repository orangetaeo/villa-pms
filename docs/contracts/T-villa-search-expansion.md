# T-villa-search-expansion — 빌라 관리 검색 확장 (상세·판매정보 필터 + 날짜별 공실 + 체크인/아웃 날짜 검색)

- 상태: **확정** (2026-07-10 회의 완료 — FE·QA 검토 반영, TDA 승인)
- 담당: 에이전트A(/villas 전체) → 에이전트B(/bookings) 순차 → QA
- 배경(테오): ① 상세·판매정보가 검색에 안 걸림 ② 날짜별 공실 검색 ③ 체크인/아웃 현황 날짜 검색 ④ 기타 확인

## 설계 결정 (TDA — 회의 확정)

기존 패턴 유지: **RSC 서버 where + URL 쿼리 필터**. 신규 검색 인프라·신규 API 라우트 없음(전부 ADMIN 게이트 RSC).

### A. /villas — 상세·판매정보 필터 + 날짜별 공실
1. **q 확장**: 기존(name·complex·address·supplier.name) + `nameVi`
2. **날짜별 공실 = 헤드라인 질의**: 체크인·체크아웃 DateField 2칸을 검색줄 옆 **상시 노출**(패널 밖). 파라미터 `ci`/`co`
   - 판정: `lib/availability.ts`에 **신규 export** `findFreeVillaIds(db, range, opts)` — 기존 `findSellableVillaIds`와 내부 헬퍼 공유(공개 시그니처 무변경), 점유 기준(HOLD/CONFIRMED/CHECKED_IN 예약·차단 겹침 제외). **함수 주석: ADMIN 전용 — /p·/g·제안 생성 경로 호출 금지**(그쪽은 findSellableVillaIds 유지)
   - 기본 = **점유 기준 공실(상태 무관)** + 상세 패널에 **"판매가능만" 토글**(ON 시 ACTIVE+isSellable+정원). 검수대기·요율미설정 카드 배지 유지로 원칙3(검수 게이트) 오인 방지
   - HOLD 만료 미수거(status=HOLD·holdExpiresAt<now)는 점유로 판정 — 공실보드·제안과 동일(재판정 안 함, 명문화)
   - 성능: q·속성 필터를 후보 선정 쿼리에 선반영해 freeIds 축소 → 목록·total·groupBy가 동일 결과 공유. 신규 인덱스 불필요(기존 Booking/CalendarBlock/VillaFeature 인덱스 커버)
3. **상세 필터 = 접이식 인라인 패널**(villas-filters.tsx 확장, `bg-admin-card`, 토글 버튼에 활성 개수 pill, 활성 필터 있으면 기본 open):
   - 침실 이상(`bedrooms ≥`)·인원 이상(`maxGuests ≥`)·수영장·조식 토글·침대종류(`bedroomDetails some bedType`)·해변거리 이내(프리셋 100/300/500/1000, null 미매칭 — 빈 결과 안내에 반영)·"판매가능만" 토글
   - **셀링포인트 태그**: 검색형 멀티셀렉트(카테고리 그룹 헤더) + 선택 칩, 다중 AND(`features some` 각각). 라벨은 기존 features i18n 사전 재사용(신규 번역 볼륨 없음 확인)
4. **회귀 트랩(필수)**: `tabHref`·페이지네이션 링크를 "기존 searchParams 복제 후 해당 키만 set" 방식으로 리팩터 — 신규 파라미터 유실 금지. **탭 카운트 groupBy·total·목록 3자 동일 searchWhere**(freeIds·상세 필터 포함)
5. 불완전 입력 방어: ci/co 한쪽만·역전(`co ≤ ci`)이면 **날짜 필터 미적용**(assertValidStayRange throw로 500 금지). data-tour 앵커 변경 시 tour-definitions+tour NS 동시 갱신(adminVillas 투어 존재)

### B. /bookings — 날짜별 체크인/아웃/투숙 검색
1. `from`·`to` DateField 2칸 + `dateBasis` 셀렉트(**기본=투숙중**) — 기존 "기간" 클러스터에 통합 배치, 활성 시 "기간: 7.01–7.10 · 투숙중 [해제]" 스코프 배너
2. **경계 명세(그대로 테스트 고정)**: from/to는 일 포함 범위 → 내부 half-open 변환(`windowEnd = to+1일`). 단일일 from==to 허용
   - 체크인일: `checkIn ∈ [from, windowEnd)` / 체크아웃일: `checkOut ∈ [from, windowEnd)` / 투숙중: `checkIn < windowEnd AND checkOut > from` — **from 아침 퇴실(checkOut==from)=미포함, to 입실=포함**
   - dateBasis는 날짜만 필터 — status는 탭이 AND 결합
3. **우선순위·상호배타**: `filter(프리셋) > from/to+basis > range > month` — 하나 지정 시 하위 파라미터 clear(나중 지정이 이김). 프리셋 `today-checkin/out`의 **상태 핀(CONFIRMED/CHECKED_IN) 보존**(동작 불변 하드게이트)
4. **명시 from/to 활성 시 HOLD 항상표시(A2) OR 제거** — 날짜 필터가 authoritative. 기본 월뷰에서는 유지
5. 스탯 카드(오늘 체크인/아웃·HOLD)·가동률(월 기준)은 **무변경 고정**. 체크인 시트 무변경
6. q 확장: `guestPhone` 추가 — **where 전용(rows select 추가 금지, PII)**. 저장 형식 실측 후 숫자 정규화 비교 결정([[phone-digit-normalization]])
7. month는 유지(빠른 어포던스) — from/to의 override 레이어로만. QuickDateFilter 내부 통일 리팩터는 하지 않음(스탯·occupancy가 monthRange에 묶여 회귀 위험)

### C. 범위 외 (기록)
- 공급자 /my-villas 검색 → 별도 태스크(서버 where 전환 동반) / 가격 범위 필터 → IDEAS(요율 기간·통화 이원화로 모호) / 공실보드 임의 기간 점프 → 제외(월 이동+이번 공실 검색으로 커버)

## 완료 기준 (QA 합의본)
1. /villas 필터 각 단독·조합(침실3+·수영장·태그·침대종류·해변거리·판매가능만) + q(nameVi) — 탭 카운트·total·목록 3자 정합 패리티 테스트
2. 공실 경계 하드 케이스: 예약[7/1,7/3)+검색[7/3,7/5)→표시 / 검색[7/2,7/4)→제외 / 차단 동일 / ci만·역전→필터 무시(500 금지)
3. HOLD 점유 제외(살아있는 HOLD), 만료 미수거 HOLD=점유(명문 동작)
4. dateBasis 3종 경계 테스트 — staying의 from 퇴실 미포함·to 입실 포함 2건 필수
5. 우선순위 filter>from/to>range>month + URL 상호배타 + 명시 날짜 시 HOLD-always 제거
6. 프리셋 today-checkin/out 상태 핀 보존·스탯 카드·가동률·체크인 시트 동작 불변
7. findSellableVillaIds 시그니처·소비처 무변경, findFreeVillaIds는 ADMIN 전용 주석+관리자 목록만 호출
8. guestPhone where 전용(select 부재 검증)·저장 형식 실측 기록
9. 새 파라미터가 탭 전환·페이지네이션·pageSize 변경에서 유실 안 됨(URL 왕복 테스트)
10. 권한: ADMIN 게이트 유지, 공급자/공개 라우트 diff 0(누수 0)
11. lint·typecheck·vitest 전건·build 통과, i18n ko+vi 동시
12. 마지막 관문: QA가 라이브 빌드에서 경계 케이스·탭 정합·프리셋 회귀 실측

## 수정 금지 구역
- `findSellableVillaIds`·`overlapsHalfOpen`·`assertValidStayRange`·`quickRangeWhere`·`OCCUPYING_BOOKING_STATUSES`·`computeOccupancyRate` 시그니처·의미
- /bookings 스탯 카드 쿼리·occupancy 산식, 제안 생성·/p·/g가 소비하는 findSellableVillaIds 호출 계약
- ListSearch·PaginationBar·QuickDateFilter·ResponsiveTable·DateField 공용 컴포넌트 기존 동작(prop 추가만 허용, 사용처 15곳 회귀 금지)
- 예약 수명주기·정산·Zalo 경로, 공급자/공개 select
