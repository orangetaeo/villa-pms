# 보안 에픽 잔여 — 마스터 핸드오프

> 작성 2026-06-28. 보안 강화 에픽은 **코드/문서 측면 종료**(CRITICAL 0·HIGH 8 전부 처리). 이 문서는 그 후 남은 항목을 **별도 트랙**으로 넘기는 단일 진입점이다. 각 항목의 소유자·상태·다음 액션·상세문서를 정리하고, 아직 스펙이 없던 설계필요 항목은 **구현/결정 즉시 가능한 구체안**을 첨부한다.
> 정본: docs/SECURITY-HARDENING-PLAN-2026-06-27.md / 종료 기록: memory `security-hardening-epic-plan.md`.

## 상태 한눈에

| 항목 | 소유자 | 상태 | 다음 액션 | 상세 |
|---|---|---|---|---|
| Railway cron 등록 | OPS | ✅ **DONE** | 없음(8개 등록·검증 완료) | [cron-registration.md](cron-registration.md) |
| 실 시크릿 키 교체(런칭 시) | OPS | 🟢 READY | 런칭 직전 런북대로 실행 | [secret-rotation-runbook.md](secret-rotation-runbook.md) |
| Cloudflare proxied(볼류메트릭 DDoS) | OPS | 🟢 READY | 런북 체크리스트 실행 | [ddos-protection.md](ddos-protection.md) |
| CSP enforce 플립 | OPS | 🟢 READY(관찰 후) | CSP_REPORT 수렴 확인 후 헤더 전환 | [csp-enforce-transition.md](csp-enforce-transition.md) |
| 인시던트 대응 | OPS/테오 | 🟢 READY | 사고 시 절차서 사용 | [incident-response.md](incident-response.md) |
| Redis rate-limit | OPS+BE | 🟡 SPEC READY | Redis 인스턴스 결정 시 §1 구현 | 아래 §1 |
| webhook replay 방어(P2-S3) | BE+Nike | 🟡 SPEC READY | 양 레포 동기 구현 | 아래 §2 |
| 이상탐지 Zalo 경보(P3-S3) | BE+OPS | 🟡 SPEC READY | 임계치 승인 후 구현+cron | 아래 §3 |
| 고액 거래 2차 승인(P3-S2) | 테오(제품) | 🔵 DECISION | §4 질문 답 → 구현 | 아래 §4 |
| form zod 확대(P2-S2)·의존성 CI스캔(P2-S6) | BE | ⚪ 저우선 | 백로그 | 플랜 §5 |

범례: ✅완료 · 🟢즉시실행(런북) · 🟡스펙있음(인스턴스/결정 대기) · 🔵제품결정필요 · ⚪저우선.

---

## §1. Redis rate-limit 구현 스펙 (스케일아웃 결정 시)

**현황**: `lib/rate-limit.ts`에 `RateLimitStore` 인터페이스 + `MemoryRateLimitStore` + 주입점 `setRateLimitStore()`가 이미 있음(PR #107). 단일 컨테이너라 메모리로 충분하나, 스케일아웃(2+ 인스턴스) 시 카운터가 인스턴스별로 갈려 무력화 → Redis 분산 스토어 필요.

**구현(인스턴스 확보 후)**:
1. `REDIS_URL` env 추가. 패키지 `ioredis`.
2. `lib/rate-limit-redis.ts`: `RedisRateLimitStore implements RateLimitStore`. `hit(key, windowMs, max)`는 원자적 `INCR` + 최초 `PEXPIRE windowMs` (또는 Lua로 INCR+PEXPIRE 원자화), 반환은 메모리 구현과 동일 형태.
3. 부팅 시 `if (process.env.REDIS_URL) setRateLimitStore(new RedisRateLimitStore(...))` (앱 진입/계측 모듈). env 없으면 메모리 유지(무영향).
4. 검증: 기존 rate-limit 테스트 전부 통과(동작 보존) + Redis 모킹 단위테스트(INCR/만료) + 2인스턴스 스모크.

**주의**: 키 네임스페이스(`login:phone:` 등) 그대로. TTL은 windowMs와 일치. Redis 장애 시 fail-open vs fail-closed 정책 결정(권장: 로그인은 fail-closed로 보수적, 일반은 fail-open로 가용성). 런북 [rate-limit-lockout.md](rate-limit-lockout.md) 연계.

---

## §2. webhook replay 방어 스펙 (P2-S3, ★ Nike 양 레포 동기 필수)

**현황**: Zalo 연동 webhook은 `ZALO_WEBHOOK_HMAC_SECRET`으로 본문 HMAC 서명 검증(villa 서명·Nike 검증, 양 레포 동일 값). **timestamp/nonce가 없어 재전송(replay) 공격에 노출** — 탈취된 유효 서명 요청을 재전송하면 통과.

**제안 프로토콜(양 레포 동시 적용)**:
1. 송신측이 헤더 `x-zalo-ts`(epoch ms) + `x-zalo-nonce`(랜덤 16B) 추가, **서명 대상 = `ts.nonce.body`**(현재 body만 → ts+nonce 포함으로 변경).
2. 수신측 검증: ① HMAC 일치 ② `|now - ts| ≤ 5분`(시계 오차 윈도우) ③ nonce 미사용(최근 본 nonce 저장소에 없음) → 통과 시 nonce 기록(TTL=윈도우).
3. nonce 저장소: 단일 컨테이너면 메모리 Map(TTL), 스케일아웃이면 Redis(§1과 공유). 윈도우 밖 ts·중복 nonce → 거부 + SecurityEvent.

**전개 순서(통합 단절 방지)**: 수신측을 **하위호환**으로 먼저 배포(ts/nonce 있으면 검증, 없으면 기존 통과 + 경고 로그) → 양 레포 송신 적용 확인 후 → 수신측 **강제**(없으면 거부)로 전환. 한쪽만 강제하면 단절([[nike-villa-zalo-integration]]).

---

## §3. 이상탐지 Zalo 경보 스펙 (P3-S3)

**현황**: SecurityEvent가 LOGIN_FAIL·RATE_LIMIT·AUTHZ_DENY·TOKEN_INVALID·CRED_DECRYPT_FAIL·SSRF_BLOCK·CSRF_BLOCK를 라이브 기록(P0-1). 관측은 되나 **자동 경보가 없어 수동 조회에 의존**(IR 절차서 §1).

**제안 설계(임계치는 테오 승인 후 조정)**:
- **트리거(기본값 제안)**: 최근 10분 윈도우에서 ① 한 `actorPhone`/`ip`의 `LOGIN_FAIL` ≥ 20 ② 한 `actorUserId`의 `AUTHZ_DENY` ≥ 15 ③ `CRED_DECRYPT_FAIL`·`SSRF_BLOCK` ≥ 1(희귀 = 즉시) ④ 전체 `RATE_LIMIT` ≥ 100.
- **알림**: 테오(SYSTEM_BOT 소유자)에게 Zalo 1건. 내용 = 유형·카운트·윈도우·상위 actor/ip(평문 비번·PII 미포함).
- **쿨다운**: 같은 (트리거유형) 1시간 1회(알림 폭주 방지) — 마지막 발송시각을 SecurityEvent(type=`ALERT_SENT`) 또는 별도 키로 기록.
- **실행**: `/api/cron/security-alerts`(CRON_SECRET 게이트, 멱등) + Railway cron `*/10 * * * *` 등록([cron-registration.md](cron-registration.md) 절차 그대로 1개 추가).

**구현 주의**:
- 알림을 NotificationType로 보낼 경우 `lib/zalo.ts`의 `buildNotificationText`가 **default 없는 exhaustive switch**라 enum 추가 시 TS2366 — case 추가 필수([[notificationtype-enum-exhaustive-switch]]). 또는 관리자 직접 발송 경로 재사용.
- SecurityEvent 집계는 인덱스(type·createdAt·ip/actor) 활용. 경보 자체도 fire-and-forget(실패가 cron 본 흐름 차단 금지).

---

## §4. 고액 거래 2차 승인 — 제품 결정 필요 (P3-S2)

테오 결정이 필요한 질문(답하면 BE가 바로 구현):
1. **대상 거래**: 정산 확정? 환불? 둘 다? (입금/수납도?)
2. **임계 금액**: KRW/USD/VND 각 얼마 이상? (예: 정산 ≥ 5,000,000 KRW)
3. **2차 승인자**: OWNER만? OWNER+MANAGER 중 1차와 다른 사람? (현 RBAC: OWNER/MANAGER/STAFF)
4. **흐름**: 1차가 "승인 요청" 생성 → 2차가 별도 화면에서 승인 → 그때 실행? (더블사인)

**제안 기본(MVP)**: 정산 확정·환불에 한해, 임계 이상이면 `PENDING_SECOND_APPROVAL` 상태 추가 → OWNER가 승인해야 실행. AuditLog에 1·2차 actor 기록. (스키마 additive: 상태/필드 1개.)

---

## 참고
- 이 문서의 🟡/🔵 항목은 **에픽 재개가 아니라** 결정/인스턴스가 생길 때 개별 처리한다.
- ⚪ 저우선(P2-S2 form zod 확대·P2-S6 의존성 CI스캔): CI(`.github/workflows`)가 아직 없어 P2-S6는 CI 도입과 함께. 플랜 §5 참조.
