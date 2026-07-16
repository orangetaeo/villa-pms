// PATCH /api/admin/business-contracts/[id] — DRAFT만 termsJson·locale 수정 (T-business-contract-esign)
//   SENT/SIGNED/VOID는 409(봉인·발송 후 변경 금지). canViewFinance.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canViewFinance } from "@/lib/permissions";
import { isLocaleAllowed, parseTerms } from "@/lib/business-contract";
import type { Prisma } from "@prisma/client";

const patchSchema = z
  .object({
    locale: z.enum(["ko", "vi"]).optional(),
    terms: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.locale !== undefined || v.terms !== undefined, {
    message: "NOTHING_TO_UPDATE",
  });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(canViewFinance, "canViewFinance", req);
  if (!g.ok) return g.response;
  const actorId = g.userId;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_FAILED", issues: parsed.error.flatten() }, { status: 400 });
  }

  const contract = await prisma.businessContract.findUnique({
    where: { id },
    select: { id: true, type: true, status: true, locale: true },
  });
  if (!contract) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (contract.status !== "DRAFT") {
    // 발송(SENT)·서명(SIGNED)·무효(VOID) 후에는 수정 불가 — 봉인.
    return NextResponse.json({ error: "NOT_EDITABLE", status: contract.status }, { status: 409 });
  }

  const nextLocale = parsed.data.locale ?? (contract.locale as "ko" | "vi");
  if (!isLocaleAllowed(contract.type, nextLocale)) {
    return NextResponse.json({ error: "LOCALE_NOT_ALLOWED", type: contract.type, locale: nextLocale }, { status: 400 });
  }

  const data: Prisma.BusinessContractUpdateInput = {};
  if (parsed.data.locale !== undefined) data.locale = parsed.data.locale;
  if (parsed.data.terms !== undefined) {
    const termsParsed = parseTerms(contract.type, parsed.data.terms);
    if (!termsParsed.success) {
      return NextResponse.json(
        { error: "TERMS_VALIDATION_FAILED", issues: termsParsed.error.flatten() },
        { status: 400 },
      );
    }
    data.termsJson = termsParsed.data as Prisma.InputJsonValue;
  }

  await prisma.businessContract.update({ where: { id }, data });

  await writeAuditLog({
    db: prisma,
    userId: actorId,
    action: "UPDATE",
    entity: "BusinessContract",
    entityId: id,
    changes: {
      ...(parsed.data.locale !== undefined ? { locale: { old: contract.locale, new: parsed.data.locale } } : {}),
      ...(parsed.data.terms !== undefined ? { termsJson: { new: "updated" } } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
