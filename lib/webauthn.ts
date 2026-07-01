// WebAuthn/패스키(지문·얼굴·Windows Hello) 설정 헬퍼 (ADR-0030).
//   지문·얼굴은 사용자 기기의 플랫폼 인증기가 처리하고, 서버는 공개키만 검증한다.
//   개인키·생체정보는 기기 밖으로 나가지 않는다(피싱·유출 내성).
//
// 환경변수(프로덕션 필수):
//   WEBAUTHN_RP_ID   = 등록 도메인(스킴·포트 없음). 예) villa-go.up.railway.app
//   WEBAUTHN_ORIGIN  = 전체 오리진(스킴 포함). 예) https://villa-go.up.railway.app
//   미설정 시 AUTH_URL / NEXTAUTH_URL → 없으면 http://localhost:3000 (로컬 개발).

export const RP_NAME = "Villa Go";

// 옵션 발급~검증 사이 challenge를 담는 httpOnly 쿠키(단명). 등록/로그인 공용 접두 + 용도 구분.
export const REG_CHALLENGE_COOKIE = "wa-reg-challenge";
export const AUTH_CHALLENGE_COOKIE = "wa-auth-challenge";
export const CHALLENGE_TTL_SEC = 300; // 5분

export function getRpConfig(): { rpName: string; rpID: string; origin: string } {
  const originEnv =
    process.env.WEBAUTHN_ORIGIN ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  let origin = originEnv;
  let hostname = "localhost";
  try {
    const u = new URL(originEnv);
    origin = u.origin;
    hostname = u.hostname;
  } catch {
    // 잘못된 URL이면 로컬 폴백
    origin = "http://localhost:3000";
    hostname = "localhost";
  }
  const rpID = process.env.WEBAUTHN_RP_ID || hostname;
  return { rpName: RP_NAME, rpID, origin };
}

// 원시 Cookie 헤더에서 특정 쿠키 값을 읽는다(패스키 로그인 provider는 응답 객체가 없어 next/headers 대신 사용).
export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}
