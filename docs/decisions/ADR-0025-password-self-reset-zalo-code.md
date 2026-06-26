# ADR-0025 — 비밀번호 자가재설정(Zalo 6자리 코드)

- 상태: Accepted
- 날짜: 2026-06-26
- 관련: auth.ts(Credentials), `mustChangePassword` 게이트, 기존 OWNER `RESET_PASSWORD`

## 맥락
phone+password 로그인이나 자가재설정 경로가 없어 비번 분실 시 OWNER가 임시비번을 수동 발급해야 했다. 현재 구축된 사용자 메시지 채널은 **Zalo뿐**(이메일/SMS 미구현). 사용자 일부만 `zaloUserId` 연결.

## 결정
1. **전달 채널 = Zalo 6자리 코드**(10분 TTL). 이메일/SMS 인프라 신규 구축은 비용 대비 보류 → 이번 범위 제외(향후 별도 ADR).
2. **신규 모델 `PasswordResetToken`**(codeHash=bcrypt, expiresAt, usedAt, attempts). **평문 코드 미저장**. 공유 Neon 드리프트 방지 위해 **raw SQL CREATE TABLE**로 additive 적용(`prisma db push` 금지) + `prisma generate`로 클라이언트만 갱신.
3. **Zalo 미연결 사용자** → "관리자에게 초기화 요청" 안내(기존 OWNER `RESET_PASSWORD` 임시비번 플로우 유지).
4. **보안 게이트**: ① 사용자 열거 방지(존재/부재·연결/미연결 무관 동일 200 응답 **+ 상수 시간**(미적격도 더미 bcrypt 수행)) ② attempts≥5 토큰 폐기 ③ 만료·재사용 거부 ④ rate-limit(phone/IP) ⑤ 토큰-user 바인딩(phone+code로 임의 계정 변경 불가) ⑥ 평문 코드·비번 감사로그/응답/로그 미기록.

## 근거 / 트레이드오프
- Zalo 코드는 즉시 발송 필요(10분 만료)이라 Notification 큐+cron(지연) 대신 `sendBotMessage` 직접 호출(best-effort, 봇 미연결 시에도 응답 일관성 유지).
- Zalo 미연결자는 자가재설정 불가 → 관리자 경유. 전 사용자 zaloUserId 연결률이 오르면 커버리지 자연 증가.

## 영향
- 신규: `lib/password-reset.ts`, `app/api/auth/{forgot,reset}-password/route.ts`, `app/(auth)/{forgot,reset}-password/*`, `PasswordResetToken`.
- 수정: `middleware.ts`(public 경로), `/login`(찾기 링크), `messages/{ko,vi}.json`(auth.reset).
