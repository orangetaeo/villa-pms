// PUT /api/villas/[id]/rates — ADMIN 시즌 요율 일괄 수정 (T1.2, SPEC F1)
// 정책: supplierCostVnd는 공급자 입력 영역이므로 수정 불가.
//       VillaRate 레코드가 없는 시즌은 생성하지 않고 skipped로 응답 (T1.1 마법사가 생성 책임)
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { SEASONS, type Season } from "@/lib/villa-schema";

/** VND 동 단위 / 퍼센트 숫자 문자열 — BigInt는 JSON 직렬화 불가하므로 문자열로 수신 */
const digits = z.string().regex(/^\d{1,15}$/);

const rateItemSchema = z.object({
  season: z.enum(SEASONS),
  marginType: z.enum(["PERCENT", "FIXED_VND"]),
  marginValue: digits, // PERCENT: %, FIXED_VND: 동
  salePriceVnd: digits,
  salePriceKrw: z.number().int().min(0), // KRW = Int(원), 음수 거부
});

const putSchema = z.object({
  rates: z
    .array(rateItemSchema)
    .min(1)
    .max(3)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.season)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "season"],
            message: `Duplicate season: ${item.season}`,
          });
        }
        seen.add(item.season);
      });
    }),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (마진·판매가는 운영자만 다룬다)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id: villaId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const villa = await prisma.villa.findUnique({
    where: { id: villaId },
    select: { id: true, rates: true },
  });
  if (!villa) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const existingBySeason = new Map(villa.rates.map((rate) => [rate.season, rate]));

  const updated: Season[] = [];
  const skipped: Season[] = [];
  // 감사 로그용 old/new 스냅샷 (BigInt는 Json 컬럼에 못 넣으므로 문자열화)
  const auditEntries: {
    rateId: string;
    changes: Record<string, { old: unknown; new: unknown }>;
  }[] = [];

  await prisma.$transaction(async (tx) => {
    for (const item of parsed.data.rates) {
      const existing = existingBySeason.get(item.season);
      if (!existing) {
        // 해당 시즌 레코드 없음 — 원가 없이 생성 금지, skip 후 응답에 표기
        skipped.push(item.season);
        continue;
      }

      const newMarginValue = BigInt(item.marginValue);
      const newSalePriceVnd = BigInt(item.salePriceVnd);

      await tx.villaRate.update({
        where: { id: existing.id },
        data: {
          // supplierCostVnd는 의도적으로 제외 — 공급자 입력 영역
          marginType: item.marginType,
          marginValue: newMarginValue,
          salePriceVnd: newSalePriceVnd,
          salePriceKrw: item.salePriceKrw,
        },
      });

      updated.push(item.season);
      auditEntries.push({
        rateId: existing.id,
        changes: {
          season: { old: existing.season, new: item.season },
          marginType: { old: existing.marginType, new: item.marginType },
          marginValue: {
            old: existing.marginValue.toString(),
            new: newMarginValue.toString(),
          },
          salePriceVnd: {
            old: existing.salePriceVnd.toString(),
            new: newSalePriceVnd.toString(),
          },
          salePriceKrw: { old: existing.salePriceKrw, new: item.salePriceKrw },
        },
      });
    }
  });

  // 감사 로그 — 시즌별 기록 (요율 변경은 분쟁 증빙 대상)
  for (const entry of auditEntries) {
    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE",
      entity: "VillaRate",
      entityId: entry.rateId,
      changes: entry.changes,
    });
  }

  // 응답에 BigInt 값 미포함 — 시즌 키 목록만
  return NextResponse.json({ updated, skipped });
}
