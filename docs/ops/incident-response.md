# 인시던트 대응 절차서 (보안 P3-S4)

> 정본 계획: docs/SECURITY-HARDENING-PLAN-2026-06-27.md §6 P3-S4
> 목적: 유출·침해·공격 의심 시 **무엇을 보고, 어떻게 막고, 누구에게 알릴지** 사전 정의. PII(여권·서명·전화)를 다루는 서비스라 즉응 절차가 필수.
> 관련: [secret-rotation-runbook.md](secret-rotation-runbook.md) · [secret-scan-2026-06-28.md](secret-scan-2026-06-28.md) · [ddos-protection.md](ddos-protection.md) · [rate-limit-lockout.md](rate-limit-lockout.md)

## 0. 원칙·역할

- **결정권자**: 테오(OWNER). 모든 격리·키교체·통지 결정 승인.
- **침착 우선순위**: ① 추가 피해 차단(격리) → ② 증거 보존 → ③ 복구 → ④ 통지 → ⑤ 재발방지. **증거 삭제 금지**(SecurityEvent·AuditLog·로그는 분석 전 보존).
- **과잉대응 허용**: 의심만으로도 키 교체·세션 만료는 비용이 낮다. 확신을 기다리지 말 것.

## 1. 탐지 — 무엇을 보나

| 신호 | 위치 | 의심 |
|---|---|---|
| `LOGIN_FAIL` 급증(한 phone/IP) | SecurityEvent | 무차별 대입·크리덴셜 스터핑 |
| `RATE_LIMIT` 급증 | SecurityEvent | 공격 진행 중(이미 차단되곤 있음) |
| `AUTHZ_DENY` 급증(한 userId) | SecurityEvent | 권한 상승 탐색·세션 탈취 후 횡적 이동 |
| `TOKEN_INVALID` 급증 | SecurityEvent | 제안/게스트 토큰 열거 |
| `CRED_DECRYPT_FAIL` | SecurityEvent | Zalo credential 손상·키 불일치 |
| `SSRF_BLOCK`·`CSRF_BLOCK` | SecurityEvent | 서버 SSRF·교차출처 위조 시도 |
| 5xx·비용 엔드포인트 폭주 | 앱 로그·Railway | L7 DoS·비용공격([[ddos-protection]]) |
| Zalo 봇 송수신 두절 | 운영 체감 | 리스너 블랙아웃 또는 credential 탈취([[deploy-restart-zalo-listener-blackout]]) |

**조회 예**: `prisma.securityEvent.findMany({ where: { type: "LOGIN_FAIL", createdAt: { gte: <최근> } }, orderBy: { createdAt: "desc" } })` 또는 Prisma Studio. (이상탐지 자동 경보 P3-S3는 백로그 — 현재는 수동 조회.)

## 2. 심각도 분류

| 등급 | 정의 | 예 | 대응 시계 |
|---|---|---|---|
| **SEV1 (치명)** | PII 유출 확인·운영 자격증명 유출·전 사용자 영향 | 여권 파일 외부 유출, DATABASE_URL 유출, ADMIN 계정 탈취 | 즉시(분 단위) |
| **SEV2 (높음)** | 특정 계정 탈취·부분 권한 상승·봇 침해 | 한 공급자 계정 탈취, Zalo 봇 무단 발송 | 시간 단위 |
| **SEV3 (중간)** | 차단된 공격 시도·가용성 저하 | rate-limit에 막힌 brute-force, 일시적 L7 부하 | 당일 |

## 3. 공통 대응 6단계

1. **준비(상시)**: 이 문서·런북 최신 유지, Railway/Neon/Cloudflare 접근권 확인.
2. **탐지·기록**: 인시던트 발생시각·발견경로·영향범위 메모 시작(타임라인). SecurityEvent/AuditLog 스냅샷 보존.
3. **격리(Containment)** — §4 시나리오별. 공통 레버:
   - **전 세션 강제 만료**: `NEXTAUTH_SECRET` 교체([secret-rotation-runbook.md](secret-rotation-runbook.md) 3단계) → 전원 재로그인.
   - **특정 사용자 차단**: `User.isActive=false`(로그인 즉시 차단) 또는 비밀번호 강제 초기화(RESET_PASSWORD → P0-5② `passwordChangedAt` 갱신으로 그 사용자 **타 디바이스 세션까지** 무효).
   - **공격 트래픽 차단**: env 킬스위치·Cloudflare([[ddos-protection]]).
   - **봇 격리**: Zalo credential 무효화·재QR.
4. **근절(Eradication)**: 침투 경로 패치(취약점 수정·키 교체), 잔존 악성 데이터 제거(주의: 증거 보존 후).
5. **복구(Recovery)**: 서비스 정상 확인(스모크), 모니터링 강화 기간 운영.
6. **사후(Post-mortem)**: 타임라인·원인·재발방지 항목 정리 → 해당 .claude/skills 또는 ADR/IDEAS에 교훈 반영.

## 4. 시나리오별 플레이북

### A. 자격증명(시크릿) 유출 — SEV1
1. 유출 키 범위 산정(어느 키? 어디로?).
2. [secret-rotation-runbook.md](secret-rotation-runbook.md) 순서대로 해당 키 즉시 교체. DB creds면 Neon role 재발급 + `DATABASE_URL` 교체.
3. `NEXTAUTH_SECRET`도 교체해 혹시 모를 세션 무력화.
4. SecurityEvent/AuditLog에서 그 키로 가능한 오용 흔적(비정상 접근·변경) 점검.
5. ZALO_CREDS_KEY 포함 시 §D 병행(P0-2 salt 마이그레이션 상태 확인 필수).

### B. 계정 탈취·세션 침해 — SEV1(ADMIN)/SEV2(기타)
1. 해당 계정 `isActive=false` 또는 비밀번호 강제 초기화(RESET_PASSWORD).
   → **P0-5② 서버측 무효화**로 그 사용자의 *모든 디바이스* 세션이 throttle(≤60초) 내 만료([[security-hardening-epic-plan]]). 클라 signOut에 의존하지 않음.
2. ADMIN/OWNER 탈취 의심 시 `NEXTAUTH_SECRET` 교체로 전원 세션 만료(보수적).
3. AuditLog에서 탈취 기간 변경 이력(요율·계정·정산·예약) 점검 → 부정 변경 롤백.
4. 마진·판매가·재고 비공개 원칙 침해 여부 확인(공급자 화면 누수 점검).

### C. PII(여권·서명·전화) 유출 — SEV1
1. 유출 경로·대상자 범위 산정. 여권/서명은 `private/` 볼륨(공개 버킷 아님)·ADMIN 가드 라우트 전용임을 재확인 — 가드 우회 여부 점검.
2. 노출 파일 접근 차단(필요 시 해당 파일 격리), 접근 로그 보존.
3. **통지(§5)**: PII 침해는 규제 통지 대상일 수 있음(베트남 PDPD·한국 PIPA). 테오 판단으로 영향받은 게스트/공급자·당국 통지 검토.
4. 여권 90일 보존 cron([cron-registration.md](cron-registration.md)) 정상 동작 재확인(불필요 PII 잔존 최소화).

### D. Zalo 봇 침해·무단 발송 — SEV2
1. 의심 봇 계정 즉시 연결 해제(disconnect) → 재발송 차단.
2. `ZALO_CREDS_KEY` 교체는 **P0-2 salt 마이그레이션 완료 후에만**([secret-rotation-runbook.md](secret-rotation-runbook.md) 4단계) — 전 봇 재QR 전제.
3. `ZALO_EXT_SHARED_SECRET`·`ZALO_WEBHOOK_HMAC_SECRET` 유출 의심 시 **Nike 양 레포 동시 교체**([[nike-villa-zalo-integration]]).
4. 무단 발송 내역·AuditLog 점검, 영향 수신자 파악.

### E. L7 DoS·비용공격 — SEV2/3
1. [ddos-protection.md](ddos-protection.md)의 env 킬스위치·임계 조정으로 즉시 완화.
2. **Cloudflare proxied 적용**(볼류메트릭은 앱 미들웨어로 못 막음 — 인프라 레이어 필수).
3. 비용 엔드포인트(OCR·번역) 한도·SecurityEvent 점검.

### F. 인젝션·SSRF·CSRF 차단 급증 — SEV3(차단됨)
- 이미 가드(P0-7 CSV·P0-8 SSRF·P1-S9 CSRF·프롬프트인젝션)에 막힌 시도. SecurityEvent로 공격자 IP·패턴 식별, 지속 시 Cloudflare에서 IP/패턴 차단. 코드 회귀 없는지 회귀스위트 확인.

## 5. 통지(Notification)

- **내부**: 테오(OWNER) 즉시. SEV1은 발견 즉시.
- **외부(규제·당사자)** — SEV1 PII 유출 시 테오 판단:
  - 한국 **PIPA**(개인정보보호법): 유출 인지 시 정보주체 통지 + 일정 규모 이상 전문기관 신고 의무 가능.
  - 베트남 **PDPD**(개인정보보호령): 공급자·게스트 PII 처리 관련 통지·신고 검토.
  - (정확한 임계·기한은 법률 자문 — 이 문서는 "통지를 검토하라"는 트리거. 실제 의무 판단은 전문가.)

## 6. 사후(Post-mortem) 체크리스트
- [ ] 타임라인(탐지→격리→복구) 기록.
- [ ] 근본 원인 + 침투 경로.
- [ ] 재발방지 항목(코드 수정·가드 추가·모니터링) → 백로그/ADR/skills 반영.
- [ ] 교체한 키·무효화한 세션·통지 대상 정리.
- [ ] 관련 회귀 테스트 추가(같은 클래스 재발 차단 — leak-checklist·security-invariants 패턴).
