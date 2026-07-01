# 계약서 — 패스키(지문·얼굴) 로그인 (ADR-0030)

## 배경
비밀번호 저장(localStorage)의 보안 한계를 대체할 WebAuthn/패스키 로그인. 지문·얼굴·Windows Hello를
브라우저 표준(WebAuthn)으로 사용. 개인키·생체정보는 사용자 기기에만 존재, 서버는 공개키만 검증.

## 범위 (Phase A — 이 worktree, 다른 세션 로그인 작업과 독립)
- [x] `Authenticator` 모델(additive) + User 관계
- [x] `lib/webauthn.ts` — RP 설정(env), challenge 쿠키·헬퍼
- [x] `lib/passkey-verify.ts` — 로그인 어설션 검증(동형 @simplewebauthn/server)
- [x] API `POST /api/auth/passkey/register/options|verify` (본인 세션 필수)
- [x] API `POST /api/auth/passkey/login/options` (비로그인, usernameless)
- [x] API `GET /api/auth/passkey/list`, `DELETE /api/auth/passkey/[id]` (본인 스코프)
- [x] `auth.ts` — `passkey` Credentials provider(challenge 쿠키 대조 → 세션 발급)
- [x] 계정설정 `PasskeySection` — 등록·목록·삭제(미지원 브라우저 자동 숨김), 4개 포털 공통
- [x] i18n `account.passkey.*` (ko/vi)

## 범위 (Phase B — 다른 세션 로그인 병합 후)
- [ ] 로그인 화면에 "지문·얼굴로 로그인" 버튼: `login/options` → `startAuthentication` → `signIn("passkey")`
- [ ] `auth.login.passkeyButton` 라벨(ko/vi/게스트 언어)
- [ ] 라이브 Neon에 `Authenticator` 테이블 raw SQL CREATE(prisma db push 금지)
- [ ] env: `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` (Railway 도메인)

## 완료 기준 (테스트 가능)
1. 로그인 후 계정화면 → "패스키 등록" → 기기 생체인증 → 목록에 표시 (register options/verify 200)
2. 로그아웃 → 로그인 화면 "지문·얼굴로 로그인" → 생체인증 → 홈 진입 (Phase B)
3. 다른 사용자의 authenticator id로 DELETE 시 404 (IDOR 차단)
4. counter 재사용/위조 어설션은 로그인 거부(null), SecurityEvent LOGIN_FAIL 기록
5. 미지원 브라우저에서 계정화면 패스키 카드 미표시(오류 없음)

## 보안·누수
- 서버 저장은 공개키·counter만(개인키·생체정보 없음). credentialId/publicKey는 목록 API 미노출.
- 로그인 실패는 이유 무구분 null(기존 credentials 정책 동일) + LOGIN_FAIL 이벤트.
- 등록·삭제는 AuditLog(entity=Authenticator, CREATE/DELETE).
- 마진·판매가 등 운영 데이터와 무관(계정 범위).

## 수정 금지 구역 (다른 세션)
- `app/(auth)/login/*`, `app/(auth)/signup/*`, `messages/*.json`의 login/signup 훅 — Phase B에서만, 병합 후 접촉.
