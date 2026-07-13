# ADR-0039 — 운영자 Zalo 알림 그룹방 발송

- 상태: 채택 (2026-07-13)
- 관련: ADR-0005(Zalo 개인계정 발송), ADR-0007(멀티 계정 풀), ADR-0010 S4(그룹 채팅), ADR-0032(리스너 워커 분리)
- 계약: `docs/contracts/zalo-admin-group-notify.md`

## 배경

운영자(테오의 Zalo 계정 2개 — 김태진·DK) 대상 업무 알림이 그동안 `zaloUserId`가 연결된 활성
운영자 수만큼 **개별 1:1 DM**으로 fan-out 됐다(빌라 등록·입금통보·발주 응답·명단 리마인더 등).
테오가 Zalo 그룹방 **"villa go 주문 알림방"**을 개설 — 운영자 알림을 이 그룹방 **1건**으로 모아
받고자 함. 그룹 대화는 이미 리스너가 수집한다(`ZaloConversation.threadType=GROUP`, `zaloUserId`
슬롯=그룹 id, `displayName`=그룹명). 발송은 시스템봇(zca-js)이며 `lib/zalo-runtime.sendVia`가
`ThreadType.Group`을 지원한다(ADR-0010 S4).

## 결정

### 1. 스키마(additive): `Notification.groupThreadId String?`

```prisma
model Notification {
  // ...
  groupThreadId String? // 설정 시 dispatchOne이 시스템봇 ThreadType.Group으로 발송 (ADR-0039)
}
```

- raw SQL(`prisma/migrations-manual/2026-07-13-notification-group-thread.sql`)로 라이브 적용 + `prisma generate`.
- 인덱스 없음 — dispatch 쿼리는 `channel+status` 기준이고 `groupThreadId`로 필터하지 않는다.

**컬럼 vs 마커(payload 내 플래그) vs 별도 모델 비교**:
- **payload 내 마커**: 재시도 시 `withAttempt`가 payload를 재작성하고, 본문 빌더가 payload를 읽는다.
  발송 대상(그룹 id)을 payload에 섞으면 재작성·본문 누수 위험과 "데이터 vs 라우팅" 경계 혼탁.
- **별도 모델(예: NotificationRoute)**: 발송 1건당 조인 추가 — dispatch 배치 쿼리 복잡도만 늘고 이득 없음.
- **선택: 스칼라 컬럼**. dispatch가 이미 Notification 1행을 읽으므로 조인·재작성 없이 분기 1개로 끝난다.
  그룹 발송과 개별 DM이 **같은 Notification 파이프라인(PENDING→SENT/FAILED·3회 재시도·미러)**을
  그대로 재사용한다(이중화 0).

### 2. 그룹 행의 소유자(userId)와 DM 폴백

- 그룹 라우팅 시 Notification 1행은 `userId=시스템봇 소유자(getSystemBotOwnerId)`, `groupThreadId=설정값`.
- `dispatchOne`의 **그룹 분기는 `NO_ZALO_LINK` 판정보다 먼저**(코드 앞) 온다. 그룹 행은 `user.zaloUserId`를
  **절대 참조하지 않는다** — 시스템봇 소유자가 Zalo 미연결이어도 그룹 발송은 가능하므로, zaloUserId 유무로
  영구 FAILED 처리하면 알림이 사장된다(설계 사고 지점).
- 게이트 3중 중 **소유자 미상(미연결)**이면 그룹 라우팅을 포기하고 **개별 DM fan-out으로 폴백**한다
  (`lib/operator-notify.enqueueOperatorNotification`). 즉 그룹 미설정·화이트리스트 밖·소유자 미연결 →
  전부 기존 동작 보존(회귀 0).

### 3. `GROUP_ROUTED_TYPES` 화이트리스트

운영자 전원이 같은 정보를 받으면 되는 업무 통지만 그룹으로 라우팅한다:
`VILLA_PENDING_REVIEW`, `VILLA_CONTENT_UPDATED`, `GUEST_PAYMENT_NOTICE`, `SERVICE_ORDER_REQUESTED`,
`SUPPLIER_DIRECT_BOOKING`, `VENDOR_PO_RESPONSE`, `ROSTER_REMINDER`, `RATE_CHANGED_DURING_PROPOSAL`.

**의도적 제외 (화이트리스트에 절대 추가 금지)**:
- `SECURITY_ALERT`: 개인 대응 행동 요구(SecurityEvent 확인·인시던트 절차 `docs/ops/incident-response.md`).
  그룹 소음화가 부적절하고 수신자 성격이 다르다.
- `ZALO_LISTENER_DOWN`: 시스템봇 자체가 죽었을 때 오는 경보라 그룹 발송이 실패할 수 있고, 이중 채널
  (인앱 폴백 + Zalo)로 전달되도록 `lib/zalo-health`가 별도 설계돼 있다.

공급자·벤더·게스트·청소자 대상 알림(`VENDOR_PO`, `SETTLEMENT_READY`, `TAMTRU_PASSPORT`,
`CLEANING_*`, `BOOKING_*`, `VENDOR_PROPOSAL_RESULT` 등)은 애초에 대상이 아니다(운영자 전용만).

### 4. 그룹 멤버십 전제와 원가 노출 수용

그룹 멤버는 **운영자만** 두는 것을 전제한다(관리 책임=테오, 설정 UI 안내문 명시). 이 전제 위에서
`RATE_CHANGED_DURING_PROPOSAL`(원가 변경 전→후 표기)처럼 **원가가 포함된 운영자 알림도 그룹 라우팅
대상에 포함**한다 — 원가는 운영자의 정당 열람 정보이고, 멤버가 운영자로 한정되므로 마진 비공개 원칙
(판매가·마진은 여전히 어느 알림에도 미포함)과 상충하지 않는다. 본문 빌더는 화이트리스트 필드만 읽어
개별 DM과 동일 문구를 생성한다(누수 경계 불변).

### 5. 설정 UI/API

- API: `GET/PUT /api/settings/zalo-notify-group`(ADMIN 전용). GET=시스템봇 소유자의 GROUP 대화 목록 +
  현재값. PUT=`AppSetting.ZALO_ADMIN_NOTIFY_GROUP_ID` 저장/해제(null). 저장값은 소유자 GROUP 대화 중
  하나여야 함(임의 thread id 주입 400). `writeAuditLog` 기록.
- UI: `/settings`에 "Zalo 알림 그룹" 카드 — 그룹 select + "미설정 시 운영자 개별 DM 발송" 안내.

### 6. 잔여: booking-change-request 직발송

`lib/booking-change-request.notifyOperatorsOfChangeRequest`는 큐 미경유 **즉시** `sendBotMessage`
직발송이다(파트너 변경요청 통지). 이 경로도 그룹 설정 시 `sendBotGroupMessage`로 그룹방 1건 직발송,
미설정 시 기존 개별 직발송(최소 수정). 큐 파이프라인과 달리 재시도·미러는 없다(기존 best-effort 유지).

## 영향

- 발송 계층: `lib/zalo-runtime`에 `sendBotGroupMessage` 추가, `sendBotMessage`에 선택 `threadType` 파라미터
  (기본 USER — 기존 호출 시그니처·동작 불변). 워커 위임(`WorkerSendCommand.sendBotMessage`)에 `threadType?`.
- 적재 계층: 운영자 fan-out 지점 8곳을 `enqueueOperatorNotification`으로 통일(단일 원천).
  `findNotifiableOperators`는 `lib/villa-notify`→`lib/operator-notify`로 이동(재노출로 기존 import 호환).
- 발송 계층: `dispatchOne`에 `dispatchGroupOne` 분기(그룹 전용, 텍스트만, 첨부 없음).

## 검증

- 단위: `lib/operator-notify.test.ts`(게이트 3중), `lib/zalo-dispatch-group.test.ts`(NO_ZALO_LINK 미적용·
  BOT_NOT_CONNECTED 재시도 유지·미러). 기존 회귀 없음(그룹 미설정 기본값에서 fan-out 유지).
- QA: 실 그룹방 발송(시스템봇이 그룹 멤버여야 함)·누수 체크(마진·판매가 미노출)·토큰 만료·타임아웃 케이스.
