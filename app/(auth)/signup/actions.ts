"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";

const signupSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(8),
  password: z.string().min(8),
});

export type SignupState = { error?: string } | null;

export async function signupAction(
  prevState: SignupState,
  formData: FormData
): Promise<SignupState> {
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
