# 계약서: 운영자 알림 일시정지 스위치 (operator-notify-pause-switch)

- 상태: 착수 (2026-07-14)
- 담당: BE (Opus) / QA 독립 검증
- 발단: 테오 지시 — "관리자에게 알림 가는 걸 잠시 멈춰줘". 기존 킬스위치 부재.

## 설계 (메인 세션 확정)

- AppSetting 키 `ZALO_OPERATOR_NOTIFY_PAUSED` — 값 "1" 또는 "true"(trim, 대소문자 무관)면 일시정지.
- lib/operator-notify.ts `enqueueOperatorNotification` 최상단 게이트: 일시정지면 **그룹·개별 DM 폴백 모두 적재 없이 0 반환**(드롭 — 재개 후 소급 발송 없음, 단순성 우선).
- **fail-open**: AppSetting 조회 실패(throw)·키 부재·빈 값 = 정지 아님(알림 정상) — 실수로 전체 알림이 침묵하는 사고 방지.
- **범위**: enqueueOperatorNotification 경유 업무 알림만. SECURITY_ALERT(lib/security-alerts)·ZALO_LISTENER_DOWN(lib/zalo-health)은 별도 직접 적재 경로라 **영향 없음(계속 발송)** — 의도된 경계.
- 공급자·벤더·게스트·청소자 알림은 무관(불변).
- docs/NOTIFICATIONS.md에 스위치 존재·범위 1줄 추가(알림 내역서 동시 갱신 규칙).

## 수정 금지 구역

- lib/zalo.ts·lib/zalo-health.ts·lib/security-alerts.ts, 각 호출부(payload) 전부.

## 완료 기준

- [ ] 키 "1"/"true" → enqueueOperatorNotification 0 반환·Notification 미적재(그룹 경로·폴백 경로 둘 다).
- [ ] 키 부재·빈 값·"0"·조회 throw → 기존 동작 그대로(기존 테스트 회귀 0).
- [ ] 단위 테스트(operator-notify.test.ts 패턴에 추가), `next build` 통과.
- [ ] NOTIFICATIONS.md 갱신.

## 운영 절차

병합·배포 후 라이브 AppSetting upsert로 즉시 정지. 재개 = 값 "0"으로 갱신(또는 행 삭제).
