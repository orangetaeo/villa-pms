// POST /api/auth/passkey/login/options — 비로그인 상태 패스키 인증 옵션 발급 (ADR-0030).
//   usernameless(discoverable) 방식: allowCredentials 미지정 → 기기가 등록된 패스키를 스스로 제시.
//   challenge를 httpOnly 쿠키에 담아, signIn("passkey") 시 provider가 대조한다.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getRpConfig, AUTH_CHALLENGE_COOKIE, CHALLENGE_TTL_SEC } from "@/lib/webauthn";

export async function POST() {
  const { rpID } = getRpConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });

  const jar = await cookies();
  jar.set(AUTH_CHALLENGE_COOKIE, options.challenge, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CHALLENGE_TTL_SEC,
  });

  return NextResponse.json(options);
}
