// 패스키 로그인 검증 헬퍼 (ADR-0030). auth.ts의 passkey provider가 호출한다.
//   서명·challenge·RPID·origin 검증 → 성공 시 counter 갱신 후 userId 반환.
//   실패/미일치는 전부 null(공격자에게 실패 이유를 구분해주지 않는다 — 기존 로그인과 동일 정책).
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { prisma } from "@/lib/prisma";
import { getRpConfig } from "@/lib/webauthn";

export async function verifyPasskeyLogin(params: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
}): Promise<{ userId: string } | null> {
  // 자격증명 조회 — 브라우저가 돌려준 credential id로 매칭(usernameless/discoverable).
  const cred = await prisma.authenticator.findUnique({
    where: { credentialId: params.response.id },
    select: { id: true, userId: true, credentialId: true, publicKey: true, counter: true },
  });
  if (!cred) return null;

  const { rpID, origin } = getRpConfig();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: params.response,
      expectedChallenge: params.expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: isoBase64URL.toBuffer(cred.credentialId),
        credentialPublicKey: isoBase64URL.toBuffer(cred.publicKey),
        counter: Number(cred.counter),
      },
      requireUserVerification: false,
    });
  } catch {
    return null;
  }
  if (!verification.verified) return null;

  // 재생공격 방지 카운터 갱신 + 마지막 사용시각 기록.
  await prisma.authenticator.update({
    where: { id: cred.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });
  return { userId: cred.userId };
}
