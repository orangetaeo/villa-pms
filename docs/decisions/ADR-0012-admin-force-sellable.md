# ADR-0012 — ADMIN 강제 판매가능 처리: 검수 게이트 의식적 오버라이드

- 상태: 채택 (2026-06-22, BE)
- 관련: ADR-0006(초기 검수 게이트), 사업 핵심 원칙 3(검수 게이트)

## 맥락

ADR-0006은 "신규 빌라는 공급자가 현 상태 사진을 제출 → ADMIN 검수 승인 →
기존 게이트 메커니즘으로 `isSellable=true`"라는 단일 경로를 확립했고,
**ADMIN 수동 개방 토글을 명시적으로 기각**했다(검수 증빙이 분쟁 대비 자산이라는 근거).

그러나 사업 모델이 바뀌었다. 테오 팀이 빌라를 **직접 방문·검수·촬영해 올리는 직접
온보딩 모델**로 전환되면서, 공급자의 청소사진 제출을 전제로 한 기존 검수 게이트가
초기 등록을 구조적으로 막는다. 운영자가 직접 검수를 마친 빌라조차 공급자 제출·승인
사이클을 강제로 통과해야 판매가능이 되어, 초기 재고 확보가 불가능하다.

## 결정

**ADMIN 전용 강제 판매가능 경로를 별도로 추가한다 (`lib/villa-gate.ts`).**

- 사업 핵심 원칙 3(검수 게이트)을 **의식적으로 푸는 예외**임을 인정하고, 전량 감사
  로그(`reason` 권장, AuditLog `isSellableGate: FORCED_OPEN`)로 정당화한다.
- 게이트 단일 setter 원칙(`approveCleaningTask`)을 **보완**한다. 기존 setter는
  불변으로 두고(`lib/cleaning.ts` 미수정), 강제 개방은 **물리적으로 분리된 별도
  경로**(`lib/villa-gate.ts forceOpenSellableGate`)로만 수행한다. 두 경로가
  코드상 구분되므로 강제 개방은 감사에서 항상 식별 가능하다.
- 가드: **ACTIVE 빌라만** 허용. PENDING_REVIEW·REJECTED·INACTIVE·DRAFT는 거부
  (승인 안 된 빌라를 판매가능으로 만들지 않는다 — route 404/409 매핑).
- 멱등: 이미 `isSellable=true`면 no-op.
- 미결 초기/정기 검수 태스크(PERIODIC·bookingId=null·미결)는 APPROVED로 정리해
  인박스 큐를 청소한다. **CHECKOUT 태스크는 절대 건드리지 않는다**(실 청소 필요분
  보존). 미결 CHECKOUT이 있으면 `openCheckoutWarning`으로 운영자에게만 인지시킨다.
- 노출: 응답에 마진·판매가(KRW)·원가 미포함 (사업 핵심 원칙 2).

## 근거

- 직접 온보딩 모델에서는 운영자 자신이 검수자이므로, 공급자 제출을 전제한 게이트가
  오히려 검수 품질과 무관한 절차적 차단이 된다.
- 게이트를 우회하되 **감사 추적성을 100% 유지**하면, 원칙 3의 핵심(검수 없는 판매
  방지·분쟁 대비 증빙)은 "운영자 책임 + 감사 로그"로 대체 충족된다.
- 별도 경로 + 별도 AuditLog 라벨(FORCED_OPEN)로 정상 검수 개방과 강제 개방을 항상
  구분할 수 있어, ADR-0006이 우려한 "단일 소스 붕괴"를 회피한다.

## 기각한 대안

- **게이트 제거(`isSellable` 자동화 폐기)**: 공급자 자가 등록 경로(기존 모델)가
  병존하므로 게이트 자체는 여전히 필요. 전면 제거는 과도 → 기각.
- **수동 토글 상시 노출(임의 on/off)**: off(판매가능→불가) 회귀·반복 토글은 게이트
  의미를 무너뜨린다. 본 결정은 **강제 개방(open) 단방향**만, 그것도 별도 감사 경로로
  제한 → 상시 양방향 토글은 기각.
- **ADR-0006 폐기**: 직접 온보딩과 공급자 자가 등록이 병존하므로 ADR-0006의 검수
  경로는 유지하고 본 ADR은 예외 경로만 추가 → ADR-0006은 유효.

## 영향

- 신규: `lib/villa-gate.ts`(`forceOpenSellableGate`·`canForceOpenForStatus`),
  `POST /api/villas/[id]/force-sellable`(ADMIN 전용), `tests/villa-force-sellable.test.ts`.
- `lib/cleaning.ts` 게이트 setter는 불변 — 강제 개방은 본 모듈로만.
- FE: ADMIN 대시보드의 강제 판매가능 버튼·i18n은 다음 FE 단계 (이번 범위 아님).
- 감사: 강제 개방은 AuditLog `isSellableGate: { new: "FORCED_OPEN" }`로 항상 식별 가능.
