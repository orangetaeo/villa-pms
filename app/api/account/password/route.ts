// POST /api/account/password — 로그인 사용자 본인 비밀번호 변경 (self-service)
// 현재 비밀번호 검증 후 교체. 임시 비번으로 로그인한 사용자가 직접 변경하는 경로.
// 평문·해시는 감사 로그에 절대 기록하지 않는다 (leak-checklist).
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { BCRYPT_ROUNDS, PASSWORD_MIN, isStrongPassword, PASSWORD_POLICY_MESSAGE } from "@/lib/password-policy";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(PASSWORD_MIN).refine(isStrongPassword, PASSWORD_POLICY_MESSAGE),
});

export async function POST(req: Request) {
  // 권한 검사 — 로그인 사용자 본인만 (자기 계정 비밀번호 변경)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "PASSWORD_TOO_SHORT", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true },
  });
  if (!user?.passwordHash) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 현재 비밀번호 검증 — 틀리면 변경 차단 (본인 확인 게이트)
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "WRONG_PASSWORD" }, { status: 400 });
  }

  // 기존과 동일한 비밀번호로의 변경 차단
  const same = await bcrypt.compare(newPassword, user.passwordHash);
  if (same) {
    return NextResponse.json({ error: "SAME_PASSWORD" }, { status: 400 });
  }

  // 비밀번호 해시 — auth.ts·계정 생성과 동일 bcryptjs(10 rounds)
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    // 본인이 직접 변경 완료 → 강제 변경 플래그 해제
    data: { passwordHash, mustChangePassword: false },
  });

  // 감사 로그 — 본인 변경 사실(passwordChanged)만 기록, 평문·해시 미기록
  await writeAuditLog({
    userId: user.id,
    action: "UPDATE",
    entity: "User",
    entityId: user.id,
    changes: { passwordChanged: { new: true } },
  });

  return NextResponse.json({ ok: true });
}
