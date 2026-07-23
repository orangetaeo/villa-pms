# 계약: Zalo 리스너 자가 복구 (T-zalo-health-self-heal)

착수 2026-07-23 · 브랜치 `wt/zalo-selfheal` · 담당 BE(+QA)

## 배경 (실측)

2026-07-23 03:11 UTC(현지 10:11) 이도경(ADMIN_PERSONAL) 계정의 WebSocket이
`code 1006`(정상 종료 프레임 없는 절단)으로 끊겼다.

- 03:31 워치독이 경보 발송(인앱 4 + Zalo 2), 03:35 테오·이도경 Zalo 도착
- **03:11 ~ 07:07 (약 4시간) 그 계정 수신 0건** — DB `ZaloMessage` 확인
- 복구는 07:07 UTC의 **무관한 배포(PR #399 병합)로 워커가 재시작되면서 우연히** 일어났다
- 2026-07-22에도 같은 패턴(테오 계정, code 1006, 33분 뒤 배포로 복구)

즉 현재 워치독은 **감지·통보만 하고 복구는 사람(또는 우연한 배포)에 의존**한다.
credential은 DB에 있고 부팅 시 `connectAllActive()`가 그것으로 재로그인하므로,
**같은 재로그인을 워치독이 실행하면 무인 복구가 가능**하다.

## 범위 (이 계약에서 하는 것)

1. `lib/zalo-runtime.ts` — `reconnectAccountForHealth(adminUserId, kind)` 신규 export
   - 풀 비보유 프로세스(웹, `shouldDelegate()`)에서는 **시도하지 않음**(`SKIP_DELEGATED`)
   - `qr_pending` 인스턴스는 건드리지 않음(사람이 QR 스캔 중)
   - **code 3000(다른 곳에서 로그인됨)은 재시도 금지** — 이중 로그인은 밴 위험. 사람 개입 필요
   - 재로그인 전에 **구 리스너 stop + removeAllListeners** (retryOnClose 잔존 소켓과의 이중 접속 차단)
   - 내부적으로 기존 `ensureConnectionForAccount()` 재사용(신규 로그인 경로 추가 없음)
2. `lib/zalo-health.ts` — 점검 시 미연결이면 경보 **이전에** 자동 재접속 시도
   - 백오프: 시도 간 최소 간격 5m → 10m → 20m → 40m → 60m(상한). 계정별 독립
   - 재접속 성공 시 그 회차는 healthy로 간주 → **경보 없음**(스팸 감소)
   - 경보 본문에 `자동 재접속 N회 실패` 추가 → 사람이 QR을 언제 잡아야 하는지 판단 가능
   - 경보를 보냈던 계정이 복구되면 **인앱 복구 알림 1회**(Zalo 큐 미사용 — 소음 최소화)
3. 테스트 `tests/zalo-health.test.ts` 확장 + `docs/NOTIFICATIONS.md` 문구 동기화

## 하지 않는 것 (범위 밖)

- 스키마 변경 없음(백오프 상태는 인메모리, 경보 쿨다운은 기존 AppSetting 그대로)
- QR 자동화·credential 자동 갱신 없음
- 워커 프로세스 자동 재시작(Railway 재배포) 없음

## 완료 기준 (테스트 가능)

- [ ] 미연결 1회차에 재접속 시도 → 성공하면 경보 0건 (단위 테스트)
- [ ] 재접속 실패가 이어지면 기존과 동일하게 2회 연속(≈10분)에서 경보 1회, 쿨다운 6h 유지
- [ ] 백오프 미도래 시 재접속 호출 0회 (로그인 폭주·밴 위험 차단)
- [ ] `code 3000` 상태에서는 재접속 호출 0회
- [ ] 웹 프로세스(delegate)에서는 재접속 호출 0회
- [ ] 경보 후 복구되면 인앱 복구 알림 1회, 그 뒤 반복 점검에도 추가 알림 0건
- [ ] `npm run typecheck && npm run lint && npx vitest run tests/zalo-health.test.ts && npm run build` 전부 통과

## 수정 금지 구역 (다른 세션 보호)

`app/**`, `components/**`, `prisma/schema.prisma`, `worker/index.ts`(배선 불필요),
마케팅·영상 파이프라인(`lib/reel*`, `lib/shorts*`, `lib/narration*`) 일체.
이 계약이 만지는 파일: `lib/zalo-runtime.ts`, `lib/zalo-health.ts`,
`tests/zalo-health.test.ts`, `docs/NOTIFICATIONS.md`, 본 계약서.
