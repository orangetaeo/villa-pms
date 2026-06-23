// /api/settlements — ADMIN 월 정산 목록·집계 실행 (T4.5, SPEC F6)
// GET ?yearMonth=YYYY-MM : 정산 목록 (공급자 name·phone + items count)
// POST { yearMonth }     : 월 집계 실행 (멱등) + AuditLog(CREATE 묶음, entityId=yearMonth)
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { serializeBigInt } from "@/lib/serialize";
import { generateMonthlySettlements, monthRangeUtc } from "@/lib/settlement";
import { canViewFinance, isSystemAdmin } from "@/lib/permissions";

const YEAR_MONTH_SCHEMA = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM 형식 필요");

export async function GET(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canViewFinance(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const yearMonthParam = new URL(req.url).searchParams.get("yearMonth");
  let yearMonth: string | undefined;
  if (yearMonthParam !== null) {
    const parsed = YEAR_MONTH_SCHEMA.safeParse(yearMonthParam);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }
    yearMonth = parsed.data;
  }

  const settlements = await prisma.settlement.findMany({
    where: yearMonth ? { yearMonth } : undefined,
    orderBy: [{ yearMonth: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      supplierId: true,
      yearMonth: true,
      totalVnd: true,
      status: true,
      paidAt: true,
      createdAt: true,
      supplier: { select: { name: true, phone: true } },
      _count: { select: { items: true } },
    },
  });

  return NextResponse.json({ settlements: serializeBigInt(settlements) });
}

export async function POST(req: Request) {
  // 권한 검사 — ADMIN 전용
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = z.object({ yearMonth: YEAR_MONTH_SCHEMA }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  // lib 레벨 형식 검증과 이중 안전망 — 여기서 통과하면 monthRangeUtc는 throw하지 않음
  monthRangeUtc(parsed.data.yearMonth);

  const summary = await generateMonthlySettlements(parsed.data.yearMonth);

  // 감사 로그 — 집계 실행 묶음 기록 (entityId = yearMonth, 계약)
  await writeAuditLog({
    userId: session.user.id,
    action: "CREATE",
    entity: "Settlement",
    entityId: parsed.data.yearMonth,
    changes: {
      created: { new: summary.created },
      updated: { new: summary.updated },
      skipped: { new: summary.skipped },
      totalSuppliers: { new: summary.totalSuppliers },
    },
  });

  return NextResponse.json(summary);
}
