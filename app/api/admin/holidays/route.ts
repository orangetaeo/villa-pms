// GET/POST /api/admin/holidays — 공휴일 캘린더(HolidayDate) 목록·추가 (ADR-0042, ADMIN 전용)
// 전역 날짜 목록(한국·베트남 공용, 빌라 무관). 프리미엄 박 판정의 OR 축 — 가격이 아니라 "어느 박이
// 프리미엄인가"만 답한다(얼마인가는 VillaRatePeriod.premium* 컬럼). date=@db.Date UTC 자정, @unique.
// 권한: ADMIN 전용(isSystemAdmin) — seasons 라우트(전역 시즌 기간)와 동일 등급의 전역 요금 설정.
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { parseUtcDateOnly, toDateOnlyString } from "@/lib/date-vn";
import { isSystemAdmin } from "@/lib/permissions";
import { requireCapability } from "@/lib/api-guard";

// route.ts는 HTTP 메서드 외 export 금지(Next 빌드 검증) — [id]/route.ts에 헬퍼 중복 유지
const holidayBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
  label: z.string().trim().min(1).max(100),
});

/** @db.Date는 "YYYY-MM-DD" 문자열로 직렬화(시간대 오해 방지) */
function serializeHoliday(h: { id: string; date: Date; label: string }) {
  return { id: h.id, date: toDateOnlyString(h.date), label: h.label };
}

export async function GET(req: Request) {
  // 권한 검사 — ADMIN 전용 (route handler 첫 줄 role 검사 규칙)
  const g = await requireCapability(isSystemAdmin, "isSystemAdmin", req);
  if (!g.ok) return g.response;

  // 연도 필터(선택) — ?year=2026 이면 [2026-01-01, 2027-01-01) 교차분만
  const yearParam = new URL(req.url).searchParams.get("year");
  let where: Prisma.HolidayDateWhereInput = {};
  if (yearParam != null) {
    const year = Number(yearParam);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "INVALID_YEAR" }, { status: 400 });
    }
    where = {
      date: {
        gte: new Date(`${year}-01-01T00:00:00.000Z`),
        lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
      },
    };
  }

  const holidays = await prisma.holidayDate.findMany({
    where,
    orderBy: { date: "asc" },
    select: { id: true, date: true, label: true },
  });
  return NextResponse.json({ holidays: holidays.map(serializeHoliday) });
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
  const parsed = holidayBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 실존 날짜 정규화(2026-02-31 등 롤오버 거부) — parseUtcDateOnly가 UTC 자정 보장
  const date = parseUtcDateOnly(parsed.data.date);
  if (!date) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }

  let created;
  try {
    created = await prisma.holidayDate.create({
      data: { date, label: parsed.data.label },
      select: { id: true, date: true, label: true },
    });
  } catch (e) {
    // date @unique — 이미 등록된 날짜면 409(중복 방지)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "DUPLICATE_DATE" }, { status: 409 });
    }
    throw e;
  }

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: session.user.id,
    action: "CREATE",
    entity: "HolidayDate",
    entityId: created.id,
    changes: {
      date: { new: toDateOnlyString(created.date) },
      label: { new: created.label },
    },
  });

  return NextResponse.json({ holiday: serializeHoliday(created) }, { status: 201 });
}
