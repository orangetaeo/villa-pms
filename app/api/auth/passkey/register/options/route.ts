// POST /api/auth/passkey/register/options — 로그인 사용자용 패스키 등록 옵션 발급 (ADR-0030).
//   본인 세션 필수. challenge를 httpOnly 쿠키에 담아 verify 단계와 연결한다.
//   /api/auth/* 는 미들웨어에서 제외되므로 여기서 auth()로 직접 게이트.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getRpConfig, REG_CHALLENGE_COOKIE, CHALLENGE_TTL_SEC } from "@/lib/webauthn";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { rpName, rpID } = getRpConfig();
  // 이미 등록된 자격증명은 중복 등록 방지(같은 기기 재등록 차단).
  const existing = await prisma.authenticator.findMany({
    where: { userId: session.user.id },
    select: { credentialId: true },
  });

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: session.user.id,
    userName: session.user.name || session.user.id,
    userDisplayName: session.user.name || undefined,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: isoBase64URL.toBuffer(c.credentialId),
      type: "public-key",
    })),
    // 플랫폼 인증기(지문·얼굴·Windows Hello) 우선, 사용자 검증 권장.
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const jar = await cookies();
  jar.set(REG_CHALLENGE_COOKIE, options.challenge, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CHALLENGE_TTL_SEC,
  });

  return NextResponse.json(options);
}
