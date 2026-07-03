// 파트너 예약 요청(취소·변경·홀드연장) 코어 테스트 (T-partner-workflow-gaps ②)
import { describe, expect, it, vi } from "vitest";
import { BookingStatus, type PrismaClient } from "@prisma/client";
import {
  ChangeRequestError,
  allowedStatusesFor,
  createChangeRequest,
  resolveChangeRequest,
} from "./booking-change-request";

describe("allowedStatusesFor", () => {
  it("CANCEL=HOLD/CONFIRMED, MODIFY=+CHECKED_IN, HOLD_EXTEND=HOLD만", () => {
    expect(allowedStatusesFor("CANCEL")).toEqual([BookingStatus.HOLD, BookingStatus.CONFIRMED]);
    expect(allowedStatusesFor("MODIFY")).toContain(BookingStatus.CHECKED_IN);
    expect(allowedStatusesFor("HOLD_EXTEND")).toEqual([BookingStatus.HOLD]);
  });
});

// 최소 fake db — 호출 형태만 검증(markOverdueReceivables 테스트와 동일 접근)
function fakeDbForCreate(o: {
  booking: { id: string; status: BookingStatus } | null;
  pendingExists?: boolean;
}) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "req1",
    kind: data.kind,
    status: "PENDING",
    createdAt: new Date("2026-07-03T00:00:00Z"),
  }));
  return {
    db: {
      booking: {
        findFirst: vi.fn(async () =>
          o.booking
            ? {
                id: o.booking.id,
                status: o.booking.status,
                checkIn: new Date("2026-08-01T00:00:00Z"),
                checkOut: new Date("2026-08-05T00:00:00Z"),
                villa: { name: "쏘나씨 V12" },
              }
            : null
        ),
      },
      bookingChangeRequest: {
        findFirst: vi.fn(async () => (o.pendingExists ? { id: "old" } : null)),
        create,
      },
    } as unknown as PrismaClient,
    create,
  };
}

describe("createChangeRequest", () => {
  it("본인 예약 아님(where에 partnerId 포함) → NOT_FOUND", async () => {
    const { db } = fakeDbForCreate({ booking: null });
    await expect(
      createChangeRequest(db, { partnerId: "p1", bookingId: "bX", kind: "CANCEL" })
    ).rejects.toMatchObject({ reason: "NOT_FOUND" });
    const findFirst = (db.booking.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(findFirst.where).toMatchObject({ id: "bX", partnerId: "p1" }); // IDOR 스코프 강제
  });

  it("상태 가드 — CHECKED_OUT 예약에 CANCEL 요청 → INVALID_STATUS", async () => {
    const { db } = fakeDbForCreate({
      booking: { id: "b1", status: BookingStatus.CHECKED_OUT },
    });
    await expect(
      createChangeRequest(db, { partnerId: "p1", bookingId: "b1", kind: "CANCEL" })
    ).rejects.toMatchObject({ reason: "INVALID_STATUS" });
  });

  it("미해결 PENDING 존재 → DUPLICATE", async () => {
    const { db } = fakeDbForCreate({
      booking: { id: "b1", status: BookingStatus.HOLD },
      pendingExists: true,
    });
    await expect(
      createChangeRequest(db, { partnerId: "p1", bookingId: "b1", kind: "CANCEL" })
    ).rejects.toMatchObject({ reason: "DUPLICATE" });
  });

  it("정상 생성 — note trim·빈 문자열은 null", async () => {
    const { db, create } = fakeDbForCreate({
      booking: { id: "b1", status: BookingStatus.HOLD },
    });
    const r = await createChangeRequest(db, {
      partnerId: "p1",
      bookingId: "b1",
      kind: "HOLD_EXTEND",
      note: "   ",
    });
    expect(r.status).toBe("PENDING");
    expect(r.villaName).toBe("쏘나씨 V12");
    expect(create.mock.calls[0][0].data).toMatchObject({
      bookingId: "b1",
      partnerId: "p1",
      kind: "HOLD_EXTEND",
      note: null,
    });
  });
});

// resolve용 fake — $transaction이 같은 fake를 tx로 넘긴다
function fakeDbForResolve(o: {
  request: {
    kind: string;
    status: string;
    bookingStatus: BookingStatus;
    holdExpiresAt?: Date | null;
  } | null;
  bookingUpdateCount?: number;
  requestUpdateCount?: number;
}) {
  const bookingUpdateMany = vi.fn(
    async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
      count: o.bookingUpdateCount ?? 1,
    })
  );
  const requestUpdateMany = vi.fn(
    async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
      count: o.requestUpdateCount ?? 1,
    })
  );
  const tx = {
    bookingChangeRequest: {
      findUnique: vi.fn(async () =>
        o.request
          ? {
              id: "req1",
              kind: o.request.kind,
              status: o.request.status,
              note: "메모",
              bookingId: "b1",
              partnerId: "p1",
              booking: {
                status: o.request.bookingStatus,
                holdExpiresAt: o.request.holdExpiresAt ?? null,
                villa: { name: "쏘나씨 V12" },
              },
            }
          : null
      ),
      updateMany: requestUpdateMany,
    },
    booking: { updateMany: bookingUpdateMany },
  };
  const db = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaClient;
  return { db, bookingUpdateMany, requestUpdateMany };
}

describe("resolveChangeRequest", () => {
  it("이미 처리된 요청 → ALREADY_RESOLVED", async () => {
    const { db } = fakeDbForResolve({
      request: { kind: "CANCEL", status: "APPROVED", bookingStatus: BookingStatus.CANCELLED },
    });
    await expect(
      resolveChangeRequest(db, { requestId: "req1", actorUserId: "u1", action: "REJECT" })
    ).rejects.toMatchObject({ reason: "ALREADY_RESOLVED" });
  });

  it("거절 — 예약 무변경, 요청만 REJECTED", async () => {
    const { db, bookingUpdateMany, requestUpdateMany } = fakeDbForResolve({
      request: { kind: "MODIFY", status: "PENDING", bookingStatus: BookingStatus.CONFIRMED },
    });
    const r = await resolveChangeRequest(db, {
      requestId: "req1",
      actorUserId: "u1",
      action: "REJECT",
      resolutionNote: "불가",
    });
    expect(r.status).toBe("REJECTED");
    expect(bookingUpdateMany).not.toHaveBeenCalled(); // 예약 비접촉
    expect(requestUpdateMany.mock.calls[0][0].where).toMatchObject({
      id: "req1",
      status: "PENDING", // 동시 처리 가드
    });
  });

  it("HOLD_EXTEND 승인 — HOLD 아닌 예약이면 INVALID_STATUS(만료 전이 후)", async () => {
    const { db } = fakeDbForResolve({
      request: { kind: "HOLD_EXTEND", status: "PENDING", bookingStatus: BookingStatus.EXPIRED },
    });
    await expect(
      resolveChangeRequest(db, { requestId: "req1", actorUserId: "u1", action: "APPROVE" })
    ).rejects.toMatchObject({ reason: "INVALID_STATUS" });
  });

  it("HOLD_EXTEND 승인 — 기존 만료시각(미래) 기준으로 시간 연장 + status:HOLD 가드", async () => {
    const future = new Date(Date.now() + 2 * 3_600_000); // 2h 남음
    const { db, bookingUpdateMany } = fakeDbForResolve({
      request: {
        kind: "HOLD_EXTEND",
        status: "PENDING",
        bookingStatus: BookingStatus.HOLD,
        holdExpiresAt: future,
      },
    });
    const r = await resolveChangeRequest(db, {
      requestId: "req1",
      actorUserId: "u1",
      action: "APPROVE",
      extendHours: 24,
    });
    expect(r.status).toBe("APPROVED");
    expect(r.newHoldExpiresAt!.getTime()).toBe(future.getTime() + 24 * 3_600_000);
    expect(bookingUpdateMany.mock.calls[0][0].where).toMatchObject({
      id: "b1",
      status: BookingStatus.HOLD, // 만료 cron·동시 확정과 경합 가드
    });
  });

  it("HOLD_EXTEND 승인 — 동시 만료 경합(updateMany 0건)이면 INVALID_STATUS", async () => {
    const { db } = fakeDbForResolve({
      request: {
        kind: "HOLD_EXTEND",
        status: "PENDING",
        bookingStatus: BookingStatus.HOLD,
        holdExpiresAt: new Date(),
      },
      bookingUpdateCount: 0,
    });
    await expect(
      resolveChangeRequest(db, { requestId: "req1", actorUserId: "u1", action: "APPROVE" })
    ).rejects.toMatchObject({ reason: "INVALID_STATUS" });
  });

  it("extendHours 클램프 — 100h 요청도 72h 상한", async () => {
    const base = new Date(Date.now() + 3_600_000);
    const { db } = fakeDbForResolve({
      request: {
        kind: "HOLD_EXTEND",
        status: "PENDING",
        bookingStatus: BookingStatus.HOLD,
        holdExpiresAt: base,
      },
    });
    const r = await resolveChangeRequest(db, {
      requestId: "req1",
      actorUserId: "u1",
      action: "APPROVE",
      extendHours: 100,
    });
    expect(r.newHoldExpiresAt!.getTime()).toBe(base.getTime() + 72 * 3_600_000);
  });

  it("에러 타입 — ChangeRequestError 인스턴스", async () => {
    const { db } = fakeDbForResolve({ request: null });
    await expect(
      resolveChangeRequest(db, { requestId: "nope", actorUserId: "u1", action: "REJECT" })
    ).rejects.toBeInstanceOf(ChangeRequestError);
  });
});
