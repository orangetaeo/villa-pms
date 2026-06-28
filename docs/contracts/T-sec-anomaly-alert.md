# 계약: P3-S3 이상탐지 Zalo 경보

> 보안 강화 에픽 P3-S3. 스펙: docs/ops/security-handoff.md §3. worktree: `wt/sec-anomaly-alert`. 작성자=BE, 평가자=QA.

## 배경

SecurityEvent가 LOGIN_FAIL·RATE_LIMIT·AUTHZ_DENY·CRED_DECRYPT_FAIL·SSRF_BLOCK·CSRF_BLOCK를 라이브 기록(P0-1)하나, **자동 경보가 없어 수동 조회 의존**. 임계치 초과 시 운영자(테오)에게 Zalo 알림.

## 범위 (in scope)

1. **순수 함수 `evaluateSecurityTriggers(events, thresholds)`** (lib/security-alerts.ts) — 최근 윈도우 SecurityEvent 배열 → 발화한 트리거 목록(category·count·top actor/ip). 단위 테스트 가능.
2. **`runSecurityAlerts(db, now)`** — ① 최근 10분 SecurityEvent 조회 ② evaluate ③ **쿨다운**(같은 category가 최근 60분 ALERT_SENT면 skip) ④ OWNER/ADMIN(zaloUserId 연결)에게 `enqueueNotification(SECURITY_ALERT)` ⑤ ALERT_SENT 기록. 멱등·fire-and-forget(실패가 cron 차단 안 함).
3. **트리거 기본 임계치(상수, 10분 윈도우)**: LOGIN_FAIL per phone/ip ≥20 · AUTHZ_DENY per userId ≥15 · CRED_DECRYPT_FAIL ≥1 · SSRF_BLOCK ≥1 · RATE_LIMIT total ≥100.
4. **NotificationType.SECURITY_ALERT 추가** + buildNotificationText case(한국어, 운영자 대상, 비번·PII 평문 미포함). additive enum → 라이브 raw SQL `ALTER TYPE ADD VALUE`.
5. **SecurityEventType union에 "ALERT_SENT" 추가**(쿨다운 마커, String 컬럼이라 무마이그레이션).
6. **`/api/cron/security-alerts`** — CRON_SECRET 게이트(기존 cron 패턴).
7. **cron-registration.md에 등록 항목 추가**(`*/10 * * * *`).

## 완료 기준

- [ ] evaluateSecurityTriggers: 각 임계치 경계(초과 발화·미만 무발화·top 식별) 단위 테스트.
- [ ] 쿨다운: 60분 내 ALERT_SENT 있으면 같은 category 재발화 skip.
- [ ] 누수: 알림 payload·텍스트에 비번/해시/마진/판매가 미포함(actor 식별자만).
- [ ] typecheck 0, 전체 vitest 통과, build 통과. 멱등(빈 윈도우=0건 정상).

## 검증

- 단위 테스트 + typecheck + build. QA 독립 평가(임계치 정확성·쿨다운·누수·exhaustive switch).

## 마이그레이션

- NotificationType enum에 SECURITY_ALERT 1개 추가(additive, 라이브 ALTER TYPE ADD VALUE 멱등). ⚠ 라이브 cron 등록은 OPS.
