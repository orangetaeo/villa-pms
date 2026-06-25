import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingStatus, DepositStatus } from "@prisma/client";

// 실제 PrismaClient·외부 의존 차단 (checkin.test.ts 패턴)
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cleaning", () => ({
  createCheckoutCleaningTask: vi.fn(async () => ({ id: "ct1" })),
}));

import { completeCheckout, resolveDepositOutcome, CheckoutRejectedError } from "./checkout";
import { createCheckoutCleaningTask } from "./cleaning";
import { writeAuditLog } from "./audit-log";
import { POST as checkoutPost } from "../app/api/bookings/[id]/checkout/route";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));

// ===================== 순수층 =====================

describe("resolveDepositOutcome — 보증금 상태기계 (SPEC F4 체크아웃 3)", () => {
  it("파손 없음 → REFUNDED, 차감액 null", () => {
    expect(resolveDepositOutcome(false, null)).toEqual({
      depositStatus: DepositStatus.REFUNDED,
      deductionVnd: null,
    });
    expect(resolveDepositOutcome(false, undefined)).toEqual({
      depositStatus: DepositStatus.REFUNDED,
      deductionVnd: null,
    });
    // 0동 입력은 "차감 없음"과 동치 — 전액 환불로 정규화
    expect(resolveDepositOutcome(false, 0n)).toEqual({
      depositStatus: DepositStatus.REFUNDED,
      deductionVnd: null,
    });
  });

  it("파손 → PARTIAL_DEDUCTED + 차감액 보존 (VND BigInt)", () => {
    expect(resolveDepositOutcome(true, 1_500_000n)).toEqual({
      depositStatus: DepositStatus.PARTIAL_DEDUCTED,
      deductionVnd: 1_500_000n,
    });
  });

  it("파손인데 차감액 없음·0·음수 → 거부", () => {
    expect(() => resolveDepositOutcome(true, null)).toThrow(RangeError);
    expect(() => resolveDepositOutcome(true, undefined)).toThrow(RangeError);
    expect(() => resolveDepositOutcome(true, 0n)).toThrow(RangeError);
    expect(() => resolveDepositOutcome(true, -1n)).toThrow(RangeError);
  });

  it("파손 없는데 차감액 기록 시도 → 거부 (양수·음수 모두)", () => {
    expect(() => resolveDepositOutcome(false, 1_000_000n)).toThrow(RangeError);
    expect(() => resolveDepositOutcome(false, -1n)).toThrow(RangeError);
  });

  it("NONE(미수취): 상태 NONE 유지 — REFUNDED 둔갑 차단 (T3.3 핫픽스)", () => {
    expect(resolveDepositOutcome(false, null, DepositStatus.NONE)).toEqual({
      depositStatus: DepositStatus.NONE,
      deductionVnd: null,
    });
    // 파손 + 차감액 = 청구 근거 기록 허용, 상태는 여전히 NONE
    expect(resolveDepositOutcome(true, 1_500_000n, DepositStatus.NONE)).toEqual({
      depositStatus: DepositStatus.NONE,
      deductionVnd: 1_500_000n,
    });
    // 파손 + 차감액 생략도 허용 (차감할 보증금이 없음)
    expect(resolveDepositOutcome(true, null, DepositStatus.NONE)).toEqual({
      depositStatus: DepositStatus.NONE,
      deductionVnd: null,
    });
    // 무파손 차감·0 이하 청구는 거부
    expect(() => resolveDepositOutcome(false, 1n, DepositStatus.NONE)).toThrow(RangeError);
    expect(() => resolveDepositOutcome(true, 0n, DepositStatus.NONE)).toThrow(RangeError);
  });
});

// ===================== DB층 — mocked prisma (QA D1) =====================

function makeTxMock(opts: {
  booking?: { id: string; status: BookingStatus; depositStatus?: DepositStatus; villaId?: string } | null;
  transitionCount?: number;
  /** 미니바 품목 마스터(서버 스냅샷 조회 대상). 미지정 시 빈 세트. */
  minibarItems?: Array<{ id: string; nameKo: string; unitPriceVnd: bigint; costVnd: bigint | null }>;
}) {
  if (opts.booking && !opts.booking.depositStatus) {
    opts.booking.depositStatus = DepositStatus.HELD;
  }
  const items = opts.minibarItems ?? [];
  return {
    booking: {
      findUnique: vi.fn(async () => opts.booking ?? null),
      findUniqueOrThrow: vi.fn(async () => ({
        ...(opts.booking ?? {}),
        status: BookingStatus.CHECKED_OUT,
      })),
      updateMany: vi.fn(async () => ({ count: opts.transitionCount ?? 1 })),
    },
    checkOutRecord: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "cor1",
        ...args.data,
      })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "cor1",
        ...args.data,
      })),
      findUniqueOrThrow: vi.fn(async () => ({ id: "cor1" })),
    },
    minibarItem: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) =>
        items.filter((i) => args.where.id.in.includes(i.id))
      ),
    },
    checkoutMinibarLine: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "cml1",
        ...args.data,
      })),
    },
    minibarStockMovement: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "msm1",
        ...args.data,
      })),
    },
  };
}

function makePrismaMock(tx: ReturnType<typeof makeTxMock>) {
  return {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as never;
}

const NOW = new Date("2026-07-05T03:00:00.000Z");
const BASE_INPUT = {
  bookingId: "bk1",
  photoUrls: ["/uploads/photo1.jpg"],
  damageFound: false,
  actorUserId: "admin1",
  now: NOW,
};

describe("completeCheckout — 상태 가드·원자성 (계약 완료 기준)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("사진 0장 → 거부 (트랜잭션 진입 전)", async () => {
    await expect(
      completeCheckout(makePrismaMock(makeTxMock({})), { ...BASE_INPUT, photoUrls: [] })
    ).rejects.toThrow(RangeError);
  });

  it("파손=true인데 상세·증빙 모두 없음 → 거부", async () => {
    await expect(
      completeCheckout(makePrismaMock(makeTxMock({})), {
        ...BASE_INPUT,
        damageFound: true,
        deductionVnd: 1_000_000n,
      })
    ).rejects.toThrow(RangeError);
  });

  it("미존재 예약 → NOT_FOUND", async () => {
    const prisma = makePrismaMock(makeTxMock({ booking: null }));
    await expect(completeCheckout(prisma, BASE_INPUT)).rejects.toThrow(CheckoutRejectedError);
    await expect(completeCheckout(prisma, BASE_INPUT)).rejects.toMatchObject({
      reason: "NOT_FOUND",
    });
  });

  it.each([BookingStatus.HOLD, BookingStatus.CONFIRMED, BookingStatus.CANCELLED])(
    "CHECKED_IN 외 상태(%s) → NOT_CHECKED_IN 거부",
    async (status) => {
      const prisma = makePrismaMock(makeTxMock({ booking: { id: "bk1", status } }));
      await expect(completeCheckout(prisma, BASE_INPUT)).rejects.toMatchObject({
        reason: "NOT_CHECKED_IN",
      });
    }
  );

  it("이미 CHECKED_OUT → ALREADY_CHECKED_OUT", async () => {
    const prisma = makePrismaMock(
      makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_OUT } })
    );
    await expect(completeCheckout(prisma, BASE_INPUT)).rejects.toMatchObject({
      reason: "ALREADY_CHECKED_OUT",
    });
  });

  it("동시 체크아웃 경합(가드 count=0) → ALREADY_CHECKED_OUT, 레코드·청소 태스크 미생성", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN },
      transitionCount: 0,
    });
    await expect(completeCheckout(makePrismaMock(tx), BASE_INPUT)).rejects.toMatchObject({
      reason: "ALREADY_CHECKED_OUT",
    });
    expect(tx.checkOutRecord.create).not.toHaveBeenCalled();
    expect(createCheckoutCleaningTask).not.toHaveBeenCalled();
  });

  it("성공 경로: 같은 tx로 레코드 생성→청소 태스크(게이트 닫기)→AuditLog 순 원자 호출", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    const result = await completeCheckout(makePrismaMock(tx), BASE_INPUT);

    // 전액 환불 경로 — REFUNDED + 차감 null
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bk1", status: BookingStatus.CHECKED_IN },
        data: expect.objectContaining({
          status: BookingStatus.CHECKED_OUT,
          depositStatus: DepositStatus.REFUNDED,
          depositDeductVnd: null,
        }),
      })
    );
    // 청소 태스크가 동일 tx 객체로 호출 — 게이트 닫기 원자성
    expect(createCheckoutCleaningTask).toHaveBeenCalledWith(tx, {
      bookingId: "bk1",
      actorUserId: "admin1",
      now: NOW,
    });
    // AuditLog도 동일 tx + BigInt 문자열화
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ db: tx, entity: "Booking", entityId: "bk1" })
    );
    expect(result.record.id).toBe("cor1");
  });

  it("보증금 NONE 체크아웃: depositStatus NONE 유지 — REFUNDED 미기록 (핫픽스 증명)", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN, depositStatus: DepositStatus.NONE },
    });
    await completeCheckout(makePrismaMock(tx), BASE_INPUT);
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          depositStatus: DepositStatus.NONE,
          depositDeductVnd: null,
        }),
      })
    );
  });

  it("파손 경로: PARTIAL_DEDUCTED + 차감액 저장, REFUNDED 아님", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      damageFound: true,
      damageNote: "유리 테이블 파손",
      deductionVnd: 1_500_000n,
    });
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          depositStatus: DepositStatus.PARTIAL_DEDUCTED,
          depositDeductVnd: 1_500_000n,
        }),
      })
    );
  });

  it("파손 아님 직접 호출 시 파손 필드 정규화 — note·사진 잔존 차단 (QA D4)", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      damageFound: false,
      damageNote: "실수로 들어온 메모",
      damagePhotoUrls: ["/uploads/x.jpg"],
    });
    expect(tx.checkOutRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ damageNote: null, damagePhotoUrls: [] }),
      })
    );
  });

  // ── 미니바 판매 라인 캡처 (작업 B) ──────────────────────────────────
  it("미니바 라인 캡처: 서버가 MinibarItem 스냅샷으로 lineVnd 재계산(클라 가격 무시)", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN, villaId: "v1" },
      minibarItems: [
        { id: "mb_cola", nameKo: "콜라", unitPriceVnd: 30_000n, costVnd: 20_000n },
        { id: "mb_water", nameKo: "물", unitPriceVnd: 10_000n, costVnd: null },
      ],
    });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      minibarLines: [
        { minibarItemId: "mb_cola", consumedQty: 2, stockedQty: 0 },
        { minibarItemId: "mb_water", consumedQty: 1, stockedQty: 0 },
        { minibarItemId: "mb_cola", consumedQty: 0, stockedQty: 0 }, // 0은 무시
      ],
    });

    // 콜라 라인 — lineVnd = 2 × 30,000 = 60,000, lineCostVnd = 2 × 20,000 = 40,000 (스냅샷)
    expect(tx.checkoutMinibarLine.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checkOutRecordId: "cor1",
          minibarItemId: "mb_cola",
          nameKo: "콜라",
          consumedQty: 2,
          unitPriceVnd: 30_000n,
          costVnd: 20_000n,
          lineVnd: 60_000n,
          lineCostVnd: 40_000n,
        }),
      })
    );
    // 물 라인 — costVnd null → lineCostVnd null
    expect(tx.checkoutMinibarLine.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          minibarItemId: "mb_water",
          lineVnd: 10_000n,
          costVnd: null,
          lineCostVnd: null,
        }),
      })
    );
    // 0 소모는 라인 미생성 → 총 2회만
    expect(tx.checkoutMinibarLine.create).toHaveBeenCalledTimes(2);
    // 실재고 CONSUME 이동 — 소모분만큼 음수 delta, 출처 예약 보존 (ADR-0019 S1)
    expect(tx.minibarStockMovement.create).toHaveBeenCalledTimes(2);
    expect(tx.minibarStockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          villaId: "v1",
          minibarItemId: "mb_cola",
          type: "CONSUME",
          qtyDelta: -2,
          bookingId: "bk1",
        }),
      })
    );
    // minibarChargeVnd = ΣlineVnd = 70,000 비정규화 캐시 갱신
    expect(tx.checkOutRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cor1" },
        data: { minibarChargeVnd: 70_000n },
      })
    );
  });

  it("미니바 0건: 라인 미생성·minibarChargeVnd 미갱신", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await completeCheckout(makePrismaMock(tx), { ...BASE_INPUT, minibarLines: [] });
    expect(tx.checkoutMinibarLine.create).not.toHaveBeenCalled();
    expect(tx.checkOutRecord.update).not.toHaveBeenCalled();
  });

  it("알 수 없는 itemId → RangeError(서버 거부)", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN },
      minibarItems: [{ id: "mb_cola", nameKo: "콜라", unitPriceVnd: 30_000n, costVnd: null }],
    });
    await expect(
      completeCheckout(makePrismaMock(tx), {
        ...BASE_INPUT,
        minibarLines: [{ minibarItemId: "mb_ghost", consumedQty: 1, stockedQty: 0 }],
      })
    ).rejects.toThrow(RangeError);
  });
});

// ===================== route — 401/403/404/409/400 (QA D1) =====================

async function setupRoutePrisma(tx: ReturnType<typeof makeTxMock>) {
  const { prisma } = await import("@/lib/prisma");
  (prisma as unknown as Record<string, unknown>).$transaction = async (
    fn: (t: unknown) => Promise<unknown>
  ) => fn(tx);
}

const VALID_BODY = { photoUrls: ["/uploads/a.jpg"], damageFound: false };

const callCheckout = (body: unknown) =>
  checkoutPost(
    new Request("http://local/api/bookings/bk1/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "bk1" }) }
  );

describe("POST /api/bookings/[id]/checkout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("비로그인 401 / SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await callCheckout(VALID_BODY)).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await callCheckout(VALID_BODY)).status).toBe(403);
  });

  it("zod 검증: 사진 0장·차감액 비숫자 → 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    expect((await callCheckout({ ...VALID_BODY, photoUrls: [] })).status).toBe(400);
    expect(
      (await callCheckout({ ...VALID_BODY, damageFound: true, deductionVnd: "1.5e6" })).status
    ).toBe(400);
  });

  it("미존재 예약 → 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(makeTxMock({ booking: null }));
    expect((await callCheckout(VALID_BODY)).status).toBe(404);
  });

  it("CHECKED_IN 아님 → 409", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(
      makeTxMock({ booking: { id: "bk1", status: BookingStatus.CONFIRMED } })
    );
    expect((await callCheckout(VALID_BODY)).status).toBe(409);
  });

  it("성공 → 200 + serializeBigInt 응답", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(
      makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } })
    );
    const res = await callCheckout({
      photoUrls: ["/uploads/a.jpg"],
      damageFound: true,
      damageNote: "테이블 파손",
      deductionVnd: "1500000",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // BigInt 차감액이 문자열로 직렬화
    expect(data.record.deductionVnd).toBe("1500000");
  });
});
