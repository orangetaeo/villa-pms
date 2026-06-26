# 계약서 — 비밀번호 자가재설정 (Zalo 코드)

## 배경
phone+password 로그인. 자가재설정 엔드포인트/UI 부재. 전달 채널은 Zalo만 구축됨. ADR(신규)로 Zalo 6자리 코드 방식 채택.

## 범위
- 신규 모델 `PasswordResetToken`(additive, **raw SQL CREATE TABLE** — `prisma db push` 금지, 공유 Neon 드리프트 방지):
  - `id`, `userId`, `codeHash`(bcrypt, 평문 코드 미저장), `expiresAt`(now+10분), `usedAt?`, `attempts Int @default(0)`, `createdAt`.
  - 인덱스: `userId`, `expiresAt`.
- `POST /api/auth/forgot-password` { phone } → 사용자 조회. 항상 동일 응답(사용자 열거 방지). zaloUserId 있으면 6자리 코드 생성·해시 저장·Zalo 발송. rate-limit(phone/IP, 기존 헬퍼 재사용). 감사로그 `PASSWORD_RESET_REQUESTED`(평문 코드 미기록).
- `POST /api/auth/reset-password` { phone, code, newPassword } → 코드 검증(미만료·미사용·시도<5). 성공 시 bcrypt 10라운드 해시 저장, `mustChangePassword=false`, 토큰 usedAt 기록, 해당 user의 미사용 토큰 무효화. 감사로그 `PASSWORD_RESET_COMPLETED`.
- 페이지 `/forgot-password`(phone 입력), `/reset-password`(code+새 비번). 비로그인 허용 — `middleware.ts` public 경로에 추가.
- `/login`에 "비밀번호를 잊으셨나요?" 링크 추가.
- i18n: ko/vi/en 키 추가(LOC). Zalo 코드 문구 vi 기본.
- Zalo 미연결 사용자: forgot 응답 페이지에 "관리자에게 초기화 요청" 안내(기존 OWNER RESET_PASSWORD 플로우 유지).

## 보안 규칙
- 평문 비밀번호·평문 코드 **절대 감사로그/응답 미기록**(codeHash만 저장).
- 사용자 열거 방지: phone 존재 여부와 무관하게 동일 응답·동일 지연.
- 코드 5회 오입력 시 토큰 폐기.

## 완료 기준
1. zaloUserId 연결 사용자가 phone→코드 수신→재설정→새 비번 로그인 성공.
2. 만료/오입력/재사용 코드 거부.
3. 미존재 phone도 동일 응답(열거 불가).
4. 미연결 사용자에게 관리자 문의 안내.
5. typecheck/lint/build 통과. 권한 누수 스캔 0.

## 검증 방법
QA: 테스트 유저(zaloUserId 보유)로 전체 플로우. 열거 방지·만료·재사용 음성 케이스. 감사로그에 평문 부재 확인.
