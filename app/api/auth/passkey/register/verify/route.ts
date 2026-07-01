// POST /api/auth/passkey/register/verify — 등록 응답 검증 후 Authenticator 저장 (ADR-0030).
//   body: { response: RegistrationResponseJSON, deviceName?: string }
//   본인 세션 필수. challenge 쿠키와 대조. 성공 시 공개키만 저장(개인키는 기기에만 존재).
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/types";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { getRpConfig, REG_CHALLENGE_COOKIE } from "@/lib/webauthn";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { response?: RegistrationResponseJSON; deviceName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.response) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const jar = await cookies();
  const expectedChallenge = jar.get(REG_CHALLENGE_COOKIE)?.value;
  if (!expectedChallenge) {
    return NextResponse.json({ error: "challenge_expired" }, { status: 400 });
  }

  const { rpID, origin } = getRpConfig();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch {
    return NextResponse.json({ error: "verification_failed" }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "verification_failed" }, { status: 400 });
  }

  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
  const credentialId = isoBase64URL.fromBuffer(credentialID);

  // 이미 있으면(동일 자격증명) 멱등 처리 — 중복 생성 방지.
  const dup = await prisma.authenticator.findUnique({
    where: { credentialId },
    select: { id: true },
  });
  if (!dup) {
    await prisma.authenticator.create({
      data: {
        userId: session.user.id,
        credentialId,
        publicKey: isoBase64URL.fromBuffer(credentialPublicKey),
        counter: BigInt(counter),
        transports: body.response.response.transports?.join(",") ?? null,
        deviceName: body.deviceName?.trim().slice(0, 60) || null,
      },
    });
    await writeAuditLog({
      userId: session.user.id,
      action: "CREATE",
      entity: "Authenticator",
      entityId: credentialId,
      changes: { deviceName: { new: body.deviceName?.trim().slice(0, 60) || null } },
    });
  }

  jar.delete(REG_CHALLENGE_COOKIE);
  return NextResponse.json({ verified: true });
}
