# 계약서: 벤더 시간제안 — 소비자 승인/거절 + 벤더 가시성 + 거절 통계

- 담당: BE (구현) / QA (독립 검증) / 메인 세션(Fable) = TDA 설계·스키마 승인
- 브랜치: worktree-proposal-guest-resolution
- 배경(테오 실측 2026-07-10, 마사지 테스트): 벤더가 시간 제안(propose)을 하면
  ① vendorStatus=VENDOR_ACCEPTED가 되어 벤더 발주함 리스트에서 사라짐(추적 불가)
  ② 소비자에게 제안이 안 보이고 승인/거절 프로세스가 없음(현재는 운영자만 apply-proposal)
  ③ 거절됐을 때 벤더 화면에 표시가 없음 ④ 거절 통계가 벤더·ADMIN 어디에도 없음.
- 전제: ADR-0033(자동발주·자동확정)·ADR-0034(티켓 발행) 배포됨.

## 설계 결정 (TDA)
- **제안 해결 주체 = 소비자**(GUEST 주문): 게스트가 신청 내역에서 제안을 승인/거절.
  운영자 apply-proposal은 유지(파트너/운영자 주문 + 대리 처리).
- **거절 시 발주 사이클 복귀**: vendorStatus=VENDOR_ACCEPTED→PENDING_VENDOR로 되돌려
  벤더가 원래 시간 기준으로 재응답(수락=GUEST 자동확정 / 거절 / 재제안). 벤더 발주함에
  다시 나타나므로 "거절이 벤더에게 보임"이 구조적으로 보장 + Zalo/인앱 즉시 통보.
- **스키마 additive 1필드**: `ServiceOrder.vendorProposalOutcome String?`
  ("APPLIED"=적용(게스트 승인 또는 운영자 적용) | "DECLINED"=고객 거절 | "DISMISSED"=운영자 무시).
  재제안(propose) 시 null 리셋. 통계는 주문당 최신 제안 결과 스냅샷 기준(완전 이력
  테이블은 과설계 — ADR에 명시). 라이브 적용 raw SQL.
- 게스트 알림 채널 없음 → 신청 내역 페이지 내 배너+제안 카드가 "알림"(ordered 배너와
  동일 패턴). 벤더 통보는 기존 VENDOR_PROPOSAL_RESULT(Zalo)+인앱 재사용, 고객 거절
  케이스만 payload 플래그로 문구 분기.

## 범위 (Scope)

### 1. 게스트 제안 응답 API — 신규 `POST /api/g/[token]/service-orders/[id]/proposal`
- 토큰 검증(guestTokenState)+rate limit+CSRF(기존 게스트 mutation 패턴).
- 스코프: bookingId=토큰 예약 && requestedVia=GUEST && proposedServiceDate!=null
  && vendorProposalRespondedAt=null. 아니면 404/409.
- body {action:"accept"|"decline"}:
  - accept → serviceDate/Time=제안값, vendorProposalRespondedAt=now, outcome=APPLIED,
    **status REQUESTED→CONFIRMED 원자 전이**(벤더는 이미 VENDOR_ACCEPTED — ADR-0033 일관).
  - decline → vendorProposalRespondedAt=now, outcome=DECLINED,
    **vendorStatus VENDOR_ACCEPTED→PENDING_VENDOR 복귀**(원자, where 스냅샷 가드).
- 벤더 통보(양쪽 다): 인앱(VENDOR_PROPOSAL_APPLIED / 신규 문구 VENDOR_PROPOSAL_DECLINED)
  + Zalo VENDOR_PROPOSAL_RESULT(payload에 declinedByGuest 플래그 → zalo 빌더 문구 분기
  "고객이 제안을 거절 — 원래 시간(X) 재검토 요청"). 운영자 인앱 정보 알림(현황 인지).
- AuditLog. 통보는 count 검사 후.

### 2. 운영자 apply-proposal 보강
- outcome 기록(APPLIED/DISMISSED). GUEST 주문 apply 시 status REQUESTED→CONFIRMED
  동반 전이(ADR-0033 일관 — 지금은 propose 경로만 확정이 수동으로 남는 구멍).

### 3. 벤더 respond(propose) 리셋
- 재제안 시 vendorProposalOutcome=null 포함(기존 vendorProposalRespondedAt=null과 쌍).

### 4. 벤더 보드 "시간제안" 탭 (vi)
- components/vendor/vendor-board.tsx: Tab에 "proposal" 추가(발주함/시간제안/예약현황/정산내역).
- /api/vendor/orders tab=proposal: proposedServiceDate!=null 주문(본인 스코프) —
  미해결(respondedAt null)="고객 응답 대기", 해결=outcome 뱃지(수락됨/고객 거절됨/미적용).
  정렬 미해결 우선. 거절(DECLINED)된 주문은 발주함에도 PENDING_VENDOR로 재노출되며
  카드에 "제안 거절됨 — 원래 시간 재검토" 뱃지.
- 탭 미읽음 카운트(미해결+최근 거절) 뱃지는 기존 탭 스타일 따름(선택).
- vendor NS i18n ko/vi.

### 5. 게스트 화면 (5언어)
- lib/guest-checkin-load.ts requestedOrders에 proposedServiceDate/Time·
  vendorProposalNote·미해결 여부(+제안 존재 시 원래 시간 비교용은 기존 serviceDate/Time).
- guest-orders.tsx: 미해결 제안 있으면 페이지 상단 배너("담당자가 시간 변경을 제안했습니다")
  + 해당 주문 카드에 제안 블록: 원래 시간 → 제안 시간 비교, 제안 메모, [승인]/[거절] 버튼
  → API 호출 → router.refresh. 승인=확정 안내, 거절="담당자가 다시 확인합니다" 안내.
- GUEST_LABELS 전 언어 동수 추가.

### 6. 거절 통계
- 벤더 /api/vendor/stats + app/vendor/stats: 제안 통계 블록 — 제안 수·수락(APPLIED)·
  고객 거절(DECLINED) (vendorId 스코프, proposedServiceDate!=null 기준 스냅샷 집계).
- 관리자 app/(admin)/service-orders(service-orders-view.tsx + 데이터 소스): 요약 칩에
  "제안 진행 중 N · 고객 거절 N" 추가 + 행에 제안 상태 뱃지(기존 제안대기 칩 확장).
- 금액·마진 무관(일정 협의) — 신규 누수 표면 없음 유지.

### 7. 문서
- ADR-0035(제안 해결 주체=소비자·거절=PENDING_VENDOR 복귀·outcome 스냅샷 통계).
- docs/NOTIFICATIONS.md: D-08 트리거에 게스트 승인/거절 반영, 신규 인앱(고객 거절) 기록.
- PROGRESS.md는 메인 세션이 커밋 직전.

## 수정 금지 구역
- 티켓 발행 경로(ADR-0034)·자동발주/자동확정 기본 로직(ADR-0033) — 제안 분기 외 무변경.
- prisma/schema.prisma는 메인 세션이 이미 반영(vendorProposalOutcome) — 추가 변경 금지.

## 완료 기준 (테스트 가능)
1. 게스트 accept → serviceDate/Time 교체+outcome=APPLIED+status=CONFIRMED 원자,
   벤더 인앱+Zalo(applied) 적재. decline → outcome=DECLINED+PENDING_VENDOR 복귀,
   벤더 통보(거절 문구)+운영자 인앱.
2. 타 토큰/비GUEST/미제안/기해결 → 404/409. 동시성: 게스트 응답 vs 운영자 apply 한쪽만 승리.
3. 벤더 보드 시간제안 탭: 미해결·해결(outcome별) 표시, 발주함에 DECLINED 재노출+뱃지.
4. 벤더 재제안 시 outcome/respondedAt null 리셋. 운영자 apply(GUEST)=CONFIRMED 동반.
5. 통계: 벤더 stats 제안 블록·관리자 service-orders 칩 — DECLINED 카운트 일치.
6. 게스트 5언어·vendor/admin ko/vi 파리티. 누수 0. tsc·vitest 회귀 0·build 통과.
