// POST /api/calendar-blocks — SUPPLIER 단일 날짜 수동 차단 [d, d+1) (T1.4, SPEC F2)
// 가용성 판정은 lib/availability.ts 단일 소스만 사용 — 중복 구현 금지
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { checkAvailability, lockVillaInventory } from "@/lib/availability";
import { addUtcDays, parseUtcDateOnly, todayVnDateString } from "@/lib/date-vn";

const createSchema = z.object({
  villaId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  // 권한 검사 — SUPPLIER 전용 (route handler 첫 줄 role 검사 규칙, 비로그인 401/타롤 403 분리)
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (session.user.role !== "SUPPLIER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const supplierId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 날짜 UTC 자정 정규화 (availability-pattern 교훈) + 실존 날짜 검증
  const startDate = parseUtcDateOnly(parsed.data.date);
  if (!startDate) {
    return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
  }
  const endDate = addUtcDays(startDate, 1); // 단일 날짜 차단 = [d, d+1)

  // 과거 날짜 차단 금지 — Asia/Ho_Chi_Minh 오늘 기준
  if (parsed.data.date < todayVnDateString()) {
    return NextResponse.json({ error: "PAST_DATE" }, { status: 400 });
  }

  // 빌라 소유권 검증 — 타인 빌라는 존재 여부도 노출하지 않음 (404)
  const villa = await prisma.villa.findFirst({
    where: { id: parsed.data.villaId, supplierId },
    select: { id: true },
  });
  if (!villa) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // 트랜잭션 안에서 겹침 재확인 후 생성 (동시성 — HOLD 패턴과 동일)
  const result = await prisma.$transaction(async (tx) => {
    // 빌라 단위 advisory lock (QA D1) — HOLD 생성(T2.3)·iCal upsert와 동일 락 키 공유
    await lockVillaInventory(tx, villa.id);

    const availability = await checkAvailability(tx, villa.id, {
      checkIn: startDate,
      checkOut: endDate,
    });
    const hasConflict =
      availability.reasons.includes("BOOKING_OVERLAP") ||
      availability.reasons.includes("BLOCK_OVERLAP");
    if (hasConflict) return { conflict: true as const };

    const block = await tx.calendarBlock.create({
      data: {
        villaId: villa.id,
        startDate,
        endDate,
        source: "MANUAL",
        createdBy: supplierId,
      },
    });
    return { conflict: false as const, block };
  });

  if (result.conflict) {
    return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
  }

  // 감사 로그 — 데이터 변경 API 동시 기록 (글로벌 절대 규칙)
  await writeAuditLog({
    userId: supplierId,
    action: "CREATE",
    entity: "CalendarBlock",
    entityId: result.block.id,
    changes: {
      villaId: { new: villa.id },
      startDate: { new: parsed.data.date },
      source: { new: "MANUAL" },
    },
  });

  return NextResponse.json(
    { id: result.block.id, startDate: parsed.data.date },
    { status: 201 }
  );
}
