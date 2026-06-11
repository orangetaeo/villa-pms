# ADR-0006 — 신규 빌라 판매 게이트 초기 개방: 승인 시 초기 검수 태스크 자동 생성

- 상태: 승인 (2026-06-11, TDA — T3.4b)
- 배경: T3.4 QA 관찰 — Villa는 기본 `isSellable=false`이고 게이트를 여는 유일한 경로가
  청소 검수 승인(`approveCleaningTask`)인데, 청소 태스크는 체크아웃·월간 cron에서만 생성됨.
  신규 승인 빌라는 체크아웃이 있을 수 없으므로 **첫 판매가 구조적으로 불가능** (닭과 달걀).

## 결정 (v2 — QA 반려 반영: PERIODIC 승인은 기존 게이트 분기에 미진입)

**① 빌라 최초 APPROVE(PENDING_REVIEW→ACTIVE) 트랜잭션 안에서 초기 검수 CleaningTask를 자동 생성하고,
② `approveCleaningTask`의 게이트 개방 조건을 "CHECKOUT 승인 또는 빌라의 첫 APPROVED 승인"으로 확장한다.**

②가 필요한 이유: 기존 게이트 분기는 `task.type === CHECKOUT` 전용이라 PERIODIC인 초기 검수를
승인해도 게이트가 열리지 않았다(QA Critical). "첫 APPROVED" 조건은 초기 검수뿐 아니라
**검수 이력 없이 ACTIVE가 된 기존 빌라(시드 등)의 첫 월간 검수 승인도 게이트를 열어** 잔여
경로 문제를 함께 해소한다. 이후의 일반 PERIODIC 승인(APPROVED 이력 존재)은 종전대로 게이트에
영향이 없고, 미결 CHECKOUT 0건 조건은 모든 개방에 공통 적용되어 체크아웃 게이트 우회는 불가능하다.

- `lib/cleaning.ts createInitialInspectionTask(tx, …)` — 해당 빌라에 CleaningTask가
  **0건일 때만** 생성 (멱등 — 재승인·REACTIVATE·검수 이력 빌라는 미생성)
- type은 기존 `PERIODIC` 재사용 + Notification payload `initialInspection: true`로 구분
  (CleaningType enum 추가는 스키마 변경 — 규칙 #6 비용 대비 이득 없음. /inspections 화면에서
  초기 검수와 월간 정기가 구분되지 않는 표시 한계는 수용 — IDEAS 후보)
- 운영 흐름: ADMIN 승인 → 공급자 Zalo 알림(CLEANING_REQUEST, T3.5 큐) → 공급자가
  현 상태 사진 제출(a4/a8 — T3.8) → ADMIN /inspections 승인 → 기존 게이트 메커니즘
  (미결 CHECKOUT 0건)으로 `isSellable=true` → 제안 후보 노출

## 기각한 대안

- **ADMIN 수동 개방 토글**: 사진 검수 없이 게이트를 여는 우회 경로 — 사업 원칙 3
  ("청소 검수 승인 전 SELLABLE 전환 금지") 위반 소지. 검수 증빙(사진)이 분쟁 대비
  자산이기도 함 → 기각
- **승인 시 isSellable=true 직접 설정**: 게이트 setter가 둘이 되어 단일 소스 붕괴 → 기각
- **CleaningType.INITIAL 추가**: enum 마이그레이션 + 상태기계·화면 분기 추가 비용,
  PERIODIC과 처리 흐름이 동일 → 기각 (Phase 2에서 통계 필요 시 재검토)

## 영향

- `app/api/villas/[id]` APPROVE 응답에 `initialInspectionCreated` 추가 (화면 무변경)
- 게이트 setter는 `approveCleaningTask` 단일 유지 — 본 결정은 태스크 생성 추가 + 그 함수 내부의 개방 조건 확장(v2)이며 setter 위치는 불변
- 기존 ACTIVE 빌라(시드 등 — 승인 시점을 지난 빌라): 월간 PERIODIC cron이 만드는
  태스크가 그 빌라의 **첫 APPROVED**가 되므로, 그 승인이 결정 ②에 의해 게이트를 연다
  (v1의 "월간 PERIODIC로 개방" 서술은 분기 미진입으로 허위였음 — QA 정정)
