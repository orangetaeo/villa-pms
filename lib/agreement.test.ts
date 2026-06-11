import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingStatus } from "@prisma/client";

// 실제 PrismaClient·외부 의존 차단 (checkin.test.ts 패턴)
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { signAgreement, PRIVATE_EVIDENCE_PATH } from "./checkin";
import { POST as agreementPost } from "../app/api/bookings/[id]/agreement/route";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));

// 실제 파이프라인 형식: sig-<timestamp>-<uploader>-<uuid>.<ext> (storage buildFileName + sig- 접두)
const SIG = "/api/passports/sig-1760000000000-admin1-0a1b2c3d-e4f5-6789-abcd-ef0123456789.png";

// ===================== 순수층 =====================

describe("PRIVATE_EVIDENCE_PATH — 서명 비공개 경로 강제 (T3.1 조건 A 정합)", () => {
  it("비공개 증빙 경로만 허용", () => {
    expect(PRIVATE_EVIDENCE_PATH.test(SIG)).toBe(true);
  });

  it("공개 /uploads·외부 URL·경로 탈출 거부", () => {
    for (const bad of [
      "/uploads/sig.png",
      "https://evil.example/sig.png",
      "/api/passports/../secret",
      "/api/passports/a/b.png",
    ]) {
      expect(PRIVATE_EVIDENCE_PATH.test(bad)).toBe(false);
    }
  });
});

// ===================== signAgreement (mocked tx) =====================

function makeTxMock(opts: {
  booking?: {
    id: string;
    status: BookingStatus;
    checkInRecord: { id: string; signatureUrl: string | null } | null;
  } | null;
  guardCount?: number;
}) {
  return {
    booking: { findUnique: vi.fn(async () => opts.booking ?? null) },
    checkInRecord: {
      updateMany: vi.fn(async () => ({ count: opts.guardCount ?? 1 })),
      findUniqueOrThrow: vi.fn(async () => ({
        id: "cir1",
        bookingId: "bk1",
        agreementSignedAt: new Date(),
      })),
    },
  };
}
const makePrisma = (tx: ReturnType<typeof makeTxMock>) =>
  ({ $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) }) as never;

const NOW = new Date("2026-07-05T05:00:00.000Z");
const INPUT = { bookingId: "bk1", signatureUrl: SIG, actorUserId: "admin1", now: NOW };

describe("signAgreement — 사후 서명 (계약 결정 2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("공개 경로 서명은 트랜잭션 진입 전 거부", async () => {
    await expect(
      signAgreement(makePrisma(makeTxMock({})), { ...INPUT, signatureUrl: "/uploads/sig.png" })
    ).rejects.toThrow(RangeError);
  });

  it("미존재 예약 → NOT_FOUND", async () => {
    await expect(
      signAgreement(makePrisma(makeTxMock({ booking: null })), INPUT)
    ).rejects.toMatchObject({ reason: "NOT_FOUND" });
  });

  it.each([BookingStatus.CONFIRMED, BookingStatus.CHECKED_OUT, BookingStatus.CANCELLED])(
    "CHECKED_IN 외 상태(%s) → INVALID_STATUS",
    async (status) => {
      const tx = makeTxMock({
        booking: { id: "bk1", status, checkInRecord: { id: "cir1", signatureUrl: null } },
      });
      await expect(signAgreement(makePrisma(tx), INPUT)).rejects.toMatchObject({
        reason: "INVALID_STATUS",
      });
    }
  );

  it("체크인 기록 없음 → NO_CHECKIN_RECORD", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN, checkInRecord: null },
    });
    await expect(signAgreement(makePrisma(tx), INPUT)).rejects.toMatchObject({
      reason: "NO_CHECKIN_RECORD",
    });
  });

  it("이미 서명됨 → ALREADY_SIGNED", async () => {
    const tx = makeTxMock({
      booking: {
        id: "bk1",
        status: BookingStatus.CHECKED_IN,
        checkInRecord: { id: "cir1", signatureUrl: "/api/passports/sig-old.png" },
      },
    });
    await expect(signAgreement(makePrisma(tx), INPUT)).rejects.toMatchObject({
      reason: "ALREADY_SIGNED",
    });
  });

  it("동시 서명 경합(가드 count=0) → ALREADY_SIGNED", async () => {
    const tx = makeTxMock({
      booking: {
        id: "bk1",
        status: BookingStatus.CHECKED_IN,
        checkInRecord: { id: "cir1", signatureUrl: null },
      },
      guardCount: 0,
    });
    await expect(signAgreement(makePrisma(tx), INPUT)).rejects.toMatchObject({
      reason: "ALREADY_SIGNED",
    });
  });

  it("성공: 미서명 가드 where + agreementSignedAt 기록", async () => {
    const tx = makeTxMock({
      booking: {
        id: "bk1",
        status: BookingStatus.CHECKED_IN,
        checkInRecord: { id: "cir1", signatureUrl: null },
      },
    });
    const record = await signAgreement(makePrisma(tx), INPUT);
    expect(tx.checkInRecord.updateMany).toHaveBeenCalledWith({
      where: { id: "cir1", signatureUrl: null },
      data: { signatureUrl: SIG, agreementSignedAt: NOW },
    });
    expect(record.id).toBe("cir1");
  });
});

// ===================== route =====================

async function setupRoutePrisma(tx: ReturnType<typeof makeTxMock>) {
  const { prisma } = await import("@/lib/prisma");
  (prisma as unknown as Record<string, unknown>).$transaction = async (
    fn: (t: unknown) => Promise<unknown>
  ) => fn(tx);
}

const callAgreement = (body: unknown) =>
  agreementPost(
    new Request("http://local/api/bookings/bk1/agreement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "bk1" }) }
  );

describe("POST /api/bookings/[id]/agreement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await callAgreement({ signatureUrl: SIG })).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await callAgreement({ signatureUrl: SIG })).status).toBe(403);
  });

  it("공개 경로·외부 URL → zod 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    for (const bad of ["/uploads/sig.png", "https://evil.example/s.png"]) {
      expect((await callAgreement({ signatureUrl: bad })).status).toBe(400);
    }
  });

  it("미존재 404 / 이미 서명 409", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(makeTxMock({ booking: null }));
    expect((await callAgreement({ signatureUrl: SIG })).status).toBe(404);

    await setupRoutePrisma(
      makeTxMock({
        booking: {
          id: "bk1",
          status: BookingStatus.CHECKED_IN,
          checkInRecord: { id: "cir1", signatureUrl: "/api/passports/sig-old.png" },
        },
      })
    );
    expect((await callAgreement({ signatureUrl: SIG })).status).toBe(409);
  });

  it("성공 200", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(
      makeTxMock({
        booking: {
          id: "bk1",
          status: BookingStatus.CHECKED_IN,
          checkInRecord: { id: "cir1", signatureUrl: null },
        },
      })
    );
    const res = await callAgreement({ signatureUrl: SIG });
    expect(res.status).toBe(200);
  });
});
