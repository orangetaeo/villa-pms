# 시크릿 교체 런북 (보안 P0-4) — 런칭 직전 1회 + 유출 의심 시

> 정본 계획: docs/SECURITY-HARDENING-PLAN-2026-06-27.md §3 P0-4 / 스캔 결과: [secret-scan-2026-06-28.md](secret-scan-2026-06-28.md)
> 담당: **OPS**(Railway 환경변수 콘솔). git 스캔은 클린이나, 레포 밖(백업·로그·공유) 유출 가능성에 대비한 보수적 1회 교체.

## ⚠ 교체 전 필독 — 부수효과·순서 제약

키마다 교체 시 부수효과가 다르다. **무작정 전부 동시에 바꾸면 봇 블랙아웃·통합 단절·전원 로그아웃이 겹친다.** 아래 순서를 지킬 것.

| 키 | 부수효과 | 제약 |
|---|---|---|
| `DATABASE_URL` | 무중단(Neon에서 새 role 발급 후 교체) | DB role 재발급 필요 |
| `NEXTAUTH_SECRET` | **전 사용자 즉시 로그아웃**(기존 JWT 전부 무효) | 저트래픽 시간대 권장 |
| `CRON_SECRET` | cron 호출자(Railway cron/외부 스케줄러) 헤더도 동시 갱신 필요 | cron 등록값과 동기 |
| `GEMINI_API_KEY` | 무중단(Google AI Studio에서 새 키 발급→교체→구키 폐기) | — |
| `STORAGE_ACCESS_KEY_ID` + `STORAGE_SECRET_ACCESS_KEY` | 무중단(R2 토큰 재발급, 쌍으로 교체) | 쌍 동시 |
| `NIKE_DATABASE_URL` | ETL 전용(일회성). 평시 미사용 | read-only role |
| **`ZALO_EXT_SHARED_SECRET`** | **Nike 통합 단절**(S1 발송·S2 읽기) — villa·Nike 양 레포 **동일 값** | ★ 양 레포 동시 교체 |
| **`ZALO_WEBHOOK_HMAC_SECRET`** | **Nike webhook 서명검증 실패** — villa·Nike 양 레포 **동일 값** | ★ 양 레포 동시 교체 |
| **`ZALO_CREDS_KEY`** | **봇 전체 블랙아웃** — 저장된 Zalo credential 복호화 불가 → 전 봇 재QR 로그인 | ★★ 아래 별도 절차, **P0-2 salt 마이그레이션 완료 후에만** |

## 권장 교체 순서

### 1단계 — 무중단 키 (영향 없음, 먼저)
`GEMINI_API_KEY`, `STORAGE_ACCESS_KEY_ID`+`STORAGE_SECRET_ACCESS_KEY`, `DATABASE_URL`(Neon 새 role), `NIKE_DATABASE_URL`.
→ 발급처에서 새 값 생성 → Railway 변수 교체 → 재배포 → 스모크(번역/이미지/DB/ETL) → 구 키 폐기.

### 2단계 — Nike 양 레포 동기 키 (조율 필요)
`ZALO_EXT_SHARED_SECRET`, `ZALO_WEBHOOK_HMAC_SECRET`.
→ 새 값 생성 → **villa-pms와 Nike(ingenious-elegance-production) 양쪽에 같은 값**으로 동시 교체 → 양쪽 재배포 → S1 발송·S2 수신 스모크. (한쪽만 바꾸면 통합 단절 — [[nike-villa-zalo-integration]])

### 3단계 — 세션·cron (사용자 영향)
- `CRON_SECRET`: 새 값 → Railway 변수 + cron 스케줄러 헤더(`Authorization: Bearer …`) 동시 갱신 → cron 1건 수동 트리거로 200 확인. ([cron-registration.md](cron-registration.md))
- `NEXTAUTH_SECRET`: 저트래픽 시간대에 교체(전원 재로그인). 교체 후 로그인 1회 확인.

### 4단계 — `ZALO_CREDS_KEY` (★★ 가장 위험, 마지막·조건부)
- **선행 조건**: P0-2 무작위 salt 마이그레이션이 끝나고 **전 저장 credential이 신형 포맷으로 승급**됐는지 먼저 확인. (salt 마이그레이션 미완 상태에서 KEY까지 바꾸면 레거시 폴백 경로마저 깨져 복구 불가 — [[deploy-restart-zalo-listener-blackout]])
- **부수효과 불가피**: KEY를 바꾸면 기존 암호화 credential은 어차피 복호화 불가 → **봇 재QR 로그인이 전제**다. 즉 이 키 교체 = 계획된 봇 재로그인 작업.
- 절차: 저트래픽 시간 공지 → 새 `ZALO_CREDS_KEY` 설정·재배포 → 각 봇 계정 QR 재로그인([[deploy-restart-zalo-listener-blackout]]·김태진 "Jini"·테오 SYSTEM_BOT) → 송수신 스모크.
- **유출 의심이 아니면 런칭 시 생략 가능**(그대로 두는 게 안전). 실제 유출 정황이 있을 때만 4단계 수행.

## 교체 후 검증 (공통)
1. Railway 재배포가 SUCCESS까지 도달(경로 경유 200, [[deployment-railway-verify]]).
2. 로그인 1회 · cron 1건 트리거 · 번역 1회 · 이미지 업로드 1회 · Zalo 송수신 1회 스모크.
3. [secret-scan-2026-06-28.md](secret-scan-2026-06-28.md)의 스캔 명령 재실행 → 0건 재확인.

## 유출 의심 시 (인시던트)
범위 산정 → 해당 키만 위 절차로 즉시 교체 → SecurityEvent/로그에서 오용 흔적 점검 → 필요 시 `NEXTAUTH_SECRET` 교체로 전 세션 강제 만료(서버측 무효화는 비번 변경 경로만 — P0-5②). (심화 IR 절차서는 P3-S4 백로그.)
