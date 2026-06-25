# T-admin-statistics — 운영자 통계화면

> 상태: **기획(Contract)** — QA·TDA 합의 전 코딩 금지 (작업 사이클 2단계)
> 담당: FE(화면)·BE(집계 lib)·DESIGN(Stitch)·QA(평가)·LOC(i18n)
> 작성일: 2026-06-25 / 선점 커밋: `chore: T-admin-statistics 착수 선점`

---

## 1. 배경·목적

운영자(테오)가 **사업 의사결정에 필요한 숫자**를 한 화면에서 본다. 현재 `/dashboard`는 "오늘
처리할 일"(체크인·청소 대기 등 운영 큐) 중심이고, **추세·성과·전환** 통계는 없다. 본 태스크는
운영자 전용 통계 메뉴를 신설한다.

**핵심 원칙 준수 (CLAUDE.md):**
- **마진 비공개·재고 비공개**는 통계에도 그대로 적용 — 통계는 ADMIN/운영자 라우트 전용. 공급자·공개(/p) 라우트에 절대 노출 금지.
- **돈의 경계선** (ADR-0013): KRW·마진·매출·정산 숫자는 `canViewFinance`(OWNER·MANAGER) 전용. **STAFF는 금액 통계 차단**.
- **통화 분리** (ADR-0003): KRW 매출과 VND 매출은 **절대 합산하지 않는다**. 차트·카드에서 통화별로 분리 표기.

---

## 2. 범위 (테오 확정 2026-06-25)

- **구조**: 사이드바에 `통계` 메뉴 1개 추가 → 화면 내 **탭 4종** 전환 (별도 메뉴 분리 안 함).
- **시각화**: **recharts** 도입 (라인·막대·도넛). package.json에 의존성 추가 — §9 동결 예외 선언.
- **탭 4종** (우선순위 = 테오 선택 전부):
  1. **개요(매출·마진)** — `canViewFinance` 전용
  2. **가동률(점유율)** — 전 운영자
  3. **빌라 성과** — 전 운영자 (금액 컬럼만 `canViewFinance` 게이트)
  4. **운영지표(전환·운영)** — 전 운영자 (금액 부분만 게이트)

### 수정 금지 구역 (병렬 세션 보호)
- 본 태스크는 **신규 파일 위주**. 기존 공유 파일은 **추가만**:
  - `components/admin/sidebar.tsx` — NAV_ITEMS 배열에 1행 추가만 (다른 행·로직 무수정)
  - `app/(admin)/layout.tsx` — ADMIN_CLIENT_NAMESPACES에 `"adminStatistics"` 추가만
  - `messages/ko.json`·`vi.json` — `adminStatistics` 네임스페이스 **추가만** (기존 키 무수정), 즉시 커밋
  - `package.json` — recharts 의존성 추가 (§9)
- 다른 세션이 작업 중일 수 있는 파일은 건드리지 않는다. `git status`에 모르는 파일 있으면 회피.

---

## 3. 권한 매트릭스 (누수 방지 — QA 필수 검증)

| 항목 | OWNER·MANAGER (canViewFinance) | STAFF | SUPPLIER·CLEANER·비로그인 |
|---|---|---|---|
| `통계` 메뉴·`/statistics` 라우트 | ✅ | ✅ | ❌ (미들웨어 차단 — isOperator) |
| 탭1 개요(매출·마진) | ✅ | ❌ 탭 자체 미노출 | ❌ |
| 탭2 가동률 | ✅ | ✅ | ❌ |
| 탭3 빌라 성과: 예약수·박수·가동률 컬럼 | ✅ | ✅ | ❌ |
| 탭3 빌라 성과: 매출·마진 컬럼 | ✅ | ❌ 컬럼 숨김 | ❌ |
| 탭4 운영지표: 전환·홀드·청소·NO_SHOW | ✅ | ✅ | ❌ |
| 탭4 운영지표: 보증금 차감 금액 | ✅ | ❌ 숨김 | ❌ |

- 게이트는 **서버에서** 판정 (`lib/permissions.ts`의 `canViewFinance(role)`). 클라이언트 조건부 렌더만으로 끝내지 않는다 — STAFF 응답 페이로드에 금액 필드가 **애초에 담기지 않아야** 한다 (select 화이트리스트 / 서버에서 가공 후 전달).
- 라우트 진입: `app/(admin)/layout.tsx`/미들웨어가 이미 운영자 영역을 `isOperator`로 보호 → 본 라우트는 추가로 페이지 상단에서 role 재확인.

---

## 4. 데이터 정의 (집계 규칙 — 단일 소스 `lib/statistics.ts`)

> 모든 순수 집계 함수는 `lib/statistics.ts`에 두고 단위 테스트(`lib/statistics.test.ts`). DB 로더는 같은 파일의 `load*` 함수로 분리(서버 전용).

### 4.1 시간대·월 경계
- 월 버킷 = **Asia/Ho_Chi_Minh 기준** (`lib/cleaning.ts`의 `monthKeyVn`, `lib/settlement.ts`의 `monthRangeUtc` 재사용).
- 숙박일은 `@db.Date`(시간 없음) — UTC 자정 경계로 처리, 표시단만 VN 라벨.

### 4.2 매출(Revenue) — 탭1·탭3
- **인식 기준 = 체크아웃 월**, 대상 상태 = `CHECKED_OUT`·`NO_SHOW` (정산 F6과 동일 기준 → 숫자 정합).
  - 진행 중(`CONFIRMED`·`CHECKED_IN`)은 "예정 매출"로 별도 KPI에만 표시(선택), 추세 차트엔 미포함.
- **통화 분리**: `saleCurrency`별로 분리 집계.
  - KRW 매출 = Σ `totalSaleKrw` (KRW 채널 = DIRECT)
  - VND 매출 = Σ `totalSaleVnd` (VND 채널 = TRAVEL_AGENCY·LAND_AGENCY)
  - **두 합계를 절대 더하지 않는다.** 카드·차트에서 ₩/₫ 병기로 나란히.

### 4.3 마진(Margin) — 탭1·탭3 (canViewFinance 전용)
- 원가는 항상 VND(`supplierCostVnd`). 판매가는 통화별 → 직접 차감 불가.
- **VND 채널**: 마진(VND) = `totalSaleVnd − supplierCostVnd` (동일 통화, 정확).
- **KRW 채널**: 판매가를 예약 스냅샷 환율(`Booking.fxVndPerKrw`)로 VND 환산 후 차감 →
  환산 마진(VND) = `round(totalSaleKrw × fxVndPerKrw) − supplierCostVnd`.
  - **반드시 "환율 스냅샷 기준 참고치" 라벨 명시** (SPEC: fxVndPerKrw는 참고 환산·마진 리포팅용).
  - 스냅샷 환율 누락(null) 예약은 마진 집계에서 제외하고 "환율 미기록 N건" 주석.
- 마진율(%) = 마진(VND) / 판매가(VND 환산) × 100.
- BigInt 연산, **부동소수점 금지** (CLAUDE.md 금액 규칙). 환산은 정수 라운딩.

### 4.4 가동률(Occupancy) — 탭2 (전 운영자)
- 기존 `computeOccupancyRate(bookings, activeVillaCount, monthStart, monthEnd)`·`OCCUPANCY_STAY_STATUSES` 재사용 (`lib/booking-stats.ts`).
- 점유 상태 = `CONFIRMED`·`CHECKED_IN`·`CHECKED_OUT`·`NO_SHOW` (HOLD·CANCELLED·EXPIRED 제외).
- 전체 가동률 = Σ점유박 / (ACTIVE 빌라수 × 월일수). 빌라별 가동률 = 빌라 점유박 / 월일수.
- 분모 빌라수는 **현재 ACTIVE** 기준 근사(헬퍼 주석과 동일 — 월 중 승인 시점 무시).

### 4.5 채널 비중 — 탭1
- `Booking.channel`(TRAVEL_AGENCY·LAND_AGENCY·DIRECT)별 예약 건수 + 매출(통화별).
- 도넛 2종(또는 1종 + 통화 토글): 건수 기준 / 매출 기준.

### 4.6 제안 전환 깔때기 — 탭4
- 단계: 제안 생성수(Proposal) → 가예약 발생(`USED` 또는 HOLD 1건 이상 생성) → 확정(`CONFIRMED` 도달) → 체크아웃(`CHECKED_OUT`).
- `effectiveProposalStatus`(lib/proposal.ts) 재사용으로 만료 반영. 전환율 % = 다음단계/이전단계.

### 4.7 운영지표 — 탭4
- **홀드 만료율** = EXPIRED / (기간 내 생성된 HOLD 총수). **취소율** = CANCELLED / 전체. **NO_SHOW율** = NO_SHOW / (CHECKED_OUT+NO_SHOW).
- **청소 검수**: 평균 처리시간 = `approvedAt − (PHOTOS_SUBMITTED 시각)` 평균, 미결(PHOTOS_SUBMITTED) 건수, 반려율(REJECTED/제출). 제출 시각은 AuditLog 또는 상태전이 기록 기반(없으면 `updatedAt` 근사 — 계약 선언).
- **보증금 차감**(canViewFinance): `depositStatus=PARTIAL_DEDUCTED` 건수 + Σ`depositDeductVnd`.

---

## 5. 화면 구성 (탭별)

> 공통: 우상단 **기간 필터**(최근 6개월·12개월·연도 선택). URL 쿼리 `?tab=&range=`로 상태 보존(딥링크·새로고침 유지). 데스크톱 = 사이드바, <1024 = 드로어 (기존 반응형 규칙 §F7). 차트는 `<768`에서 세로 스택.

### 탭1. 개요(매출·마진) — canViewFinance
- KPI 카드 4: ① 이번 달 KRW 매출 ② 이번 달 VND 매출 ③ 환산 마진(VND·참고) ④ 평균 마진율 — 각 전월 대비 증감(▲▼%).
- **월별 매출 추이**: 막대(또는 라인) 차트. KRW·VND **분리 2계열**(좌우 축 분리 또는 차트 2개 — 합산 오인 방지).
- **채널별 비중**: 도넛 (건수/매출 토글).

### 탭2. 가동률 — 전 운영자
- KPI 카드 3: 이번 달 전체 가동률 / 전월 대비 / 평균 박수·예약수.
- **월별 가동률 추이**: 라인 차트 (최근 12개월, 0~100%).
- **빌라별 가동률**: 가로 막대 (내림차순). 단지(complex) 그룹 필터(선택).

### 탭3. 빌라 성과 — 전 운영자 (금액 컬럼 게이트)
- **랭킹 테이블**: 빌라명·단지·예약수·점유박·가동률·[KRW매출·VND매출·환산마진]. 컬럼 클릭 정렬. <768 카드 전환(ResponsiveTable 재사용).
- 상위 N(기본 10) **막대 차트**(정렬 기준 토글: 가동률/매출/예약수).
- STAFF: 매출·마진 컬럼·정렬옵션 제거.

### 탭4. 운영지표 — 전 운영자 (금액 부분 게이트)
- **제안 전환 깔때기**: 4단계 funnel(막대/계단) + 단계별 전환율 %.
- **운영 비율 카드**: 홀드 만료율·취소율·NO_SHOW율.
- **청소 검수**: 평균 처리시간·미결 건수·반려율.
- 보증금 차감(금액, canViewFinance): 건수 + Σ VND.

---

## 6. 파일 구조 (신규 위주)

```
app/(admin)/statistics/
  page.tsx                      # 서버: auth·role 게이트, range·tab 파싱, load* 호출, 데이터 props 전달
  statistics-client.tsx         # 'use client': 탭 전환·기간 필터 UI(URL 동기화)
components/admin/statistics/
  revenue-chart.tsx             # 'use client' recharts (KRW/VND 분리 막대)
  channel-donut.tsx             # 'use client' recharts 도넛
  occupancy-line.tsx            # 'use client' recharts 라인
  villa-rank-table.tsx          # 빌라 성과 테이블(ResponsiveTable 재사용)
  funnel.tsx                    # 제안 전환 깔때기
  kpi-card.tsx                  # 공통 KPI 카드(전월 대비 증감)
lib/
  statistics.ts                 # 순수 집계 함수 + load* DB 로더 (단일 소스)
  statistics.test.ts            # 순수 함수 단위 테스트 (통화 분리·마진 환산·전환율·빈데이터)
```
- 차트 컴포넌트는 모두 `'use client'`(recharts ResponsiveContainer는 클라이언트 전용). 데이터 fetch·금액 게이트는 **서버**(page.tsx)에서 끝내고 가공된 숫자만 props로 내려 누수 차단.

### 변경(추가만)
- `components/admin/sidebar.tsx`: `{ key: "statistics", href: "/statistics", icon: "analytics", cap: isOperator }` 추가. (탭별 금액 게이트는 페이지 내부에서 — 메뉴는 전 운영자.)
- `app/(admin)/layout.tsx`: ADMIN_CLIENT_NAMESPACES에 `"adminStatistics"`.
- `messages/{ko,vi}.json`: `adminStatistics` 네임스페이스 + `nav.statistics` 키 (ko·vi 동시).
- `package.json`: `recharts` 추가.

---

## 7. 완료 기준 (테스트 가능 — QA 채점)

1. **권한**: STAFF 계정으로 `/statistics` 접근 시 탭1 미노출·탭3 금액 컬럼 없음·탭4 보증금 금액 없음. **네트워크 응답(HTML/props)에 금액 문자열이 존재하지 않음** (DOM·페이로드 검사). SUPPLIER·비로그인은 라우트 자체 차단(redirect).
2. **통화 분리**: KRW·VND 매출이 어디서도 하나의 숫자로 합산되지 않음 (코드·화면). 마진 KRW 채널은 "환율 스냅샷 기준" 라벨 노출.
3. **집계 정확성**: 단위 테스트 — 통화 분리 합계, VND 마진(동일통화), KRW 환산 마진(스냅샷), 가동률(기존 헬퍼), 전환율, 빈 데이터(0건) 무오류. `npm run lint && tsc` 통과.
4. **i18n**: ko·vi 양쪽 키 존재 — vi 누락 시 키 원문 깨짐 없음. 베트남어 감수(LOC).
5. **반응형**: <1024 드로어, <768 테이블→카드·차트 세로 스택 깨짐 없음 (Playwright 데스크톱+모바일 스크린샷).
6. **디자인 일치**: `design/stitch/` export 기준과 레이아웃·색·여백 일치 (Stitch-first 규칙). 다크 대시보드 톤.
7. **빌드 게이트**: `next build` 성공 후에만 푸시 (deploy-build-gate).

---

## 8. 디자인 (Stitch-first — 코딩 전 선행)

- `design/stitch/` 표준 절차로 통계화면 디자인 생성 → export HTML 저장 → 컴포넌트 변환.
- 화면: ① 탭 컨테이너+KPI+추세차트(개요), ② 가동률, ③ 빌라 성과 테이블, ④ 운영지표 funnel.
- 다크 운영자 대시보드 톤(기존 B1 대시보드와 동일 팔레트). 모바일 변형은 b1 규칙 준용(차트 세로 스택).
- DESIGN 에이전트가 4기준 1차 자가검토 후 FE 변환.

## 9. 의존성·동결 예외 선언

- `package.json`에 **recharts**(+ 필요 시 peer) 추가. 병렬 세션 동결 규칙 예외로 본 계약서에 명시 선언 — 추가 즉시 단독 커밋(`chore: recharts 의존성 추가`). 다른 의존성 추가 없음.

## 10. 비범위 (이번 태스크 제외)

- CSV·PDF 내보내기 (오픈 후 개선 — IDEAS.md 후보)
- 실시간 자동 새로고침·예약형 리포트 메일
- 공급자용 통계(자기 빌라 성과) — 별도 태스크(권한·통화 다름)
- 정산서 PDF·다중통화 환차 정밀 마진 (Phase 2 FIN)
- 환율 자동 갱신 — 현 스냅샷/AppSetting 그대로 사용

---

## QA 합의란
- [ ] 데이터 정의(§4) 특히 마진 환산 규칙·매출 인식 기준 동의
- [ ] 권한 매트릭스(§3) STAFF 금액 차단 방식(서버 가공) 동의
- [ ] 완료 기준(§7) 채점 항목 동의
- [ ] TDA: recharts 도입·신규 파일 구조 승인
