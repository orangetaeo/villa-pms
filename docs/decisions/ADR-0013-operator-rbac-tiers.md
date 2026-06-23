# ADR-0013 — 운영자 권한 3단계 분리 (OWNER / MANAGER / STAFF)

- 상태: **채택 (Accepted)** — 2026-06-23 테오 승인. S-RBAC-1 착수.
  - 입금확인 금액숨김(§6.1)·카뱅 알림파싱 Phase 2(§6.2) 확정.
  - 구현 전략: **additive** — ADMIN 값을 즉시 제거하지 않고 OWNER/MANAGER/STAFF를 추가, `role==="ADMIN"` ~40곳은 transition 동안 ADMIN=OWNER로 동작시켜 빌드 무중단. ADMIN 제거·코드 치환은 S-RBAC-2.
- 날짜: 2026-06-23
- 관련: CLAUDE.md 사업원칙 #2(마진 비공개)·#1(재고 비공개), middleware.ts, ADR-0012(force-sellable)
- 요청자: 테오 — "내가 보는 화면 / 관리자 화면 / 직원 화면이 각기 달라야 한다"

---

## 1. 배경 (왜 필요한가)

현재 운영자는 `Role.ADMIN` 하나뿐이고 테오 = ADMIN으로 **마진·이윤·매출·정산·시스템설정 전부**를 본다.
앞으로 팀에 **관리자·직원**이 합류하면, 지금의 "마진 비공개" 원칙(현재는 공급자/외부인만 차단)을
**팀 내부로 확장**해야 한다. 즉 직원에게도 한국 판매가(KRW)·마진·순이익을 가려야 한다.

> 통계·매출·이윤 화면은 아직 없지만, 만들기 **전에** 권한 골격을 먼저 박아야
> 나중에 화면을 추가할 때 필드 단위로 누가 보는지가 자동으로 결정된다.

## 2. 결정 (확정된 경계선)

테오 확인(2026-06-23):

| 질문 | 답 |
|---|---|
| 관리자(MANAGER)의 재무 가시성 | **전부 공개 — OWNER와 동일** (마진·이윤·정산 모두 봄) |
| 직원(STAFF) 업무 범위 | 체크인/아웃·검수, 청소 배정·확인, 캘린더·예약 관리, Zalo 응대 |
| 구현 방식 | **Role enum 확장** (ADMIN → OWNER 마이그레이션) |

따라서 **돈의 경계선은 `{OWNER, MANAGER}` vs `STAFF`** 이고,
**OWNER↔MANAGER의 차이는 돈이 아니라 "시스템 통제권"**(계정 관리·시스템 설정·정산 최종승인·감사로그)이다.

## 3. 역할 모델

```prisma
enum Role {
  OWNER     // 테오 — 최상위. 구 ADMIN. 모든 것 + 시스템 통제
  MANAGER   // 관리자 — 운영 총괄 + 재무 전체 가시성 (단 시스템 통제는 없음)
  STAFF     // 직원 — 운영 실무 전반, 돈(마진·이윤·매출·정산·KRW)만 차단
  SUPPLIER  // 공급자 (변경 없음)
  CLEANER   // 청소 (변경 없음)
}
```

마이그레이션: 기존 `ADMIN` 레코드 → `OWNER`로 일괄 치환. (현재 테오 계정 1개)

### 3.1 권한 매트릭스

| 기능 / 화면 | OWNER | MANAGER | STAFF | 비고 |
|---|:---:|:---:|:---:|---|
| **재무 (돈)** | | | | |
| 한국 판매가(KRW)·마진 조회 | ✅ | ✅ | ❌ | STAFF는 필드 마스킹 |
| 순이익·매출 통계 대시보드 *(미구현)* | ✅ | ✅ | ❌ | |
| 정산 내역 조회 | ✅ | ✅ | ❌ | |
| 정산 **최종 승인**·확정 | ✅ | ❌ | ❌ | OWNER 전용 |
| 요율 마스터(시즌가) **변경** | ✅ | ❌ | ❌ | MANAGER는 적용만, 변경은 OWNER |
| **운영** | | | | |
| 전체 재고/공실 보드 | ✅ | ✅ | ✅ | 재고는 운영자 모두 봄(원칙#1은 외부 차단) |
| 공급자 원가(VND) 조회 | ✅ | ✅ | ✅ | STAFF도 VND 원가는 OK, KRW만 차단 |
| 제안 링크 생성·가격 설정 | ✅ | ✅ | ❌ | 가격이 걸려 STAFF 차단 |
| 예약·가예약 처리 | ✅ | ✅ | ✅ | STAFF는 KRW 필드 마스킹된 화면 |
| 입금확인·예약 확정 | ✅ | ✅ | ✅ | **STAFF는 금액 숨김 — 🟢일치/🔴미입금 상태만 보고 확정** (§6.1) |
| 캘린더 공실/차단 토글 | ✅ | ✅ | ✅ | |
| 체크인/아웃·검수(여권·동의서·보증금·사진) | ✅ | ✅ | ✅ | |
| 청소 배정·검수 승인 | ✅ | ✅ | ✅ | |
| 강제 SELLABLE(검수 게이트 오버라이드, ADR-0012) | ✅ | ✅ | ❌ | 위험작업, STAFF 차단 |
| Zalo 응대·번역·첨부공유 | ✅ | ✅ | ✅ | |
| **시스템** | | | | |
| 사용자/계정 관리(생성·역할부여·삭제) | ✅ | ❌ | ❌ | OWNER 전용 (`/users`) |
| 시스템 설정(Zalo 연결·API키·`/settings`) | ✅ | ❌ | ❌ | OWNER 전용 |
| 감사 로그(AuditLog) 열람 | ✅ | ❌ | ❌ | OWNER 전용 |

> **핵심 마스킹 규칙**: STAFF는 페이지를 통째로 막는 것만으로 부족하다.
> 예약·빌라 상세처럼 STAFF도 들어가는 화면에 KRW·마진 컬럼이 섞여 있으므로,
> **필드 단위 마스킹**이 필요하다 (공급자가 자기 VND만 보는 기존 패턴의 확장).

## 4. 구현 설계 — 권한 추상화 레이어가 핵심

### 4.1 문제

현재 `role === "ADMIN"` / `role !== "ADMIN"` 비교가 **~40개 파일**에 흩어져 있다
(middleware.ts, app/api/**, app/(admin)/**, lib/dashboard.ts 등).
ADMIN을 3개로 쪼개면 이 비교가 전부 의미가 바뀐다. 문자열 비교를 그대로 늘리면 유지보수 지옥.

### 4.2 해법 — `lib/permissions.ts` (capability 헬퍼)

역할 문자열 비교를 **권한 단위 함수**로 추상화한다. 화면·API는 "어떤 역할인가"가 아니라
"이 권한이 있는가"를 묻는다.

```ts
// lib/permissions.ts (신규)
export type Role = "OWNER" | "MANAGER" | "STAFF" | "SUPPLIER" | "CLEANER";

const OPERATORS: Role[] = ["OWNER", "MANAGER", "STAFF"];

// 운영자 영역 접근 (기존 role==="ADMIN" 대부분을 이걸로 치환)
export const isOperator = (r?: Role) => !!r && OPERATORS.includes(r);

// 돈을 볼 수 있는가 (KRW·마진·이윤·매출·정산 조회)
export const canViewFinance = (r?: Role) => r === "OWNER" || r === "MANAGER";

// 시스템 통제 (계정·설정·감사로그·정산승인·요율마스터)
export const isSystemAdmin = (r?: Role) => r === "OWNER";

// 위험작업 (force-sellable, 삭제 등)
export const canOverrideGate = (r?: Role) => r === "OWNER" || r === "MANAGER";

// 가격이 걸린 작업 (제안링크 생성 등)
export const canSetPrice = (r?: Role) => r === "OWNER" || r === "MANAGER";
```

### 4.3 단계별 치환 매핑 (마이그레이션 가이드)

| 기존 코드 | 대체 |
|---|---|
| `role === "ADMIN"` (운영자 영역 접근) | `isOperator(role)` |
| `role !== "ADMIN"` → 401 (재무·정산 API) | `!canViewFinance(role)` |
| `/users`, `/settings`, Zalo 연결 가드 | `isSystemAdmin(role)` |
| force-sellable, 삭제 라우트 | `!canOverrideGate(role)` → 403 |
| 제안링크 생성 라우트 | `!canSetPrice(role)` → 403 |
| 청소·검수·캘린더·예약 라우트 | `isOperator(role)` (STAFF 통과) |

> **테스트 우선**: 각 API 라우트마다 권한 누수 테스트(STAFF가 재무 401, MANAGER가 정산승인 403)를
> 작성한다. 기존 `tests/zalo-cross-admin-leak.test.ts` 패턴 재사용.

### 4.4 middleware.ts 변경

- `ADMIN_ONLY_PATHS` → `OPERATOR_PATHS` (OWNER/MANAGER/STAFF 통과) + 하위 게이트:
  - `/users`, `/settings` → `isSystemAdmin`만
  - `/settlements`, `/earnings`(이윤), 통계 → `canViewFinance`만
  - 나머지 운영 경로(`/villas` `/bookings` `/proposals`(생성은 API에서) `/inspections` `/calendar` `/cleaning` `/messages`) → `isOperator`
- 로그인 후 홈 리다이렉트: STAFF/MANAGER도 `/dashboard`(단 dashboard는 재무 위젯을 `canViewFinance`로 가림)

### 4.5 화면 필드 마스킹 (STAFF)

- `lib/dashboard.ts`: 매출·이윤·마진 집계는 `canViewFinance` 일 때만 계산·반환. STAFF에는 운영 KPI(체크인 대기, 청소 대기, 만료 임박 홀드)만.
- 예약/빌라 상세 컴포넌트: KRW·마진 컬럼을 `canViewFinance` 조건부 렌더. 서버에서도 select 제외(클라이언트 가림만으로는 누수 — ADR-0011 wifiPassword 교훈 동일).
- 대시보드는 **역할별 위젯 구성**: OWNER(전부)·MANAGER(전부, 시스템설정 진입 없음)·STAFF(운영 큐 only).

## 5. 영향 범위 (구현 시 손댈 곳)

1. `prisma/schema.prisma` — Role enum 3값 추가 + 마이그레이션(ADMIN→OWNER). **TDA 전담, 단일 세션.**
2. `lib/permissions.ts` — 신규 (capability 헬퍼).
3. `middleware.ts` — 경로 게이트 재구성.
4. `app/api/**` (~25개 라우트) — role 비교 → capability 치환 + 누수 테스트.
5. `app/(admin)/**`, `lib/dashboard.ts` — 재무 필드 서버측 마스킹 + 역할별 위젯.
6. `auth.ts` / 세션 타입 — Role 유니온 확장.
7. `app/users/**` (계정 관리) — 역할 부여 UI는 OWNER만, 부여 가능 역할 = MANAGER/STAFF/SUPPLIER/CLEANER.
8. i18n: 역할명 ko/vi 키 추가(`role.owner/manager/staff`). **admin도 vi 필수**(메모리 규칙).
9. 시드(`prisma/seed*.ts`) — ADMIN → OWNER, 샘플 MANAGER·STAFF 계정 추가.

## 6. 미해결·후속 (회의에서 확정)

- **통계/매출/이윤 화면 자체의 기획**은 별도 ADR/SPEC (이 ADR은 *권한 골격*만 정의). 화면 생기면 `canViewFinance` 게이트만 붙이면 됨.
- MANAGER가 **요율 적용**(예약별)은 되지만 **마스터 변경**은 OWNER만 — 요율 화면 생길 때 재확인.
- 계정 **자기 역할 상승 방지**(STAFF가 API로 자기 role을 OWNER로 못 바꾸게) — 계정관리 API에서 `isSystemAdmin` 강제 + 자기 자신 역할변경 금지.

### 6.1 STAFF 입금확인 — 금액 숨김 확정 (2026-06-23 확정)

테오 확정: **STAFF가 입금확인·예약 확정까지 수행한다.** 단 입금액(KRW) = 한국 판매가이므로
그대로 노출하면 §2 마진 비공개가 무너진다(STAFF가 판매가 역산 가능). 따라서:

- 시스템이 내부적으로 **기대금액(숨김) ↔ 실제 입금액**을 비교한다.
- STAFF 화면에는 **금액 없이 상태만**: 🟢 입금 일치 / 🔴 미입금·불일치. STAFF는 "확정 처리" 버튼만.
- 서버 응답에서도 STAFF에게는 KRW 필드 제외(클라이언트 가림 금지 — ADR-0011 교훈).
- **역설**: 자동매칭이 수동입력보다 마진 비공개에 유리하다. 수동이면 누군가 금액을 타이핑하며
  보게 되지만, 자동매칭이면 STAFF는 ✓/✗만 본다. → 입금 자동화의 1차 동기는 *편의*가 아니라 *권한 분리*.

### 6.2 카카오뱅크 입금 자동매칭 — Phase 2 (수단 재검토 필요)

테오 구상: 카카오뱅크 개인 계정 입출금 내역을 API로 연결해 입금 자동확인.
**판단 수정**: 사업자 유무가 아니라 **카뱅이 개인에게 거래내역 조회 API를 제공하지 않는 것**이 제약.

| 경로 | 가능? | 비고 |
|---|---|---|
| 카뱅 자체 공개 API | ❌ | 개인용 미제공(제휴/기업만) |
| 오픈뱅킹(금융결제원) | ❌ | 핀테크 이용기관 등록(사업자·보안점검) 필요 |
| 마이데이터 | ❌ | 금융위 허가제 라이선스 |
| 스크래핑 집계 API(CODEF·페이히어) | △ | 유료·인증수단 서버보관, 전자금융거래법·약관 회색지대 (최후수단) |
| **입금 알림 파싱(푸시/SMS)** | ✅ 권장 | 본인 기기 카뱅 입금 알림 → 자동화(MacroDroid/Tasker)→ webhook. 인증수단 보관 불필요. Zalo 알림 파이프라인 구조 재사용 |

- **권장 1차안**: 입금 알림 파싱 webhook → 입금자명·금액 파싱 → 예약 자동매칭.
- **매칭 정확도**: 입금자명+금액만으론 동명·동일금액 충돌 → 예약별 고유코드(예: 입금자명 "홍길동A7")를
  제안링크에 안내. 정석(PG 가상계좌)은 사업자 필요라 더 뒤.
- Phase 1에서는 **수동 금액입력(OWNER/MANAGER)** + STAFF 상태확정으로 시작, 자동매칭은 Phase 2 얹기.

## 7. 단계적 출시(권장 순서)

1. **S-RBAC-1 (TDA)**: schema Role 확장 + 마이그레이션 + `lib/permissions.ts` + auth 타입. (DB 단일세션)
2. **S-RBAC-2 (BE)**: API 라우트 capability 치환 + 권한 누수 테스트 일괄.
3. **S-RBAC-3 (FE)**: middleware 게이트 + 대시보드 역할별 위젯 + 재무 필드 마스킹.
4. **S-RBAC-4 (FE+LOC)**: 계정관리(역할부여) UI(OWNER) + 역할명 i18n.
5. (이후) 통계·매출·이윤 화면은 게이트 위에 자유롭게 추가.
