import { beforeEach, describe, expect, it, vi } from "vitest";

// 실제 PrismaClient·audit·zalo 큐 생성 차단 (T1.6·T3.1 패턴)
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
const enqueueNotification = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("@/lib/zalo", () => ({ enqueueNotification: (...a: unknown[]) => enqueueNotification(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { writeAuditLog } from "@/lib/audit-log";
import { POST as tamtruPost } from "../app/api/bookings/[id]/tamtru/route";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));

// ===================== tx mock =====================

interface BookingShape {
  id: string;
  guestName: string;
  checkIn: Date;
  checkInRecord: null | { id: string; passportPhotoUrls: string[] };
  villa: { name: string; supplierId: string; supplier: { zaloUserId: string | null } };
}

function makeTxMock(booking: BookingShape | null) {
  const tx = {
    booking: { findUnique: vi.fn(async () => booking) },
    checkInRecord: { update: vi.fn(async () => ({})) },
  };
  return tx;
}

async function setupPrismaTx(tx: ReturnType<typeof makeTxMock>) {
  const { prisma } = await import("@/lib/prisma");
  (prisma as unknown as Record<string, unknown>).$transaction = async (
    fn: (t: unknown) => Promise<unknown>
  ) => fn(tx);
}

const VILLA = {
  name: "쏘나씨 V12",
  supplierId: "sup1",
  supplier: { zaloUserId: "zalo-sup1" },
};

const linkedBooking = (over: Partial<BookingShape> = {}): BookingShape => ({
  id: "bk1",
  guestName: "KIM MINSU",
  checkIn: new Date("2026-07-01T00:00:00.000Z"),
  checkInRecord: { id: "cir1", passportPhotoUrls: ["/api/passports/p1.jpg"] },
  villa: VILLA,
  ...over,
});

const callTamtru = () =>
  tamtruPost(new Request("http://local/api/bookings/bk1/tamtru", { method: "POST" }), {
    params: Promise.resolve({ id: "bk1" }),
  });

describe("POST /api/bookings/[id]/tamtru (T3.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await callTamtru()).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await callTamtru()).status).toBe(403);
  });

  it("미존재 예약 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupPrismaTx(makeTxMock(null));
    expect((await callTamtru()).status).toBe(404);
  });

  it("체크인 기록 없음 → 400 (NO_CHECKIN)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupPrismaTx(makeTxMock(linkedBooking({ checkInRecord: null })));
    const res = await callTamtru();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("NO_CHECKIN");
  });

  it("여권 사진 없음 → 400 (NO_PASSPORT)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupPrismaTx(
      makeTxMock(linkedBooking({ checkInRecord: { id: "cir1", passportPhotoUrls: [] } }))
    );
    const res = await callTamtru();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("NO_PASSPORT");
  });

  it("성공: TAMTRU 큐잉 + tamTruSentAt 갱신 + AuditLog, supplierLinked true", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const tx = makeTxMock(linkedBooking());
    await setupPrismaTx(tx);
    const res = await callTamtru();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.supplierLinked).toBe(true);
    expect(typeof json.tamTruSentAt).toBe("string");

    // 공급자 대상 TAMTRU_PASSPORT 큐잉
    const enq = enqueueNotification.mock.calls[0]![0] as {
      userId: string;
      type: string;
      payload: Record<string, unknown>;
    };
    expect(enq.userId).toBe("sup1");
    expect(enq.type).toBe("TAMTRU_PASSPORT");
    expect(enq.payload.villaName).toBe("쏘나씨 V12");
    expect(enq.payload.guestName).toBe("KIM MINSU");
    expect(enq.payload.checkIn).toBe("2026-07-01"); // @db.Date → 날짜만
    expect(enq.payload.passportPhotoUrls).toEqual(["/api/passports/p1.jpg"]);

    // tamTruSentAt 갱신
    expect(tx.checkInRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cir1" },
        data: expect.objectContaining({ tamTruSentAt: expect.any(Date) }),
      })
    );
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalled();
  });

  it("재전달 허용 — 이미 전달된 기록도 200 + tamTruSentAt 재갱신 (멱등 대체 아님)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const tx = makeTxMock(linkedBooking());
    await setupPrismaTx(tx);
    expect((await callTamtru()).status).toBe(200);
    expect((await callTamtru()).status).toBe(200);
    expect(tx.checkInRecord.update).toHaveBeenCalledTimes(2);
    expect(enqueueNotification).toHaveBeenCalledTimes(2);
  });

  it("공급자 Zalo 미연결 — enqueue는 진행, supplierLinked false 경고", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const tx = makeTxMock(
      linkedBooking({ villa: { ...VILLA, supplier: { zaloUserId: null } } })
    );
    await setupPrismaTx(tx);
    const res = await callTamtru();
    expect(res.status).toBe(200);
    expect((await res.json()).supplierLinked).toBe(false);
    expect(enqueueNotification).toHaveBeenCalledTimes(1); // 미연결이어도 큐잉
  });

  it("payload 오염 차단 — 마진·판매가·고객 연락처 미포함 (빌더 화이트리스트 정합)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const tx = makeTxMock(linkedBooking());
    await setupPrismaTx(tx);
    await callTamtru();
    const payload = (enqueueNotification.mock.calls[0]![0] as { payload: Record<string, unknown> })
      .payload;
    const keys = Object.keys(payload);
    expect(keys).toEqual(["villaName", "guestName", "checkIn", "passportPhotoUrls"]);
    expect(JSON.stringify(payload)).not.toMatch(/margin|salePrice|krw|guestPhone|cost/i);
  });
});
