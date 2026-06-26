// GET   /api/partners/[id] — 파트너 상세(신용정보·미수·이력) (canViewFinance 전용)
// PATCH /api/partners/[id] — 파트너 신용정보 수정 (canViewFinance 전용)
// 미수·신용한도는 ADMIN(재무) 전용 — 누수 가드 (ADR-0022)
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance, isSystemAdmin } from "@/lib/permissions";
import { serializeBigInt } from "@/lib/serialize";
import { getPartnerDetail } from "@/lib/partner-server";
import { PARTNER_COUNTRIES } from "@/lib/partner-country";

const vndString = z.string().regex(/^\d+$/);

// 수정 가능 필드 — 전부 선택. type(여행사/랜드사)은 생성 후 불변(채권 귀속 일관성).
const partnerUpdateSchema = z
  .object({
    name: z.string().min(1).max(120),
    nameVi: z.string().max(120).nullish(),
    contactPhone: z.string().max(40).nullish(),
    contactZaloUid: z.string().max(80).nullish(),
    contactEmail: z.string().email().max(120).nullish().or(z.literal("")),
    country: z.enum(PARTNER_COUNTRIES).nullish().or(z.literal("")),
    creditTier: z.enum(["A", "B", "C"]),
    creditLimitVnd: vndString,
    depositRatePct: z.number().int().min(0).max(100),
    paymentTermDays: z.number().int().min(0).max(365),
    billingCycle: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]).nullish(),
    status: z.enum(["ACTIVE", "SUSPENDED", "BLOCKED"]),
    memo: z.string().max(2000).nullish(),
  })
  .partial();

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const detail = await getPartnerDetail(prisma, id, new Date());
  if (!detail) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ partner: serializeBigInt(detail) });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = partnerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const d = parsed.data;

  const existing = await prisma.partner.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 여신 한도·등급은 위험통제 마스터(요율 마스터급) — 값 실변경은 OWNER 전용(isSystemAdmin).
  // MANAGER는 연락처·메모 등 다른 필드만 수정. 폼 전체 전송 호환 위해 "값이 실제로 바뀔 때"만 차단.
  const changesCredit =
    (d.creditTier !== undefined && d.creditTier !== existing.creditTier) ||
    (d.creditLimitVnd !== undefined && BigInt(d.creditLimitVnd) !== existing.creditLimitVnd);
  if (changesCredit && !isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "CREDIT_FIELDS_OWNER_ONLY" }, { status: 403 });
  }

  // 변경 필드만 매핑 — undefined는 미수정
  const data: Record<string, unknown> = {};
  if (d.name !== undefined) data.name = d.name;
  if (d.nameVi !== undefined) data.nameVi = d.nameVi ?? null;
  if (d.contactPhone !== undefined) data.contactPhone = d.contactPhone ?? null;
  if (d.contactZaloUid !== undefined) data.contactZaloUid = d.contactZaloUid ?? null;
  if (d.contactEmail !== undefined) data.contactEmail = d.contactEmail ? d.contactEmail : null;
  if (d.country !== undefined) data.country = d.country ? d.country : null;
  if (d.creditTier !== undefined) data.creditTier = d.creditTier;
  if (d.creditLimitVnd !== undefined) data.creditLimitVnd = BigInt(d.creditLimitVnd);
  if (d.depositRatePct !== undefined) data.depositRatePct = d.depositRatePct;
  if (d.paymentTermDays !== undefined) data.paymentTermDays = d.paymentTermDays;
  if (d.billingCycle !== undefined) data.billingCycle = d.billingCycle ?? null;
  if (d.status !== undefined) data.status = d.status;
  if (d.memo !== undefined) data.memo = d.memo ?? null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "NO_FIELDS" }, { status: 400 });
  }

  const updated = await prisma.partner.update({ where: { id }, data });

  // 감사 로그 — 신용한도·등급 변경은 미수 리스크 직결, 변경 전후 기록
  const changes: Record<string, { old?: unknown; new?: unknown }> = {};
  if (d.creditTier !== undefined && d.creditTier !== existing.creditTier) {
    changes.creditTier = { old: existing.creditTier, new: updated.creditTier };
  }
  if (
    d.creditLimitVnd !== undefined &&
    BigInt(d.creditLimitVnd) !== existing.creditLimitVnd
  ) {
    changes.creditLimitVnd = {
      old: existing.creditLimitVnd.toString(),
      new: updated.creditLimitVnd.toString(),
    };
  }
  if (d.status !== undefined && d.status !== existing.status) {
    changes.status = { old: existing.status, new: updated.status };
  }
  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "Partner",
    entityId: id,
    changes: Object.keys(changes).length > 0 ? changes : { name: { new: updated.name } },
  });

  return NextResponse.json(serializeBigInt(updated));
}
