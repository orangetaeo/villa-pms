// POST /api/calendar-blocks/bulk — 범위 날짜 일괄 잠금/해제 (T-admin-availability-board)
// 단일 라우트(app/api/calendar-blocks/route.ts)의 auth·villa 스코프·$transaction·
// lockVillaInventory·AuditLog 패턴을 그대로 복제. 가용성 판정 기준(점유 예약 상태)은
// lib/availability.ts 단일 소스(OCCUPYING_BOOKING_STATUSES)만 사용 — 중복 구현 금지.
import { NextResponse } from "next/server";
import { z } from "zod";
import { BlockSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { lockVillaInventory, OCCUPYING_BOOKING_STATUSES } from "@/lib/availability";
import {
  addUtcDays,
  parseUtcDateOnly,
  toDateOnlyString,
  todayVnDateString,
} from "@/lib/date-vn";
import { isOperator } from "@/lib/permissions";
import { requireAuth } from "@/lib/api-guard";

const MAX_RANGE_DAYS = 92; // 범위 일수 상한 (inclusive)

const bulkSchema = z.object({
  villaId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.enum(["lock", "unlock"]),
});

export async function POST(req: Request) {
  // 권한 검사 — SUPPLIER(자기 빌라) + ADMIN(전체 빌라) 허용 (비로그인 401/타롤 403 분리)
  const g = await requireAuth(req);
  if (!g.ok) return g.response;
  const session = g.session;
  const role = session.user.role;
  if (role !== "SUPPLIER" && !isOperator(role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const actorId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 날짜 UTC 자정 정규화 + 실존 날짜 검증
  const rangeStart = parseUtcDateOnly(parsed.data.startDate); // 포함
  const rangeEndInclusive = parseUtcDateOnly(parsed.data.endDate); // 포함(마지막 날)
  if (!rangeStart || !rangeEndInclusive) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  if (rangeStart.getTime() > rangeEndInclusive.getTime()) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }
  // half-open 끝 = 마지막 포함일 + 1
  const rangeEndExclusive = addUtcDays(rangeEndInclusive, 1);

  // 범위 일수 상한 (inclusive)
  const rangeDays = Math.round(
    (rangeEndExclusive.getTime() - rangeStart.getTime()) / 86_400_000
  );
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: "RANGE_TOO_LARGE" }, { status: 400 });
  }

  // 과거 날짜는 건너뜀(skip) — Asia/Ho_Chi_Minh 오늘 기준
  const today = todayVnDateString();

  // 처리 대상 날짜 집합 D = [start, endExclusive) 중 today 이상 날짜 ("YYYY-MM-DD")
  const dDays: string[] = [];
  for (
    let d = rangeStart;
    d.getTime() < rangeEndExclusive.getTime();
    d = addUtcDays(d, 1)
  ) {
    const ds = toDateOnlyString(d);
    if (ds >= today) dDays.push(ds);
  }
  const totalRangeDays = rangeDays;

  // 빌라 조회 — SUPPLIER 는 자기 빌라(supplierId 스코프)만, ADMIN 은 전체. 없으면 404
  const villa = await prisma.villa.findFirst({
    where: {
      id: parsed.data.villaId,
      ...(role === "SUPPLIER" ? { supplierId: actorId } : {}),
    },
    select: { id: true },
  });
  if (!villa) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 범위 전체가 과거면 처리 없음
  if (dDays.length === 0) {
    return NextResponse.json({ affected: 0, skipped: totalRangeDays });
  }

  // 트랜잭션 — 단일 라우트와 동일 advisory lock 키 (HOLD·iCal upsert와 공유)
  const affected = await prisma.$transaction(async (tx) => {
    await lockVillaInventory(tx, villa.id);

    // 기존 블록 1쿼리 — 범위 [start, endExclusive) 와 겹치는 MANUAL/ICAL 블록
    const blocks = await tx.calendarBlock.findMany({
      where: {
        villaId: villa.id,
        startDate: { lt: rangeEndExclusive },
        endDate: { gt: rangeStart },
      },
      select: { id: true, startDate: true, endDate: true, source: true },
    });

    // 점유 예약 1쿼리 — 범위와 겹치는 차단 상태 예약 (checkAvailability 와 동일 상태값)
    const bookings = await tx.booking.findMany({
      where: {
        villaId: villa.id,
        status: { in: [...OCCUPYING_BOOKING_STATUSES] },
        checkIn: { lt: rangeEndExclusive },
        checkOut: { gt: rangeStart },
      },
      select: { checkIn: true, checkOut: true },
    });

    // 날짜별 점유(예약) Set
    const bookedDays = new Set<string>();
    for (const b of bookings) {
      const from = b.checkIn.getTime() > rangeStart.getTime() ? b.checkIn : rangeStart;
      const to =
        b.checkOut.getTime() < rangeEndExclusive.getTime()
          ? b.checkOut
          : rangeEndExclusive;
      for (let d = from; d.getTime() < to.getTime(); d = addUtcDays(d, 1)) {
        bookedDays.add(toDateOnlyString(d));
      }
    }

    // 날짜별 기존 블록 전개 — 잠금 여부 / MANUAL 단일날짜 블록 id
    const blockedDays = new Set<string>(); // 이미 잠긴 날짜(MANUAL/ICAL)
    const manualSingleByDay = new Map<string, string>(); // d → MANUAL 단일날짜 블록 id (startDate==d)
    for (const blk of blocks) {
      const from =
        blk.startDate.getTime() > rangeStart.getTime() ? blk.startDate : rangeStart;
      const to =
        blk.endDate.getTime() < rangeEndExclusive.getTime()
          ? blk.endDate
          : rangeEndExclusive;
      for (let d = from; d.getTime() < to.getTime(); d = addUtcDays(d, 1)) {
        blockedDays.add(toDateOnlyString(d));
      }
      // MANUAL 단일날짜 블록 [d, d+1) 만 unlock 대상으로 식별
      if (
        blk.source === BlockSource.MANUAL &&
        addUtcDays(blk.startDate, 1).getTime() === blk.endDate.getTime()
      ) {
        manualSingleByDay.set(toDateOnlyString(blk.startDate), blk.id);
      }
    }

    if (parsed.data.action === "lock") {
      // 예약 점유 없음 AND 기존 블록 없음 인 날짜만 MANUAL 단일날짜 블록 생성
      const toLock = dDays.filter(
        (d) => !bookedDays.has(d) && !blockedDays.has(d)
      );
      if (toLock.length === 0) return 0;
      await tx.calendarBlock.createMany({
        data: toLock.map((d) => {
          const sd = parseUtcDateOnly(d)!;
          return {
            villaId: villa.id,
            startDate: sd,
            endDate: addUtcDays(sd, 1),
            source: BlockSource.MANUAL,
            createdBy: actorId,
          };
        }),
      });
      return toLock.length;
    }

    // unlock — D 중 해당 빌라의 MANUAL 단일날짜 블록(startDate==d)만 삭제
    const idsToDelete = dDays
      .map((d) => manualSingleByDay.get(d))
      .filter((id): id is string => id !== undefined);
    if (idsToDelete.length === 0) return 0;
    const del = await tx.calendarBlock.deleteMany({
      where: { id: { in: idsToDelete }, villaId: villa.id, source: BlockSource.MANUAL },
    });
    return del.count;
  });

  // 감사 로그 — 일괄 작업 1건 요약 (글로벌 절대 규칙). entityId=villaId 로 범위·건수 추적
  await writeAuditLog({
    userId: actorId,
    action: parsed.data.action === "lock" ? "CREATE" : "DELETE",
    entity: "CalendarBlock",
    entityId: villa.id,
    changes: {
      villaId: { new: villa.id },
      startDate: { new: parsed.data.startDate },
      endDate: { new: parsed.data.endDate },
      source: { new: "MANUAL" },
      count: { new: affected },
    },
  });

  return NextResponse.json({ affected, skipped: totalRangeDays - affected });
}
