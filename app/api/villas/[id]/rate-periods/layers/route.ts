// POST /api/villas/[id]/rate-periods/layers — 레이어(웃돈 기간) 1개 증분 생성 (rate-calendar-ux)
// 동시 편집 덮어쓰기 제거: 전체 교체 PATCH 대신 레이어 단위로 추가한다.
//  - base(isBase) 생성 금지 — 기본요금은 전체 교체 PATCH 전용(레이어 라우트는 non-base만).
//  - 겹침 허용(견적은 resolveRatePeriod 4단계 승자). half-open(start<end)만 검증.
//  - 권한: ADMIN 전용(canSetPrice) — 마진·판매가를 다룸. writeAuditLog 필수.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { canSetPrice } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";
import {
  SEASONS,
  isoDate,
  toUtc,
  priceColumns,
  buildPriceColumnData,
} from "@/lib/rate-period-input";

const layerSchema = z
  .object({
    season: z.enum(SEASONS),
    startDate: isoDate,
    endDate: isoDate,
    label: z.string().trim().max(60).nullable().optional(),
    batchId: z.string().max(40).nullable().optional(),
    ...priceColumns,
  })
  .superRefine((data, ctx) => {
    if (toUtc(data.startDate).getTime() >= toUtc(data.endDate).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "endDate must be after startDate",
      });
    }
  });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCapability(canSetPrice, "canSetPrice", req);
  if (!g.ok) return g.response;
  const actorUserId = g.session.user.id;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  const parsed = layerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const p = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const villa = await tx.villa.findUnique({ where: { id }, select: { id: true } });
    if (!villa) return { kind: "NOT_FOUND" as const };

    const created = await tx.villaRatePeriod.create({
      data: {
        villaId: id,
        season: p.season,
        isBase: false,
        startDate: toUtc(p.startDate),
        endDate: toUtc(p.endDate),
        label: p.label ?? null,
        batchId: p.batchId ?? null,
        ...buildPriceColumnData(p),
      },
      select: { id: true },
    });

    await writeAuditLog({
      db: tx,
      userId: actorUserId,
      action: "CREATE",
      entity: "VillaRatePeriod",
      entityId: created.id,
      changes: {
        villaId: { new: id },
        season: { new: p.season },
        startDate: { new: p.startDate },
        endDate: { new: p.endDate },
      },
    });

    return { kind: "OK" as const, id: created.id };
  });

  if (result.kind === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  // 응답에 금액 미포함 — 생성된 레이어 id만
  return NextResponse.json({ id: result.id });
}
