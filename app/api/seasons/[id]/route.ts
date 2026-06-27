// PUT/DELETE /api/seasons/[id] — 시즌 기간(SeasonPeriod) 수정·삭제 (T1.7, ADMIN 전용)
// 기간 규약: [startDate, endDate) half-open, @db.Date = UTC 자정
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { parseUtcDateOnly, toDateOnlyString } from "@/lib/date-vn";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

// ../route.ts와 동일 스키마 — route.ts는 HTTP 메서드 외 export 금지라 중복 유지
const seasonBodySchema = z.object({
  season: z.enum(["LOW", "HIGH", "PEAK"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
  label: z.string().trim().min(1).max(100).optional(),
});

/** 입력 문자열 → UTC 자정 Date + start < end 검증 (T1.3 QA 권고: UTC 자정 정규화) */
function parseSeasonRange(
  data: z.infer<typeof seasonBodySchema>
): { startDate: Date; endDate: Date } | NextResponse {
  const startDate = parseUtcDateOnly(data.startDate);
  const endDate = parseUtcDateOnly(data.endDate);
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  if (startDate.getTime() >= endDate.getTime()) {
    return NextResponse.json(
      { error: "INVALID_RANGE", message: "시작일은 종료일보다 앞서야 합니다" },
      { status: 400 }
    );
  }
  return { startDate, endDate };
}

function serializeSeasonPeriod(p: {
  id: string;
  season: string;
  startDate: Date;
  endDate: Date;
  label: string | null;
}) {
  return {
    id: p.id,
    season: p.season,
    startDate: toDateOnlyString(p.startDate),
    endDate: toDateOnlyString(p.endDate),
    label: p.label,
  };
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = seasonBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const range = parseSeasonRange(parsed.data);
  if (range instanceof NextResponse) return range;

  const old = await prisma.seasonPeriod.findUnique({ where: { id } });
  if (!old) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 수정 + 겹침 경고(자기 자신 제외, half-open 교차) — 차단하지 않음
  const [overlapping, updated] = await prisma.$transaction([
    prisma.seasonPeriod.findMany({
      where: {
        id: { not: id },
        startDate: { lt: range.endDate },
        endDate: { gt: range.startDate },
      },
      select: { id: true },
    }),
    prisma.seasonPeriod.update({
      where: { id },
      data: {
        season: parsed.data.season,
        startDate: range.startDate,
        endDate: range.endDate,
        label: parsed.data.label ?? null,
      },
    }),
  ]);

  // 감사 로그 — old/new 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: session.user.id,
    action: "UPDATE",
    entity: "SeasonPeriod",
    entityId: id,
    changes: {
      season: { old: old.season, new: updated.season },
      startDate: {
        old: toDateOnlyString(old.startDate),
        new: toDateOnlyString(updated.startDate),
      },
      endDate: {
        old: toDateOnlyString(old.endDate),
        new: toDateOnlyString(updated.endDate),
      },
      label: { old: old.label, new: updated.label },
    },
  });

  return NextResponse.json({
    period: serializeSeasonPeriod(updated),
    overlaps: overlapping.map((p) => p.id),
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 권한 검사 — ADMIN 전용
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;
  const session = g.session;

  const { id } = await params;

  const old = await prisma.seasonPeriod.findUnique({ where: { id } });
  if (!old) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  await prisma.seasonPeriod.delete({ where: { id } });

  // 감사 로그 — 삭제된 값 보존 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: session.user.id,
    action: "DELETE",
    entity: "SeasonPeriod",
    entityId: id,
    changes: {
      season: { old: old.season },
      startDate: { old: toDateOnlyString(old.startDate) },
      endDate: { old: toDateOnlyString(old.endDate) },
      label: { old: old.label },
    },
  });

  return NextResponse.json({ id, deleted: true });
}
