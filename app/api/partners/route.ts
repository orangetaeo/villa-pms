// GET  /api/partners — 파트너 목록 + 미수/Aging 집계 (canViewFinance 전용)
// POST /api/partners — 파트너 생성 (canViewFinance 전용)
// 미수·신용한도는 ADMIN(재무) 전용 — STAFF·공급자·공개 라우트 비노출 (ADR-0022 누수 가드)
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { serializeBigInt } from "@/lib/serialize";
import { getPartnersWithAggregates } from "@/lib/partner-server";
import { PARTNER_COUNTRIES } from "@/lib/partner-country";

const vndString = z
  .string()
  .regex(/^\d+$/, "VND must be non-negative integer digits");

const partnerCreateSchema = z.object({
  type: z.enum(["TRAVEL_AGENCY", "LAND_AGENCY"]),
  name: z.string().min(1).max(120),
  nameVi: z.string().max(120).nullish(),
  contactPhone: z.string().max(40).nullish(),
  contactZaloUid: z.string().max(80).nullish(),
  contactEmail: z.string().email().max(120).nullish().or(z.literal("")),
  country: z.enum(PARTNER_COUNTRIES).nullish().or(z.literal("")),
  creditTier: z.enum(["A", "B", "C"]).default("A"),
  creditLimitVnd: vndString.default("0"),
  depositRatePct: z.number().int().min(0).max(100).default(30),
  paymentTermDays: z.number().int().min(0).max(365).default(0),
  billingCycle: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]).nullish(),
  status: z.enum(["ACTIVE", "SUSPENDED", "BLOCKED"]).default("ACTIVE"),
  memo: z.string().max(2000).nullish(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const partners = await getPartnersWithAggregates(prisma, new Date());
  return NextResponse.json({ partners: serializeBigInt(partners) });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = partnerCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const d = parsed.data;

  const created = await prisma.partner.create({
    data: {
      type: d.type,
      name: d.name,
      nameVi: d.nameVi ?? null,
      contactPhone: d.contactPhone ?? null,
      contactZaloUid: d.contactZaloUid ?? null,
      contactEmail: d.contactEmail ? d.contactEmail : null,
      country: d.country ? d.country : null,
      creditTier: d.creditTier,
      creditLimitVnd: BigInt(d.creditLimitVnd),
      depositRatePct: d.depositRatePct,
      paymentTermDays: d.paymentTermDays,
      billingCycle: d.billingCycle ?? null,
      status: d.status,
      memo: d.memo ?? null,
    },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: "CREATE",
    entity: "Partner",
    entityId: created.id,
    changes: {
      type: { new: created.type },
      name: { new: created.name },
      creditTier: { new: created.creditTier },
      creditLimitVnd: { new: created.creditLimitVnd.toString() },
      depositRatePct: { new: created.depositRatePct },
    },
  });

  return NextResponse.json(serializeBigInt(created), { status: 201 });
}
