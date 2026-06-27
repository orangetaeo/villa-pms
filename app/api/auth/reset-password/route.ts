// POST /api/auth/reset-password — 비밀번호 자가재설정 2단계: 코드 검증 후 비밀번호 교체.
// 보안: 평문 코드·평문 비밀번호 절대 로그/응답/감사로그 미기록. 코드 5회 오입력 시 토큰 폐기.
// 비로그인 허용 경로(middleware public 화이트리스트). rate-limit(phone·IP).
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  normalizePhone,
  verifyResetCode,
  RESET_MIN_PASSWORD,
} from "@/lib/password-reset";
import { BCRYPT_ROUNDS, isStrongPassword, PASSWORD_POLICY_MESSAGE } from "@/lib/password-policy";

const RESET_PHONE_LIMIT = { max: 10, windowMs: 10 * 60_000 };
const RESET_IP_LIMIT = { max: 30, windowMs: 10 * 60_000 };

const schema = z.object({
  phone: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(RESET_MIN_PASSWORD).refine(isStrongPassword, PASSWORD_POLICY_MESSAGE),
});

export async function POST(req: Request) {
  const ip = clientIp(req.headers);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "newPassword") {
      return NextResponse.json({ error: "PASSWORD_TOO_SHORT" }, { status: 400 });
    }
    // code 형식 오류 등 → 코드 불일치와 동일 응답(형태 노출 최소화)
    return NextResponse.json({ error: "INVALID_CODE" }, { status: 400 });
  }

  const phone = normalizePhone(parsed.data.phone);
  const { code, newPassword } = parsed.data;

  const phoneOk = phone
    ? checkRateLimit(`reset:phone:${phone}`, RESET_PHONE_LIMIT).allowed
    : true;
  const ipOk = ip ? checkRateLimit(`reset:ip:${ip}`, RESET_IP_LIMIT).allowed : true;
  if (!phoneOk || !ipOk) {
    return NextResponse.json({ error: "INVALID_CODE" }, { status: 400 });
  }

  const user = phone
    ? await prisma.user.findUnique({
        where: { phone },
        select: { id: true, isActive: true, deletedAt: true },
      })
    : null;

  // 부재·비활성·삭제 → 코드 불일치와 동일 400(열거 방지)
  if (!user || !user.isActive || user.deletedAt) {
    return NextResponse.json({ error: "INVALID_CODE" }, { status: 400 });
  }

  const verify = await verifyResetCode(user.id, code);
  if (!verify.ok) {
    if (verify.reason === "EXPIRED") {
      return NextResponse.json({ error: "CODE_EXPIRED" }, { status: 400 });
    }
    if (verify.reason === "TOO_MANY_ATTEMPTS") {
      return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 400 });
    }
    // NO_TOKEN·WRONG_CODE → 동일 응답
    return NextResponse.json({ error: "INVALID_CODE" }, { status: 400 });
  }

  // 검증 성공 — 비밀번호 교체 + 토큰 사용 처리(원자적). 임시 비번 게이트도 해제.
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });
    // 사용한 토큰 + 그 user의 다른 미사용 토큰 모두 무효화
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await writeAuditLog({
      userId: user.id,
      action: "UPDATE",
      entity: "User",
      entityId: user.id,
      changes: { passwordResetCompleted: { new: true } },
      db: tx,
    });
  });

  return NextResponse.json({ ok: true });
}
