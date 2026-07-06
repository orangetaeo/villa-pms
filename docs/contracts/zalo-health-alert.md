# 계약: Zalo 리스너 헬스 감시·경보 (watchdog)

- **브랜치**: `wt/zalo-health-alert` (worktree 격리)
- **배경 (테오 승인 2026-07-06)**: "상대 채팅 늦게 도착" 조사 결과 — ①배포마다 리스너 블랙아웃 ②김태진(Jini) 계정 6/21부터 재로그인 실패가 **2주간 무감지**. 리스너 장애를 감시·경보하는 장치가 없음(security-alerts cron은 SecurityEvent만).

## 범위

### 인프로세스 워치독 (`lib/zalo-health.ts` 신규)
- 리스너 풀이 웹 프로세스 메모리에 있으므로 **Railway cron 등록 불필요** — instrumentation에서 시작하는 setInterval(5분) 인프로세스 감시(globalThis 싱글턴 가드).
- 대상: `ZaloAccount(isActive, credentials≠null)` 전체. 판정: 풀 인스턴스 status ≠ "connected" (인스턴스 없음 포함).
- 오탐 방지: **2회 연속(≈10분)** 미연결일 때만 경보(배포 직후 일시 끊김 무시). 계정별 쿨다운 6시간(스팸 방지, 재기동 시 리셋 허용).
- 경보 채널(이중):
  1. **인앱**(enqueueInAppNotification) — 계정 소유자 + 운영자 전원(OPERATOR_ROLES·isActive). href=/zalo-connect. Zalo가 죽어도 전달됨.
  2. **Zalo**(enqueueNotification, 신규 `ZALO_LISTENER_DOWN`) — zaloUserId 연결된 운영자. 시스템봇 자체가 죽은 경우 실패 허용(인앱이 폴백).
- 판정·쿨다운 로직은 순수 함수로 분리(단위 테스트).

### 스키마·문구
- `NotificationType.ZALO_LISTENER_DOWN` additive — 라이브 `ALTER TYPE ... ADD VALUE IF NOT EXISTS`(선적용) + schema enum + `lib/zalo.ts` buildNotificationText exhaustive switch case(ko, 계정명·미연결 경과·/zalo-connect 안내. 비번·credential 미포함).

### 부수
- IDEAS.md: "Zalo 리스너 전용 서비스 분리(배포 블랙아웃 제거)" 등록.

## 완료 기준
1. 워치독 단위 테스트: streak 2 미만 무경보 / 2회 연속 시 1회 경보 / 쿨다운 내 재경보 없음 / 복구 시 streak 리셋.
2. buildNotificationText 전 타입 통과(기존 zalo.test 전수 루프에 새 case 포함).
3. tsc·vitest·next build 통과. 배포 후 워치독이 Jini 계정(현재 실패 중)을 감지해 인앱+Zalo 경보 적재되는지 라이브 확인.

## 수정 금지 구역
- cron-notifications 발송 로직, zalo-runtime 리스너 수신 경로(상태 읽기만), 기타 알림 타입 문구.
