import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingStatus, DepositStatus } from "@prisma/client";

// 실제 PrismaClient·외부 의존 차단 (checkin.test.ts 패턴)
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cleaning", () => ({
  createCheckoutCleaningTask: vi.fn(async () => ({ id: "ct1" })),
}));
// 환율 스냅샷 — 실수납 금액이 있을 때 라우트가 조회. DB 접근 없이 고정값 반환.
vi.mock("@/lib/fx-rates", () => ({
  getDailyRates: vi.fn(async () => ({
    date: "2026-07-05",
    vndPerUnit: { KRW: 19, USD: 25_000 },
  })),
}));

import {
  completeCheckout,
  resolveDepositOutcome,
  CheckoutRejectedError,
  DepositOffsetError,
} from "./checkout";
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

  // ── 보증금 상계(depositOffsetVnd, ADR-0041) ──────────────────────────────
  it("HELD 무파손 + 상계>0 → PARTIAL_DEDUCTED, deductionVnd=상계액", () => {
    expect(resolveDepositOutcome(false, null, DepositStatus.HELD, 2_000_000n)).toEqual({
      depositStatus: DepositStatus.PARTIAL_DEDUCTED,
      deductionVnd: 2_000_000n,
    });
  });

  it("HELD 파손 + 상계 → deductionVnd=파손+상계 합", () => {
    expect(resolveDepositOutcome(true, 1_500_000n, DepositStatus.HELD, 2_000_000n)).toEqual({
      depositStatus: DepositStatus.PARTIAL_DEDUCTED,
      deductionVnd: 3_500_000n,
    });
  });

  it("HELD 무파손 + 상계 0 → REFUNDED", () => {
    expect(resolveDepositOutcome(false, null, DepositStatus.HELD, 0n)).toEqual({
      depositStatus: DepositStatus.REFUNDED,
      deductionVnd: null,
    });
  });

  it("NONE + 상계>0 → DepositOffsetError(DEPOSIT_NOT_HELD)", () => {
    expect(() =>
      resolveDepositOutcome(false, null, DepositStatus.NONE, 1_000_000n)
    ).toThrow(DepositOffsetError);
    try {
      resolveDepositOutcome(false, null, DepositStatus.NONE, 1_000_000n);
    } catch (e) {
      expect((e as DepositOffsetError).code).toBe("DEPOSIT_NOT_HELD");
    }
  });
});

// ===================== DB층 — mocked prisma (QA D1) =====================

function makeTxMock(opts: {
  booking?: {
    id: string;
    status: BookingStatus;
    depositStatus?: DepositStatus;
    depositAmount?: number | null;
    depositCurrency?: "VND" | "KRW" | "USD" | null;
    villaId?: string;
    checkOut?: Date;
    seller?: "OPERATOR" | "SUPPLIER";
  } | null;
  transitionCount?: number;
  /** 미니바 품목 마스터(서버 스냅샷 조회 대상). 미지정 시 빈 세트. */
  minibarItems?: Array<{ id: string; nameKo: string; unitPriceVnd: bigint; costVnd: bigint | null }>;
  /** 확정 부가옵션(게스트 청구 합산 대상). 미지정 시 빈 세트. */
  serviceOrders?: Array<{ priceKrw: number | null; priceVnd: bigint | null }>;
  /** 다음 예약(전환 회수 판정). null=없음, 미지정 시 없음. */
  nextBooking?: { seller: "OPERATOR" | "SUPPLIER" } | null;
  /**
   * 전환 회수 시 빌라 미니바 현재고 집계(groupBy 응답). 미지정 시 빈 세트.
   *   방금 CONSUME 반영 후의 onHand를 직접 지정한다(테스트 단순화).
   */
  onHandByItem?: Array<{ minibarItemId: string; onHand: number }>;
}) {
  if (opts.booking && !opts.booking.depositStatus) {
    opts.booking.depositStatus = DepositStatus.HELD;
  }
  const items = opts.minibarItems ?? [];
  let recordState: Record<string, unknown> = { id: "cor1" };
  return {
    booking: {
      findUnique: vi.fn(async () => opts.booking ?? null),
      findFirst: vi.fn(async () => opts.nextBooking ?? null),
      findUniqueOrThrow: vi.fn(async () => ({
        ...(opts.booking ?? {}),
        status: BookingStatus.CHECKED_OUT,
      })),
      updateMany: vi.fn(async () => ({ count: opts.transitionCount ?? 1 })),
    },
    checkOutRecord: {
      // 누적 상태 추적 — create→update(minibar·게스트청구)→findUniqueOrThrow 재조회가 현실적으로 동작
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        recordState = { id: "cor1", ...args.data };
        return recordState;
      }),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        recordState = { ...recordState, ...args.data };
        return recordState;
      }),
      findUniqueOrThrow: vi.fn(async () => recordState),
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
    checkoutSettlementLine: {
      createMany: vi.fn(async (args: { data: Record<string, unknown>[] }) => ({
        count: args.data.length,
      })),
    },
    minibarStockMovement: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "msm1",
        ...args.data,
      })),
      groupBy: vi.fn(async () =>
        (opts.onHandByItem ?? []).map((r) => ({
          minibarItemId: r.minibarItemId,
          _sum: { qtyDelta: r.onHand },
        }))
      ),
    },
    serviceOrder: {
      findMany: vi.fn(async () => opts.serviceOrders ?? []),
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

  it("사진 미전송(정책 변경 2026-07-10)도 성공 — record.photoUrls는 빈 배열", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    const input = { ...BASE_INPUT };
    delete (input as { photoUrls?: string[] }).photoUrls;
    const result = await completeCheckout(makePrismaMock(tx), input);
    expect(tx.checkOutRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ photoUrls: [] }) })
    );
    expect(result.booking.status).toBe(BookingStatus.CHECKED_OUT);
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

  it("미니바 0건: 라인 미생성·minibarChargeVnd 미갱신(게스트청구 update만)", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await completeCheckout(makePrismaMock(tx), { ...BASE_INPUT, minibarLines: [] });
    expect(tx.checkoutMinibarLine.create).not.toHaveBeenCalled();
    expect(tx.minibarStockMovement.create).not.toHaveBeenCalled();
    // 미니바 비정규화 캐시(minibarChargeVnd)는 갱신되지 않는다(ADR-0019 S4: 게스트청구 update는 minibarChargeVnd 미포함)
    for (const call of tx.checkOutRecord.update.mock.calls) {
      expect((call[0] as { data: Record<string, unknown> }).data).not.toHaveProperty("minibarChargeVnd");
    }
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

  // ── 미니바 전환 자동 회수 (ADR-0019 Phase 2 / ADR-0021 D6) ────────────────
  const CHECKOUT_DATE = new Date("2026-07-05T00:00:00.000Z");

  function recoverCalls(tx: ReturnType<typeof makeTxMock>) {
    return tx.minibarStockMovement.create.mock.calls.filter(
      (c) => (c[0] as { data: { type: string } }).data.type === "RECOVER"
    );
  }

  it("다음 예약 seller=SUPPLIER → 전 품목 RECOVER(−onHand)로 현재고 0", async () => {
    const tx = makeTxMock({
      booking: {
        id: "bk1",
        status: BookingStatus.CHECKED_IN,
        villaId: "v1",
        checkOut: CHECKOUT_DATE,
        seller: "OPERATOR",
      },
      nextBooking: { seller: "SUPPLIER" },
      onHandByItem: [
        { minibarItemId: "mb_cola", onHand: 5 },
        { minibarItemId: "mb_water", onHand: 3 },
      ],
    });
    await completeCheckout(makePrismaMock(tx), BASE_INPUT);

    const recovers = recoverCalls(tx);
    expect(recovers).toHaveLength(2);
    // 콜라 5개·물 3개 음수 회수, 출처 예약 보존, 원가 없음(unitCostVnd 미설정)
    const cola = recovers.find(
      (c) => (c[0] as { data: { minibarItemId: string } }).data.minibarItemId === "mb_cola"
    )!;
    expect((cola[0] as { data: Record<string, unknown> }).data).toMatchObject({
      villaId: "v1",
      minibarItemId: "mb_cola",
      type: "RECOVER",
      qtyDelta: -5,
      bookingId: "bk1",
      note: "전환 회수: 다음 공급자 직접판매",
    });
    // ★ 누수 점검: RECOVER 이동에 원가(unitCostVnd) 노출 0
    expect((cola[0] as { data: Record<string, unknown> }).data).not.toHaveProperty("unitCostVnd");
    const water = recovers.find(
      (c) => (c[0] as { data: { minibarItemId: string } }).data.minibarItemId === "mb_water"
    )!;
    expect((water[0] as { data: { qtyDelta: number } }).data.qtyDelta).toBe(-3);
  });

  it("다음 예약 seller=OPERATOR → RECOVER 0건(회귀 0)", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN, villaId: "v1", seller: "OPERATOR" },
      nextBooking: { seller: "OPERATOR" },
      onHandByItem: [{ minibarItemId: "mb_cola", onHand: 5 }],
    });
    await completeCheckout(makePrismaMock(tx), BASE_INPUT);
    expect(recoverCalls(tx)).toHaveLength(0);
    // groupBy도 호출 안 됨(다음=OPERATOR면 집계 스킵)
    expect(tx.minibarStockMovement.groupBy).not.toHaveBeenCalled();
  });

  it("다음 예약 없음(미정) → RECOVER 0건", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN, villaId: "v1" },
      nextBooking: null,
      onHandByItem: [{ minibarItemId: "mb_cola", onHand: 5 }],
    });
    await completeCheckout(makePrismaMock(tx), BASE_INPUT);
    expect(recoverCalls(tx)).toHaveLength(0);
    expect(tx.minibarStockMovement.groupBy).not.toHaveBeenCalled();
  });

  it("다음=SUPPLIER이나 onHand 0·음수 품목은 RECOVER 미생성", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN, villaId: "v1" },
      nextBooking: { seller: "SUPPLIER" },
      onHandByItem: [
        { minibarItemId: "mb_cola", onHand: 0 },
        { minibarItemId: "mb_water", onHand: -2 }, // 보정으로 음수 — 회수 대상 아님
        { minibarItemId: "mb_juice", onHand: 4 },
      ],
    });
    await completeCheckout(makePrismaMock(tx), BASE_INPUT);
    const recovers = recoverCalls(tx);
    expect(recovers).toHaveLength(1);
    expect((recovers[0][0] as { data: { minibarItemId: string; qtyDelta: number } }).data).toMatchObject({
      minibarItemId: "mb_juice",
      qtyDelta: -4,
    });
  });

  it("소비(CONSUME) 0건이어도 다음=SUPPLIER면 기존 재고 회수(회수는 소비와 독립)", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN, villaId: "v1" },
      nextBooking: { seller: "SUPPLIER" },
      onHandByItem: [{ minibarItemId: "mb_cola", onHand: 6 }],
    });
    // minibarLines 미전송 → CONSUME 0건
    await completeCheckout(makePrismaMock(tx), { ...BASE_INPUT, minibarLines: [] });
    // CONSUME은 0건, RECOVER는 1건
    const consumes = tx.minibarStockMovement.create.mock.calls.filter(
      (c) => (c[0] as { data: { type: string } }).data.type === "CONSUME"
    );
    expect(consumes).toHaveLength(0);
    expect(recoverCalls(tx)).toHaveLength(1);
    expect((recoverCalls(tx)[0][0] as { data: { qtyDelta: number } }).data.qtyDelta).toBe(-6);
  });

  it("회수 발생 시 AuditLog에 회수 품목 수 기록(원가·수량 상세는 비노출)", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN, villaId: "v1" },
      nextBooking: { seller: "SUPPLIER" },
      onHandByItem: [
        { minibarItemId: "mb_cola", onHand: 5 },
        { minibarItemId: "mb_water", onHand: 3 },
      ],
    });
    await completeCheckout(makePrismaMock(tx), BASE_INPUT);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ minibarRecoveredItems: { new: 2 } }),
      })
    );
  });

  // ── 게스트 다통화 분할 수납 (테오 요청 2026-07-10) ────────────────────────
  it("통화별 실수납액 + 환율 스냅샷 저장, AuditLog에 수납액(BigInt 문자열) 기록", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    const result = await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      settlement: { method: "CASH", amounts: { vnd: 500_000n, krw: 20_000, usd: 5 } },
      settlementFx: { date: "2026-07-05", vndPerKrw: 19, vndPerUsd: 25_000 },
    });
    const settleUpdate = tx.checkOutRecord.update.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => "settledVnd" in d)!;
    expect(settleUpdate).toMatchObject({
      settlementMethod: "CASH",
      settledVnd: 500_000n,
      settledKrw: 20_000,
      settledUsd: 5,
      settlementFx: { date: "2026-07-05", vndPerKrw: 19, vndPerUsd: 25_000 },
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          settledVnd: { new: "500000" },
          settledKrw: { new: 20_000 },
          settledUsd: { new: 5 },
        }),
      })
    );
    expect(result.record.id).toBe("cor1");
  });

  it("수납액 0/미입력은 null, 환율 스냅샷도 미저장", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      settlement: { method: "BANK_TRANSFER", amounts: null },
      settlementFx: { date: "2026-07-05", vndPerKrw: 19, vndPerUsd: 25_000 },
    });
    const settleUpdate = tx.checkOutRecord.update.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => "settlementMethod" in d)!;
    expect(settleUpdate.settledVnd).toBeNull();
    expect(settleUpdate.settledKrw).toBeNull();
    expect(settleUpdate.settledUsd).toBeNull();
    // 양수 수납액이 없으면 환율 스냅샷은 저장하지 않는다(undefined → 미설정)
    expect(settleUpdate.settlementFx).toBeUndefined();
  });

  it("수납 음수 금액 → RangeError", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await expect(
      completeCheckout(makePrismaMock(tx), {
        ...BASE_INPUT,
        settlement: { method: "CASH", amounts: { vnd: -1n } },
      })
    ).rejects.toThrow(RangeError);
  });

  // ── 결제수단 혼합(분할) 수납 (T-checkout-mixed) ────────────────────────────
  it("혼합 라인(현금 VND + 이체 KRW): 라인 2건 createMany + settlementMethod=MIXED + 통화별 합계", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      settlement: {
        lines: [
          { method: "CASH", currency: "VND", amount: 5_000_000n },
          { method: "BANK_TRANSFER", currency: "KRW", amount: 200_000n },
        ],
      },
      settlementFx: { date: "2026-07-05", vndPerKrw: 19, vndPerUsd: 25_000 },
    });
    // 원장 라인 2건
    expect(tx.checkoutSettlementLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          checkOutRecordId: "cor1",
          method: "CASH",
          currency: "VND",
          amount: 5_000_000n,
        }),
        expect.objectContaining({
          checkOutRecordId: "cor1",
          method: "BANK_TRANSFER",
          currency: "KRW",
          amount: 200_000n,
        }),
      ],
    });
    // 비정규화 캐시 + 파생 수단
    const settleUpdate = tx.checkOutRecord.update.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => "settlementMethod" in d)!;
    expect(settleUpdate).toMatchObject({
      settlementMethod: "MIXED",
      settledVnd: 5_000_000n,
      settledKrw: 200_000,
      settledUsd: null,
      settlementFx: { date: "2026-07-05", vndPerKrw: 19, vndPerUsd: 25_000 },
    });
    // AuditLog 라인 요약(BigInt는 문자열)
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          settlementLines: {
            new: [
              { method: "CASH", currency: "VND", amount: "5000000" },
              { method: "BANK_TRANSFER", currency: "KRW", amount: "200000" },
            ],
          },
        }),
      })
    );
  });

  it("단일 수단 라인 여러 통화: settlementMethod=그 수단(MIXED 아님)", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      settlement: {
        lines: [
          { method: "CASH", currency: "VND", amount: 3_000_000n },
          { method: "CASH", currency: "USD", amount: 50n },
        ],
      },
    });
    const settleUpdate = tx.checkOutRecord.update.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => "settlementMethod" in d)!;
    expect(settleUpdate.settlementMethod).toBe("CASH");
    expect(settleUpdate.settledVnd).toBe(3_000_000n);
    expect(settleUpdate.settledUsd).toBe(50);
    expect(settleUpdate.settledKrw).toBeNull();
  });

  it("중복 (수단,통화) 라인은 합산 병합 후 1건 저장", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      settlement: {
        lines: [
          { method: "CASH", currency: "VND", amount: 1_000_000n },
          { method: "CASH", currency: "VND", amount: 2_000_000n },
        ],
      },
    });
    const createManyArg = tx.checkoutSettlementLine.createMany.mock.calls[0][0] as {
      data: unknown[];
    };
    expect(createManyArg.data).toHaveLength(1);
    expect(createManyArg.data[0]).toMatchObject({ currency: "VND", amount: 3_000_000n });
  });

  it("구 shape(amounts+method) 하위호환: 단일 수단 라인으로 변환 저장", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      settlement: { method: "BANK_TRANSFER", amounts: { vnd: 4_000_000n, krw: 100_000, usd: null } },
      settlementFx: { date: "2026-07-05", vndPerKrw: 19, vndPerUsd: 25_000 },
    });
    // amounts → 라인 2건(VND, KRW)으로 변환, USD null은 미생성
    const createManyArg = tx.checkoutSettlementLine.createMany.mock.calls[0][0] as {
      data: Array<{ method: string; currency: string; amount: bigint }>;
    };
    expect(createManyArg.data).toHaveLength(2);
    expect(createManyArg.data.every((l) => l.method === "BANK_TRANSFER")).toBe(true);
    const settleUpdate = tx.checkOutRecord.update.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => "settlementMethod" in d)!;
    // 수단 1종 → MIXED 아님
    expect(settleUpdate.settlementMethod).toBe("BANK_TRANSFER");
    expect(settleUpdate.settledVnd).toBe(4_000_000n);
    expect(settleUpdate.settledKrw).toBe(100_000);
  });

  it("method만(금액 없음) 하위호환: 라인 미생성 + 수단·수납시각만 기록", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      settlement: { method: "CASH" },
      settlementFx: { date: "2026-07-05", vndPerKrw: 19, vndPerUsd: 25_000 },
    });
    expect(tx.checkoutSettlementLine.createMany).not.toHaveBeenCalled();
    const settleUpdate = tx.checkOutRecord.update.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => "settlementMethod" in d)!;
    expect(settleUpdate.settlementMethod).toBe("CASH");
    expect(settleUpdate.settledVnd).toBeNull();
    expect(settleUpdate.settledAt).toBe(NOW);
    // 실수납 없음 → 환율 스냅샷 미저장
    expect(settleUpdate.settlementFx).toBeUndefined();
  });

  it("라인 amount 0 → RangeError (트랜잭션 진입 전 검증)", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    await expect(
      completeCheckout(makePrismaMock(tx), {
        ...BASE_INPUT,
        settlement: { lines: [{ method: "CASH", currency: "VND", amount: 0n }] },
      })
    ).rejects.toThrow(RangeError);
    expect(tx.checkOutRecord.create).not.toHaveBeenCalled();
  });

  it("라인 13건 이상 → RangeError", async () => {
    const tx = makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } });
    const lines = Array.from({ length: 13 }, () => ({
      method: "CASH" as const,
      currency: "VND" as const,
      amount: 1_000n,
    }));
    await expect(
      completeCheckout(makePrismaMock(tx), { ...BASE_INPUT, settlement: { lines } })
    ).rejects.toThrow(RangeError);
  });

  // ── 보증금 상계(DEPOSIT 수납 라인, ADR-0041) ───────────────────────────────
  const HELD_VND_BOOKING = {
    id: "bk1",
    status: BookingStatus.CHECKED_IN,
    depositStatus: DepositStatus.HELD,
    depositAmount: 5_000_000,
    depositCurrency: "VND" as const,
  };

  it("DEPOSIT 단독: settlementMethod=DEPOSIT·depositDeductVnd=상계액·PARTIAL_DEDUCTED, 라인 저장", async () => {
    const tx = makeTxMock({ booking: { ...HELD_VND_BOOKING } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      settlement: { lines: [{ method: "DEPOSIT", currency: "VND", amount: 2_000_000n }] },
      settlementFx: { date: "2026-07-05", vndPerKrw: 19, vndPerUsd: 25_000 },
    });
    // 파손 없이 상계만 → PARTIAL_DEDUCTED + depositDeductVnd = 상계액
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          depositStatus: DepositStatus.PARTIAL_DEDUCTED,
          depositDeductVnd: 2_000_000n,
        }),
      })
    );
    // 수납 라인 원장에 DEPOSIT 라인 저장
    expect(tx.checkoutSettlementLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ method: "DEPOSIT", currency: "VND", amount: 2_000_000n }),
      ],
    });
    // 단일 수단 → settlementMethod=DEPOSIT
    const settleUpdate = tx.checkOutRecord.update.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => "settlementMethod" in d)!;
    expect(settleUpdate.settlementMethod).toBe("DEPOSIT");
    // AuditLog에 상계액 문자열 기록
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          depositOffsetVnd: { new: "2000000" },
          depositDeductVnd: { new: "2000000" },
        }),
      })
    );
  });

  it("DEPOSIT + 파손: depositDeductVnd=파손+상계 합", async () => {
    const tx = makeTxMock({ booking: { ...HELD_VND_BOOKING } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      damageFound: true,
      damageNote: "유리 파손",
      deductionVnd: 1_000_000n,
      settlement: { lines: [{ method: "DEPOSIT", currency: "VND", amount: 2_000_000n }] },
    });
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          depositStatus: DepositStatus.PARTIAL_DEDUCTED,
          depositDeductVnd: 3_000_000n, // 파손 1M + 상계 2M
        }),
      })
    );
  });

  it("DEPOSIT + 현금 혼합 → settlementMethod=MIXED", async () => {
    const tx = makeTxMock({ booking: { ...HELD_VND_BOOKING } });
    await completeCheckout(makePrismaMock(tx), {
      ...BASE_INPUT,
      settlement: {
        lines: [
          { method: "DEPOSIT", currency: "VND", amount: 2_000_000n },
          { method: "CASH", currency: "VND", amount: 500_000n },
        ],
      },
    });
    const settleUpdate = tx.checkOutRecord.update.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => "settlementMethod" in d)!;
    expect(settleUpdate.settlementMethod).toBe("MIXED");
    // 보증금에서 빠진 총액 = 상계 2M만(현금은 실수납이지 보증금 차감 아님)
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ depositDeductVnd: 2_000_000n }),
      })
    );
  });

  it("상계액 > (보증금 − 파손차감) → DepositOffsetError(DEPOSIT_OFFSET_EXCEEDS)", async () => {
    const tx = makeTxMock({ booking: { ...HELD_VND_BOOKING } }); // 보증금 5M
    await expect(
      completeCheckout(makePrismaMock(tx), {
        ...BASE_INPUT,
        damageFound: true,
        damageNote: "파손",
        deductionVnd: 4_000_000n, // 잔액 1M
        settlement: { lines: [{ method: "DEPOSIT", currency: "VND", amount: 2_000_000n }] }, // 2M > 1M
      })
    ).rejects.toMatchObject({ code: "DEPOSIT_OFFSET_EXCEEDS" });
    expect(tx.checkOutRecord.create).not.toHaveBeenCalled();
  });

  it("보증금 NONE(미수취) + DEPOSIT 라인 → DepositOffsetError(DEPOSIT_NOT_HELD)", async () => {
    const tx = makeTxMock({
      booking: { id: "bk1", status: BookingStatus.CHECKED_IN, depositStatus: DepositStatus.NONE },
    });
    await expect(
      completeCheckout(makePrismaMock(tx), {
        ...BASE_INPUT,
        settlement: { lines: [{ method: "DEPOSIT", currency: "VND", amount: 1_000_000n }] },
      })
    ).rejects.toMatchObject({ code: "DEPOSIT_NOT_HELD" });
  });

  it("보증금 통화 KRW(비VND) + DEPOSIT 라인 → DepositOffsetError(DEPOSIT_NOT_VND)", async () => {
    const tx = makeTxMock({
      booking: {
        id: "bk1",
        status: BookingStatus.CHECKED_IN,
        depositStatus: DepositStatus.HELD,
        depositAmount: 3_000_000,
        depositCurrency: "KRW",
      },
    });
    await expect(
      completeCheckout(makePrismaMock(tx), {
        ...BASE_INPUT,
        settlement: { lines: [{ method: "DEPOSIT", currency: "VND", amount: 1_000_000n }] },
      })
    ).rejects.toMatchObject({ code: "DEPOSIT_NOT_VND" });
  });

  it("보증금 금액 미기록(depositAmount=null) + DEPOSIT 라인 → DEPOSIT_OFFSET_EXCEEDS", async () => {
    const tx = makeTxMock({
      booking: {
        id: "bk1",
        status: BookingStatus.CHECKED_IN,
        depositStatus: DepositStatus.HELD,
        depositAmount: null,
        depositCurrency: "VND",
      },
    });
    await expect(
      completeCheckout(makePrismaMock(tx), {
        ...BASE_INPUT,
        settlement: { lines: [{ method: "DEPOSIT", currency: "VND", amount: 1_000_000n }] },
      })
    ).rejects.toMatchObject({ code: "DEPOSIT_OFFSET_EXCEEDS" });
  });

  it("DEPOSIT 라인 currency=KRW → RangeError (트랜잭션 진입 전, normalize 검증)", async () => {
    const tx = makeTxMock({ booking: { ...HELD_VND_BOOKING } });
    await expect(
      completeCheckout(makePrismaMock(tx), {
        ...BASE_INPUT,
        settlement: { lines: [{ method: "DEPOSIT", currency: "KRW", amount: 100_000n }] },
      })
    ).rejects.toThrow(RangeError);
    expect(tx.checkOutRecord.create).not.toHaveBeenCalled();
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

  it("zod 검증: 차감액 비숫자 → 400 (사진은 이제 선택)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
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

  // ── 혼합 수납 라인 (T-checkout-mixed) ──────────────────────────────────
  it("혼합 라인 성공 → 200 (method 없이 lines만)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(
      makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } })
    );
    const res = await callCheckout({
      damageFound: false,
      settlement: {
        lines: [
          { method: "CASH", currency: "VND", amount: "5000000" },
          { method: "BANK_TRANSFER", currency: "KRW", amount: "200000" },
        ],
      },
    });
    expect(res.status).toBe(200);
  });

  it("method=MIXED 직접 지정 → 400 (서버 파생 전용)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await callCheckout({
      damageFound: false,
      settlement: { method: "MIXED" },
    });
    expect(res.status).toBe(400);
  });

  it("라인 method=MIXED → 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await callCheckout({
      damageFound: false,
      settlement: { lines: [{ method: "MIXED", currency: "VND", amount: "1000" }] },
    });
    expect(res.status).toBe(400);
  });

  it("lines·method 모두 없음 → 400 (구 shape 하위호환 refine)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await callCheckout({
      damageFound: false,
      settlement: { note: "메모만" },
    });
    expect(res.status).toBe(400);
  });

  it("라인 13건 이상 → 400 (zod max)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await callCheckout({
      damageFound: false,
      settlement: {
        lines: Array.from({ length: 13 }, () => ({
          method: "CASH",
          currency: "VND",
          amount: "1000",
        })),
      },
    });
    expect(res.status).toBe(400);
  });

  it("라인 음수 amount → 400 (regex)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await callCheckout({
      damageFound: false,
      settlement: { lines: [{ method: "CASH", currency: "VND", amount: "-1" }] },
    });
    expect(res.status).toBe(400);
  });

  it("라인 amount 0 → 400 (lib RangeError)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(
      makeTxMock({ booking: { id: "bk1", status: BookingStatus.CHECKED_IN } })
    );
    const res = await callCheckout({
      damageFound: false,
      settlement: { lines: [{ method: "CASH", currency: "VND", amount: "0" }] },
    });
    expect(res.status).toBe(400);
  });

  // ── 보증금 상계(DEPOSIT 라인, ADR-0041) 라우트 매핑 ─────────────────────────
  it("DEPOSIT 라인 성공 → 200 (보증금 HELD·VND, 상계 ≤ 잔액)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(
      makeTxMock({
        booking: {
          id: "bk1",
          status: BookingStatus.CHECKED_IN,
          depositStatus: DepositStatus.HELD,
          depositAmount: 5_000_000,
          depositCurrency: "VND",
        },
      })
    );
    const res = await callCheckout({
      damageFound: false,
      settlement: { lines: [{ method: "DEPOSIT", currency: "VND", amount: "2000000" }] },
    });
    expect(res.status).toBe(200);
  });

  it("상계 초과 → 400 {error: DEPOSIT_OFFSET_EXCEEDS}", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(
      makeTxMock({
        booking: {
          id: "bk1",
          status: BookingStatus.CHECKED_IN,
          depositStatus: DepositStatus.HELD,
          depositAmount: 1_000_000,
          depositCurrency: "VND",
        },
      })
    );
    const res = await callCheckout({
      damageFound: false,
      settlement: { lines: [{ method: "DEPOSIT", currency: "VND", amount: "2000000" }] },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("DEPOSIT_OFFSET_EXCEEDS");
  });

  it("보증금 NONE + DEPOSIT 라인 → 400 {error: DEPOSIT_NOT_HELD}", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(
      makeTxMock({
        booking: { id: "bk1", status: BookingStatus.CHECKED_IN, depositStatus: DepositStatus.NONE },
      })
    );
    const res = await callCheckout({
      damageFound: false,
      settlement: { lines: [{ method: "DEPOSIT", currency: "VND", amount: "1000000" }] },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("DEPOSIT_NOT_HELD");
  });

  it("DEPOSIT 라인 currency=KRW → 400 (RangeError→invalid_input)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    await setupRoutePrisma(
      makeTxMock({
        booking: {
          id: "bk1",
          status: BookingStatus.CHECKED_IN,
          depositStatus: DepositStatus.HELD,
          depositAmount: 5_000_000,
          depositCurrency: "VND",
        },
      })
    );
    const res = await callCheckout({
      damageFound: false,
      settlement: { lines: [{ method: "DEPOSIT", currency: "KRW", amount: "100000" }] },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });
});
