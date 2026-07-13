// GET/POST /api/seasons — 시즌 기간(SeasonPeriod) 목록·생성 (T1.7, ADMIN 전용)
// 기간 규약: [startDate, endDate) half-open, @db.Date = UTC 자정 (lib/pricing resolveSeason과 동일)
// 겹침은 허용(가격은 PEAK > HIGH > LOW 우선 규칙으로 판정) — 응답에 overlaps 경고만 포함
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { parseUtcDateOnly, toDateOnlyString } from "@/lib/date-vn";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

// route.ts는 HTTP 메서드 외 export 금지(Next 빌드 검증) — [id]/route.ts에 동일 헬퍼 중복 유지
const seasonBodySchema = z.object({
  season: z.enum(["LOW", "SHOULDER", "HIGH", "PEAK"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
  label: z.string().trim().min(1).max(100).optional(),
});

/** 입력 문자열 → UTC 자정 Date + start < end 검증. 실패 시 NextResponse(400) 반환 */
function parseSeasonRange(
  data: z.infer<typeof seasonBodySchema>
): { startDate: Date; endDate: Date } | NextResponse {
  // T1.3 QA 권고: 반드시 UTC 자정 정규화 — half-open 경계 어긋남 방지
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

/** 직렬화 — @db.Date는 "YYYY-MM-DD" 문자열로 (시간대 오해 방지) */
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

export async function GET() {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isSystemAdmin(session.user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const periods = await prisma.seasonPeriod.findMany({
    orderBy: { startDate: "asc" },
  });
  return NextResponse.json({ periods: periods.map(serializeSeasonPeriod) });
}

export async function POST(req: Request) {
  // 권한 검사 — ADMIN 전용
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;
  const session = g.session;

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

  // 겹치는 기존 기간 조회 (half-open 교차) — 차단하지 않고 경고용 id만 응답
  const [overlapping, created] = await prisma.$transaction([
    prisma.seasonPeriod.findMany({
      where: { startDate: { lt: range.endDate }, endDate: { gt: range.startDate } },
      select: { id: true },
    }),
    prisma.seasonPeriod.create({
      data: {
        season: parsed.data.season,
        startDate: range.startDate,
        endDate: range.endDate,
        label: parsed.data.label ?? null,
      },
    }),
  ]);

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: session.user.id,
    action: "CREATE",
    entity: "SeasonPeriod",
    entityId: created.id,
    changes: {
      season: { new: created.season },
      startDate: { new: toDateOnlyString(created.startDate) },
      endDate: { new: toDateOnlyString(created.endDate) },
      label: { new: created.label },
    },
  });

  return NextResponse.json(
    {
      period: serializeSeasonPeriod(created),
      overlaps: overlapping.map((p) => p.id),
    },
    { status: 201 }
  );
}
