# ADR-0035 — 벤더 시간 제안, 소비자 해결 + 벤더 가시성 + 거절 통계

- 상태: 채택(Accepted) · 2026-07-10
- 관련: ADR-0033(게스트 주문 자동발주·벤더 accept=GUEST 자동 CONFIRMED), ADR-0034(티켓 발행)
- 계약서: `docs/contracts/proposal-guest-resolution.md`

## 배경 (테오 실측 버그 4건)

벤더가 발주함에서 시간을 제안(`respond` action=`propose`)하면 `vendorStatus`가 `VENDOR_ACCEPTED`로 바뀌면서:
1. 벤더 발주함(inbox=PENDING_VENDOR) 리스트에서 사라져 추적 불가
2. 소비자(게스트)에게 제안이 노출되지 않고 승인/거절 프로세스가 없음(운영자만 apply-proposal)
3. 거절됐을 때 벤더 화면에 표시 없음
4. 거절 통계가 벤더·운영자 어디에도 없음

## 결정

### 1. 제안 해결 주체 = 소비자(GUEST 주문)
게스트가 신청 내역 페이지(`/g/[token]/orders`)에서 제안을 **승인/거절**한다. 운영자 `apply-proposal`은 대리 처리(파트너·운영자 주문 포함)로 유지한다.
- 신규 API: `POST /api/g/[token]/service-orders/[id]/proposal` (토큰+rate limit+CSRF, 기존 게스트 mutation 패턴).
- **accept** → `serviceDate/Time`=제안값, `status` REQUESTED→CONFIRMED **원자 전이**(벤더는 이미 VENDOR_ACCEPTED이므로 ADR-0033 자동확정과 정합).
- **decline** → `vendorStatus` VENDOR_ACCEPTED→**PENDING_VENDOR 복귀**. 발주함에 다시 나타나 벤더가 원래 시간 기준으로 재응답(수락/거절/재제안).
- 동시성: `updateMany` where에 `vendorProposalRespondedAt:null` + 상태 스냅샷 가드 → 게스트 응답과 운영자 apply-proposal이 레이스해도 한쪽만 승리(count=0→409).

### 2. 거절 시 발주 사이클 복귀
"거절이 벤더에게 보임"을 구조적으로 보장. 무한 재제안 루프(벤더가 다시 propose→게스트가 다시 decline…)는 **운영에서 수용**한다(정책적 상한 없음 — 실무상 드묾).

### 3. outcome 스냅샷 통계 (`ServiceOrder.vendorProposalOutcome String?`)
- `"APPLIED"`(게스트 승인 또는 운영자 적용) · `"DECLINED"`(고객 거절) · `"DISMISSED"`(운영자 무시) · `null`(미해결/제안 없음).
- 재제안(`respond` propose) 시 `vendorProposalRespondedAt`과 함께 **null 리셋**.
- 통계는 **주문당 최신 제안 결과 스냅샷** 기준(완전 이력 테이블은 과설계 — 재제안 시 이전 결과를 덮어씀. 완전 이력은 비범위).
- **outcome은 재수락으로 해소돼도 유지한다(사실 기록)**: 게스트 거절(DECLINED) 후 벤더가 원래 시간으로 재수락(plain accept→GUEST 자동확정 CONFIRMED)해도 `vendorProposalOutcome`은 DECLINED로 남아 **거절 통계(벤더·운영자)에 그대로 계상**된다("한 번 거절당한 사실"은 실적 지표). 단 **UI 경고 뱃지는 미해소 상태(vendorStatus=PENDING_VENDOR)에서만** 노출: 재수락돼 CONFIRMED가 되면 관리자 "고객 거절" 행 뱃지·벤더 발주함 DECLINED 안내는 미표시(일반 상태 뱃지가 현황 전달), 벤더 시간제안 탭은 red "고객 거절" 대신 slate "거절 후 해소"로 톤 다운. 근거: 통계=사실, UI 경고=행동 필요 여부.
- 스키마 additive 1필드, 라이브 raw SQL 적용(마이그레이션 파일 별도).

### 4. 운영자 apply-proposal 보강
`vendorProposalOutcome`(APPLIED/DISMISSED) 기록 + **GUEST 발주 apply 시 status REQUESTED→CONFIRMED 동반 전이**(propose 경로만 수동확정으로 남던 구멍 봉합). where에 status=REQUESTED 가드.

### 5. 게스트 알림 = 페이지 내
게스트는 푸시/Zalo 채널이 없다. 신청 내역 페이지 상단 배너 + 해당 주문 카드의 제안 블록(원래→제안 시간 비교, 승인/거절 버튼)이 "알림" 역할(ordered 배너와 동일 패턴, 5언어).

### 6. 벤더 통보 (기존 채널 재사용 — enum 추가 없음)
- accept: 인앱 `VENDOR_PROPOSAL_APPLIED` + Zalo `VENDOR_PROPOSAL_RESULT` `{applied:true}`.
- decline: 인앱 신규 문구 `VENDOR_PROPOSAL_DECLINED`(String type) + Zalo `VENDOR_PROPOSAL_RESULT` `{applied:false, declinedByGuest:true}` → zalo 빌더가 발주함 복귀 문구로 분기(플래그 없으면 기존 무시 문구 — 구 payload 하위호환).
- 운영자: 인앱 정보 알림(`GUEST_PROPOSAL_ACCEPTED`/`GUEST_PROPOSAL_DECLINED`, href=/bookings/{id}).
- `NotificationType` enum은 **추가하지 않는다**(exhaustive switch 함정 회피 — VENDOR_PROPOSAL_RESULT 재사용). 인앱 type은 String이라 자유.

### 7. 가시성·통계 화면
- 벤더 보드: "시간 제안" 탭(발주함→시간제안→예약현황→정산내역) — 미해결(고객 응답 대기)/APPLIED/DECLINED/DISMISSED 뱃지. 발주함 카드에 DECLINED 재노출 뱃지.
- 벤더 통계(`/vendor/stats`): 제안 수·수락·고객 거절(전역 스냅샷, vendorId 스코프).
- 운영자 `/service-orders`: 요약 칩 "제안 진행 중 N · 고객 거절 N"(전역 스냅샷·필터 무관, allBasis 라벨) + 중계현황 행 DECLINED 뱃지.

## 누수 경계
게스트·벤더 응답에 판매가·원가·마진·bankInfo 신규 노출 없음. 벤더 통보/화면은 일정 협의 필드만(costVnd는 시간제안 탭 미표기 — 추적용).

## 결과
테오 실측 4버그 해소: 추적 가능(시간제안 탭)·소비자 승인/거절 프로세스·거절 벤더 가시성(발주함 복귀+뱃지)·거절 통계(벤더·운영자).
