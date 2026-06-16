"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const signupSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(8),
  password: z.string().min(8),
});

// 자동 계정 스팸 방어 (T-sec-auth-ratelimit) — IP당 시간당 한도.
// 정상 사용자 오타 재시도를 막지 않도록 여유 있게(10/시간). 봇은 수백 건이라 충분히 차단.
const SIGNUP_IP_LIMIT = { max: 10, windowMs: 60 * 60_000 };

export type SignupState = { error?: string } | null;

export async function signupAction(
  prevState: SignupState,
  formData: FormData
): Promise<SignupState> {
  // 가입 스팸 차단 — IP 한도 초과 시 즉시 거부(신규 i18n 키 없이 기존 serverError 재사용)
  const ip = clientIp(await headers());
  if (ip && !checkRateLimit(`signup:ip:${ip}`, SIGNUP_IP_LIMIT).allowed) {
    return { error: "serverError" };
  }

  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "password") return { error: "passwordTooShort" };
    return { error: "serverError" };
  }

  const { name, phone, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) return { error: "phoneExists" };

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, phone, passwordHash, role: "SUPPLIER", locale: "vi" },
  });

  await writeAuditLog({
    userId: null,
    action: "CREATE",
    entity: "User",
    entityId: user.id,
  });

  try {
    await signIn("credentials", { phone, password, redirectTo: "/my-villas" });
  } catch (error) {
    if (error instanceof AuthError) return { error: "serverError" };
    throw error; // NEXT_REDIRECT re-throw
  }
  return null;
}
