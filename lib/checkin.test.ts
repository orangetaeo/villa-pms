import { beforeEach, describe, expect, it, vi } from "vitest";
import { Currency } from "@prisma/client";

// 실제 PrismaClient 생성 차단 (T1.6 패턴)
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { assertCheckInInput } from "@/lib/checkin";
import { writeAuditLog } from "@/lib/audit-log";
import { POST as checkinPost } from "../app/api/bookings/[id]/checkin/route";
import { POST as ocrPost } from "../app/api/ocr/passport/route";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));

// ===================== 순수층 =====================

describe("assertCheckInInput (계약 완료 기준)", () => {
  const url = "/api/passports/a.jpg";

  it("여권 0장 → 거부", () => {
    expect(() =>
      assertCheckInInput({ passportPhotoUrls: [], deposit: null })
    ).toThrow(RangeError);
  });

  it("보증금 미수취(null) 허용", () => {
    expect(() =>
      assertCheckInInput({ passportPhotoUrls: [url], deposit: null })
    ).not.toThrow();
  });

  it("보증금 0·음수·소수·Int 초과 거부 (QA 권고 3 — 오버플로 방어)", () => {
    for (const amount of [0, -1, 1.5, 2_147_483_648]) {
      expect(() =>
        assertCheckInInput({
          passportPhotoUrls: [url],
          deposit: { amount, currency: Currency.VND },
        })
      ).toThrow(RangeError);
    }
  });

  it("정상 보증금(KRW/VND/USD) 통과", () => {
    for (const currency of [Currency.KRW, Currency.VND, Currency.USD]) {
      expect(() =>
        assertCheckInInput({
          passportPhotoUrls: [url],
          deposit: { amount: 500_000, currency },
        })
      ).not.toThrow();
    }
  });
});

// ===================== checkin API (mock) =====================

function makeTxMock(opts: {
  booking?: { id: string; status: string; depositStatus: string; checkInRecord: null | { id: string } } | null;
  transitionCount?: number;
}) {
  const tx = {
    booking: {
      findUnique: vi.fn(async () => opts.booking ?? null),
      updateMany: vi.fn(
        async (_args: { where: unknown; data: Record<string, unknown> }) => ({
          count: opts.transitionCount ?? 1,
        })
      ),
    },
    checkInRecord: {
      create: vi.fn(async () => ({ id: "cir1", bookingId: "bk1", createdAt: new Date() })),
    },
  };
  return tx;
}

async function setupPrismaTx(tx: ReturnType<typeof makeTxMock>) {
  const { prisma } = await import("@/lib/prisma");
  (prisma as unknown as Record<string, unknown>).$transaction = async (
    fn: (t: unknown) => Promise<unknown>
  ) => fn(tx);
}

const VALID_BODY = {
  passportPhotoUrls: ["/api/passports/123-admin-abc.jpg"],
  passportData: [{ surname: "KIM", givenNames: "MINSU", passportNo: "M1234567" }],
  deposit: { amount: 5_000_000, currency: "VND" },
};

const callCheckin = (body: unknown) =>
  checkinPost(
    new Request("http://local/api/bookings/bk1/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "bk1" }) }
  );

describe("POST /api/bookings/[id]/checkin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await callCheckin(VALID_BODY)).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await callCheckin(VALID_BODY)).status).toBe(403);
  });

  it("공개 /uploads 경로·외부 URL은 zod에서 거부 (비공개 파이프라인 강제 — 조건 A)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    for (const bad of ["/uploads/a.jpg", "https://evil.example/p.jpg", "../etc/passwd"]) {
      const res = await callCheckin({ ...VALID_BODY, passportPhotoUrls: [bad] });
      expect(res.status).toBe(400);
    }
  });

  it("미존재 예약 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupPrismaTx(makeTxMock({ booking: null }));
    expect((await callCheckin(VALID_BODY)).status).toBe(404);
  });

  it("CONFIRMED 아님(HOLD 등) → 409", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupPrismaTx(
      makeTxMock({
        booking: { id: "bk1", status: "HOLD", depositStatus: "NONE", checkInRecord: null },
        transitionCount: 0,
      })
    );
    expect((await callCheckin(VALID_BODY)).status).toBe(409);
  });

  it("이미 체크인 기록 존재 → 409", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupPrismaTx(
      makeTxMock({
        booking: {
          id: "bk1",
          status: "CHECKED_IN",
          depositStatus: "HELD",
          checkInRecord: { id: "cir0" },
        },
      })
    );
    expect((await callCheckin(VALID_BODY)).status).toBe(409);
  });

  it("성공: CHECKED_IN 전이 + CheckInRecord + 보증금 HELD + AuditLog(개인정보 미포함)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const tx = makeTxMock({
      booking: { id: "bk1", status: "CONFIRMED", depositStatus: "NONE", checkInRecord: null },
    });
    await setupPrismaTx(tx);
    const res = await callCheckin(VALID_BODY);
    expect(res.status).toBe(200);

    // 전이: status 가드 updateMany
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bk1", status: "CONFIRMED" },
        data: expect.objectContaining({
          status: "CHECKED_IN",
          depositAmount: 5_000_000,
          depositCurrency: "VND",
          depositStatus: "HELD",
        }),
      })
    );
    // CheckInRecord
    expect(tx.checkInRecord.create).toHaveBeenCalled();
    // AuditLog — 여권 데이터(이름·번호)는 미포함, 장수만
    const audit = vi.mocked(writeAuditLog).mock.calls[0][0];
    expect(audit.entity).toBe("Booking");
    const changesJson = JSON.stringify(audit.changes);
    expect(changesJson).not.toContain("M1234567");
    expect(changesJson).not.toContain("MINSU");
    expect(audit.changes).toHaveProperty("passportPhotoCount");
  });

  it("보증금 미수취(null): deposit 필드 미변경", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const tx = makeTxMock({
      booking: { id: "bk1", status: "CONFIRMED", depositStatus: "NONE", checkInRecord: null },
    });
    await setupPrismaTx(tx);
    const res = await callCheckin({ ...VALID_BODY, deposit: null });
    expect(res.status).toBe(200);
    const data = tx.booking.updateMany.mock.calls[0][0].data;
    expect(data).toEqual({ status: "CHECKED_IN" });
  });
});

// ===================== ocr API (mock) =====================

describe("POST /api/ocr/passport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  it("비로그인 401 / SUPPLIER 403", async () => {
    const body = JSON.stringify({ imageBase64: "aGk=", mimeType: "image/jpeg" });
    mockAuth.mockResolvedValue(null);
    let res = await ocrPost(
      new Request("http://local/api/ocr/passport", { method: "POST", body })
    );
    expect(res.status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    res = await ocrPost(new Request("http://local/api/ocr/passport", { method: "POST", body }));
    expect(res.status).toBe(403);
  });

  it("mime 화이트리스트 밖(svg 등) 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await ocrPost(
      new Request("http://local/api/ocr/passport", {
        method: "POST",
        body: JSON.stringify({ imageBase64: "aGk=", mimeType: "image/svg+xml" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("GEMINI_API_KEY 미설정 → 503 ocr_not_configured (수동 입력 폴백 신호)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await ocrPost(
      new Request("http://local/api/ocr/passport", {
        method: "POST",
        body: JSON.stringify({ imageBase64: "aGk=", mimeType: "image/jpeg" }),
      })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ocr_not_configured" });
  });
});
