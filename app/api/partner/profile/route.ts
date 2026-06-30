// /api/partner/profile — 파트너 본인 연락처 자기관리 (여행사 포털 C)
//   GET: 본인 Partner의 표시명(읽기전용) + contactPhone·contactEmail 반환.
//   PATCH: contactPhone·contactEmail만 수정 허용.
//     ★ 절대 미변경: name/nameVi·contactZaloUid(알림 라우팅)·creditTier/creditLimitVnd·status/approval
//       등 운영 전용 필드. 벤더 /api/vendor/profile 미러(본인 스코프 강제).
//   누수: 본인 연락처만 — 신용한도·마진·KRW 무관(애초에 select하지 않음).
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { assertSameOrigin } from "@/lib/csrf";

const patchSchema = z.object({
  contactPhone: z.string().trim().max(30).optional().nullable(),
  contactEmail: z
    .string()
    .trim()
    .max(120)
    .email("이메일 형식이 아닙니다")
    .optional()
    .nullable()
    .or(z.literal("")),
});

export async function GET(req: Request) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  if (g.session.user.role !== "PARTNER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const partner = await prisma.partner.findUnique({
    where: { userId: g.session.user.id },
    select: { name: true, nameVi: true, contactPhone: true, contactEmail: true },
  });
  if (!partner) return NextResponse.json({ error: "NOT_A_PARTNER" }, { status: 403 });

  return NextResponse.json({
    name: partner.nameVi?.trim() || partner.name, // 읽기전용 표시용(운영자 관리 필드)
    contactPhone: partner.contactPhone,
    contactEmail: partner.contactEmail,
  });
}

export async function PATCH(req: Request) {
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  if (g.session.user.role !== "PARTNER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const csrf = await assertSameOrigin(req, "partner-profile");
  if (csrf) return csrf;

  const partner = await prisma.partner.findUnique({
    where: { userId: g.session.user.id },
    select: { id: true, contactPhone: true, contactEmail: true },
  });
  if (!partner) return NextResponse.json({ error: "NOT_A_PARTNER" }, { status: 403 });

  const raw = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // ★ contactPhone·contactEmail만 갱신 — 미지정 필드는 현재값 유지(운영 필드 절대 불변).
  const nextPhone =
    parsed.data.contactPhone !== undefined
      ? (parsed.data.contactPhone?.trim() || null)
      : partner.contactPhone;
  const nextEmail =
    parsed.data.contactEmail !== undefined
      ? ((parsed.data.contactEmail ?? "").trim() || null)
      : partner.contactEmail;

  await prisma.partner.update({
    where: { id: partner.id },
    data: { contactPhone: nextPhone, contactEmail: nextEmail },
  });

  await writeAuditLog({
    userId: g.session.user.id,
    action: "UPDATE",
    entity: "Partner",
    entityId: partner.id,
    changes: {
      ...(parsed.data.contactPhone !== undefined && nextPhone !== partner.contactPhone
        ? { contactPhone: { old: partner.contactPhone, new: nextPhone } }
        : {}),
      ...(parsed.data.contactEmail !== undefined && nextEmail !== partner.contactEmail
        ? { contactEmail: { old: partner.contactEmail, new: nextEmail } }
        : {}),
    },
  });

  return NextResponse.json({ contactPhone: nextPhone, contactEmail: nextEmail });
}
