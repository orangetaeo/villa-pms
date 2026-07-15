# T-login-ratelimit-message — 로그인 잠금(rate limit) 구분 안내 메시지

## 배경 (Triage)

2026-07-15 실사고: 신규 가입자(0702635421)가 가입 전 로그인 5회 시도로 전화번호 rate limit(10분 5회)에 걸림.
이후 가입·비밀번호 초기화까지 했지만 잠금 상태에서는 비밀번호 검사 없이 거부되는데, 화면에는 일반
"아이디/비밀번호 오류"와 동일하게 표시되어 "초기화해도 로그인 안 됨" 혼란 발생.

보안 트레이드오프 검토: 잠금 안내는 계정 존재 여부를 노출하지 않음(전화번호 존재와 무관하게 시도 횟수만 기준).
HTTP 429 관행과 동일하게 구분 표시해도 브루트포스 방어 약화 없음 — 오히려 공격자는 이미 응답 지연 없이도
차단을 인지 가능. 사용자 혼란 비용이 더 큼 → 구분 메시지 도입 결정 (운영자 승인 2026-07-15).

## 범위

1. **auth.ts** — credentials authorize의 rate limit 차단 시 `return null` 대신
   `CredentialsSignin` 서브클래스(`code = "rate_limited"`) throw. (next-auth 5 beta.28 지원 확인됨)
   - SecurityEvent RATE_LIMIT 기록은 기존 그대로 유지.
   - passkey provider는 rate limit 없음 — 변경 없음.
2. **app/(auth)/login/actions.ts** — catch에서 `error.code === "rate_limited"` 분기 →
   `{ error: "tooManyAttempts" }` 반환.
3. **app/(auth)/login/page.tsx** — errorMessages에 `tooManyAttempts` 추가.
4. **가입 자동 로그인 경로** — signIn을 자동 호출하는 가입 플로우(app/(auth)/signup/actions.ts 등,
   구현 시 전수 grep) 전부에서 rate_limited 분기: **계정은 이미 생성됐음**을 알리는 별도 키
   (예: "가입은 완료되었습니다. 10분 후 로그인해 주세요") — serverError로 뭉개지 않음 (이번 사고의 실제 경로).
5. **i18n** — messages/ko.json + vi.json 동시 추가 (전 페이지 vi 필수 규칙).
   문구: ko "시도가 너무 많습니다. 10분 후 다시 시도해 주세요." / vi 감수 수준 번역.

## 완료 기준 (테스트 가능)

- [ ] 같은 전화번호로 로그인 5회 실패 후 6회째: 로그인 화면에 잠금 안내 메시지(일반 오류와 다른 문구) 표시
- [ ] 잠금 안내 문구에 계정 존재 여부를 유추할 정보 없음 (존재하지 않는 번호로도 동일 메시지)
- [ ] 올바른 비번 + 잠금 해제 후 로그인 정상 (기존 동작 회귀 없음)
- [ ] 가입 자동 로그인이 rate limit에 걸려도 "가입 완료 + 잠시 후 로그인" 안내 (계정 생성됨)
- [ ] ko/vi 두 로케일 모두 번역 표시
- [ ] `next build` 통과 (배포 빌드 게이트)

## 수정 금지 구역

- lib/rate-limit.ts (한도 정책·스토어 변경 없음 — 표시만 변경)
- prisma 스키마 (변경 없음)

## 담당

BE(구현, Opus) → QA(검증) → PM(보고). worktree 격리 작업.
