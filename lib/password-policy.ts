// 비밀번호 정책 — 복잡도 검증 + bcrypt 비용계수 일원화 (보안 P1-S2)
//
// 기존: 길이 8자만 강제(aaaaaaaa 같은 약한 비번 허용), bcrypt 라운드가 signup=12·나머지=10으로 불일치.
// 변경: 8자 이상 + (숫자 1 또는 특수문자 1) 강제, 신규 해시는 BCRYPT_ROUNDS로 통일.
//   (기존 10라운드 해시는 bcrypt.compare가 해시에 박힌 라운드로 검증하므로 그대로 유효 — 마이그레이션 불요.)

export const BCRYPT_ROUNDS = 12;
export const PASSWORD_MIN = 8;

/** 정책 충족 여부: 최소 길이 + (숫자 또는 특수문자) 1개 이상. */
export function isStrongPassword(pw: unknown): boolean {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return false;
  return /[0-9]/.test(pw) || /[^A-Za-z0-9]/.test(pw);
}

/** zod refine 등에서 쓰는 사용자 메시지(서버 검증 — 클라 i18n은 별도). */
export const PASSWORD_POLICY_MESSAGE = "비밀번호는 8자 이상이며 숫자 또는 특수문자를 1개 이상 포함해야 합니다";
