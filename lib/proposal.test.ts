import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingChannel, BookingSeller, Currency, ProposalStatus } from "@prisma/client";

// DB·부수효과 모듈 차단 (T1.6 패턴)
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
const mockCheckAvailability = vi.fn();
const mockQuoteSupplierSale = vi.fn();
const mockQuoteStay = vi.fn();
// 유효 환율(후속확장 3) — proposal은 스냅샷을 getEffectiveFx*로 조회한다.
const mockGetEffectiveFxVndPerKrw = vi.fn();
const mockGetEffectiveFxVndPerUsd = vi.fn();
vi.mock("./availability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./availability")>();
  return { ...actual, checkAvailability: (...a: unknown[]) => mockCheckAvailability(...a) };
});
vi.mock("./pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pricing")>();
  return {
    ...actual,
    quoteSupplierSaleForVilla: (...a: unknown[]) => mockQuoteSupplierSale(...a),
    quoteStayForVilla: (...a: unknown[]) => mockQuoteStay(...a),
  };
});
vi.mock("./fx-effective", () => ({
  getEffectiveFxVndPerKrw: (...a: unknown[]) => mockGetEffectiveFxVndPerKrw(...a),
  getEffectiveFxVndPerUsd: (...a: unknown[]) => mockGetEffectiveFxVndPerUsd(...a),
}));

import {
  createProposal,
  createSupplierProposal,
  defaultCurrencyForChannel,
  effectiveProposalStatus,
  generateProposalToken,
  listSupplierProposals,
  ProposalRejectedError,
  SupplierProposalRejectedError,
  uniformNightlyPrice,
} from "./proposal";
import { MissingSupplierPriceError } from "./pricing";

const NOW = new Date("2026-07-01T10:00:00.000Z");
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("defaultCurrencyForChannel — 채널 → 통화 기본값 (ADR-0003)", () => {
  it("DIRECT(직접 소비자) → KRW", () => {
    expect(defaultCurrencyForChannel(BookingChannel.DIRECT)).toBe(Currency.KRW);
  });

  it("여행사·랜드사 → VND", () => {
    expect(defaultCurrencyForChannel(BookingChannel.TRAVEL_AGENCY)).toBe(Currency.VND);
    expect(defaultCurrencyForChannel(BookingChannel.LAND_AGENCY)).toBe(Currency.VND);
  });
});

describe("effectiveProposalStatus — 시각 기준 서버 판정 (c2 단일 렌더 소스)", () => {
  it("ACTIVE + 미만료 → ACTIVE", () => {
    expect(
      effectiveProposalStatus(ProposalStatus.ACTIVE, new Date(NOW.getTime() + 1), NOW)
    ).toBe(ProposalStatus.ACTIVE);
  });

  it("ACTIVE + expiresAt 경과(동시각 포함) → EXPIRED — evaluateProposalForHold와 동일 규약", () => {
    expect(effectiveProposalStatus(ProposalStatus.ACTIVE, NOW, NOW)).toBe(ProposalStatus.EXPIRED);
    expect(
      effectiveProposalStatus(ProposalStatus.ACTIVE, new Date(NOW.getTime() - 1), NOW)
    ).toBe(ProposalStatus.EXPIRED);
  });

  it.each([ProposalStatus.USED, ProposalStatus.REVOKED, ProposalStatus.EXPIRED])(
    "비ACTIVE(%s)는 만료 여부와 무관하게 그대로",
    (status) => {
      expect(effectiveProposalStatus(status, new Date(NOW.getTime() + 1), NOW)).toBe(status);
      expect(effectiveProposalStatus(status, new Date(NOW.getTime() - 1), NOW)).toBe(status);
    }
  );
});

describe("uniformNightlyPrice — 균일가만 perNight 채움 (money-pattern: 평균 가공 금지)", () => {
  it("전 박 동일 요율이면 그 값 (KRW number)", () => {
    expect(uniformNightlyPrice([350_000, 350_000, 350_000])).toBe(350_000);
  });

  it("전 박 동일 요율이면 그 값 (VND bigint)", () => {
    expect(uniformNightlyPrice([6_000_000n, 6_000_000n])).toBe(6_000_000n);
  });

  it("시즌 경계로 요율이 섞이면 null — 평균·반올림 가공 금지", () => {
    expect(uniformNightlyPrice([350_000, 350_000, 230_000])).toBeNull();
    expect(uniformNightlyPrice([6_000_000n, 4_000_000n])).toBeNull();
  });

  it("빈 배열은 null", () => {
    expect(uniformNightlyPrice([])).toBeNull();
  });
});

describe("generateProposalToken — 공개 링크 토큰", () => {
  it("URL-safe(base64url) 32자, 호출마다 상이", () => {
    const a = generateProposalToken();
    const b = generateProposalToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/); // 24바이트 → base64url 32자
    expect(a).not.toBe(b);
  });
});

// ===================== createSupplierProposal (F10 Phase B) =====================

function makeCreateTx(opts: {
  villa?: { id: string } | null;
  createdProposal?: { id: string; token: string };
}) {
  const created: Record<string, unknown>[] = [];
  const tx = {
    villa: { findFirst: vi.fn(async () => opts.villa ?? null) },
    proposal: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return {
          id: opts.createdProposal?.id ?? "prop1",
          token: opts.createdProposal?.token ?? "tok_abc",
          ...args.data,
        };
      }),
    },
    _created: created,
  };
  return tx;
}

function makePrismaWithTx(tx: ReturnType<typeof makeCreateTx>) {
  return {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Parameters<typeof createSupplierProposal>[0];
}

const VALID_INPUT = {
  villaId: "v1",
  supplierId: "sup1",
  clientName: "응우옌 고객",
  checkIn: d("2026-07-01"),
  checkOut: d("2026-07-04"),
  now: NOW,
};

describe("createSupplierProposal — 공급자 직접 판매 링크 생성", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckAvailability.mockResolvedValue({ available: true, sellable: true, reasons: [] });
    mockQuoteSupplierSale.mockResolvedValue({
      totalVnd: 6_000_000n,
      nightlyVnd: [2_000_000n, 2_000_000n, 2_000_000n],
    });
  });

  it("타 공급자/없는 빌라 → SupplierProposalRejectedError(NOT_FOUND)", async () => {
    const tx = makeCreateTx({ villa: null });
    await expect(createSupplierProposal(makePrismaWithTx(tx), VALID_INPUT)).rejects.toMatchObject({
      reason: "NOT_FOUND",
    });
    expect(tx.proposal.create).not.toHaveBeenCalled();
    // 스코프: findFirst가 supplierId 조건으로 호출되었는지
    expect(tx.villa.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "v1", supplierId: "sup1" } })
    );
  });

  it("가용성 미통과 → SOLD_OUT", async () => {
    mockCheckAvailability.mockResolvedValue({ available: false, sellable: false, reasons: ["BOOKING_OVERLAP"] });
    const tx = makeCreateTx({ villa: { id: "v1" } });
    await expect(createSupplierProposal(makePrismaWithTx(tx), VALID_INPUT)).rejects.toMatchObject({
      reason: "SOLD_OUT",
    });
    expect(tx.proposal.create).not.toHaveBeenCalled();
  });

  it("공급자 판매가 미설정 → MissingSupplierPriceError 전파(라우트 400)", async () => {
    mockQuoteSupplierSale.mockRejectedValue(new MissingSupplierPriceError("HIGH" as never, d("2026-07-02")));
    const tx = makeCreateTx({ villa: { id: "v1" } });
    await expect(createSupplierProposal(makePrismaWithTx(tx), VALID_INPUT)).rejects.toBeInstanceOf(
      MissingSupplierPriceError
    );
  });

  it("정상 생성: seller=SUPPLIER·supplierId·VND·DIRECT, KRW 컬럼 null, totalVnd 스냅샷", async () => {
    const tx = makeCreateTx({ villa: { id: "v1" }, createdProposal: { id: "prop9", token: "tok9" } });
    const res = await createSupplierProposal(makePrismaWithTx(tx), VALID_INPUT);
    expect(res.id).toBe("prop9");
    expect(res.token).toMatch(/^[A-Za-z0-9_-]{32}$/); // 생성 시 난수 토큰
    const data = tx._created[0];
    expect(data.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(data.seller).toBe(BookingSeller.SUPPLIER);
    expect(data.supplierId).toBe("sup1");
    expect(data.saleCurrency).toBe(Currency.VND);
    expect(data.channel).toBe(BookingChannel.DIRECT);
    expect(data.fxVndPerKrw).toBeNull();
    // 항목: VND만, KRW 컬럼 null
    const item = (data.items as { create: Record<string, unknown>[] }).create[0];
    expect(item.totalVnd).toBe(6_000_000n);
    expect(item.priceVndPerNight).toBe(2_000_000n); // 균일가
    expect(item.priceKrwPerNight).toBeNull();
    expect(item.totalKrw).toBeNull();
  });

  it("빈 고객명·역전 날짜는 RangeError", async () => {
    const tx = makeCreateTx({ villa: { id: "v1" } });
    await expect(
      createSupplierProposal(makePrismaWithTx(tx), { ...VALID_INPUT, clientName: "  " })
    ).rejects.toThrow(RangeError);
    await expect(
      createSupplierProposal(makePrismaWithTx(tx), { ...VALID_INPUT, checkIn: d("2026-07-05") })
    ).rejects.toThrow(RangeError);
  });
});

// ===================== createProposal USD 분기 (Phase 2) =====================

function makeOperatorTx() {
  const created: Record<string, unknown>[] = [];
  const tx = {
    partner: { findUnique: vi.fn(async () => null) },
    proposal: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return {
          id: "propUsd",
          token: args.data.token,
          expiresAt: args.data.expiresAt,
          ...args.data,
          items: [{ id: "it1", villaId: "v1" }],
        };
      }),
    },
    // getDailyRates(tx) 호환 — 목으로 대체되지만 형태 유지
    appSetting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    _created: created,
  };
  return tx;
}

function makeOperatorPrisma(tx: ReturnType<typeof makeOperatorTx>) {
  return {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Parameters<typeof createProposal>[0];
}

describe("createProposal — USD 분기 (Phase 2, 수동 총액)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckAvailability.mockResolvedValue({ available: true, sellable: true, reasons: [] });
    // USD: quoteStayForVilla는 원가만 반환(sale 칸 없음)
    mockQuoteStay.mockResolvedValue({
      nights: 3,
      saleCurrency: Currency.USD,
      nightly: [],
      totalSupplierCostVnd: 18_000_000n,
    });
    mockGetEffectiveFxVndPerKrw.mockResolvedValue(null);
    // 유효 USD 환율 — 스냅샷은 이 문자열을 그대로 저장(getEffectiveFxVndPerUsd 반환값).
    mockGetEffectiveFxVndPerUsd.mockResolvedValue("25400");
  });

  const baseUsdInput = {
    clientName: "John Smith",
    channel: BookingChannel.DIRECT,
    saleCurrency: Currency.USD,
    actorUserId: "admin1",
    now: NOW,
  };

  it("정상: totalUsd 저장, krw/vnd 컬럼 null, fxVndPerUsd 스냅샷(소수4자리)", async () => {
    const tx = makeOperatorTx();
    await createProposal(makeOperatorPrisma(tx), {
      ...baseUsdInput,
      items: [{ villaId: "v1", checkIn: d("2026-07-01"), checkOut: d("2026-07-04"), totalUsd: 1_500 }],
    });
    const data = tx._created[0];
    expect(data.saleCurrency).toBe(Currency.USD);
    expect(data.fxVndPerUsd).toBe("25400"); // getEffectiveFxVndPerUsd 반환 문자열 그대로 스냅샷
    const item = (data.items as { create: Record<string, unknown>[] }).create[0];
    expect(item.totalUsd).toBe(1_500);
    expect(item.totalKrw).toBeNull();
    expect(item.totalVnd).toBeNull();
    expect(item.priceKrwPerNight).toBeNull();
    expect(item.priceVndPerNight).toBeNull();
  });

  it("totalUsd 누락 → RangeError(명확한 에러)", async () => {
    const tx = makeOperatorTx();
    await expect(
      createProposal(makeOperatorPrisma(tx), {
        ...baseUsdInput,
        items: [{ villaId: "v1", checkIn: d("2026-07-01"), checkOut: d("2026-07-04") }],
      })
    ).rejects.toThrow(RangeError);
    expect(tx.proposal.create).not.toHaveBeenCalled();
  });

  it("totalUsd 0·음수 → RangeError", async () => {
    const tx = makeOperatorTx();
    await expect(
      createProposal(makeOperatorPrisma(tx), {
        ...baseUsdInput,
        items: [{ villaId: "v1", checkIn: d("2026-07-01"), checkOut: d("2026-07-04"), totalUsd: 0 }],
      })
    ).rejects.toThrow(RangeError);
  });

  it("유효 USD 환율 null → fxVndPerUsd=null(환산 불가, 그래도 생성)", async () => {
    mockGetEffectiveFxVndPerUsd.mockResolvedValue(null);
    const tx = makeOperatorTx();
    await createProposal(makeOperatorPrisma(tx), {
      ...baseUsdInput,
      items: [{ villaId: "v1", checkIn: d("2026-07-01"), checkOut: d("2026-07-04"), totalUsd: 2_000 }],
    });
    expect(tx._created[0].fxVndPerUsd).toBeNull();
  });

  it("가용성 미통과 빌라 → ProposalRejectedError(부분 생성 금지)", async () => {
    mockCheckAvailability.mockResolvedValue({ available: false, sellable: false, reasons: ["BOOKING_OVERLAP"] });
    const tx = makeOperatorTx();
    await expect(
      createProposal(makeOperatorPrisma(tx), {
        ...baseUsdInput,
        items: [{ villaId: "v1", checkIn: d("2026-07-01"), checkOut: d("2026-07-04"), totalUsd: 1_500 }],
      })
    ).rejects.toBeInstanceOf(ProposalRejectedError);
    expect(tx.proposal.create).not.toHaveBeenCalled();
  });
});

describe("listSupplierProposals — supplierId 스코프 + seller=SUPPLIER만", () => {
  it("스코프 where + effectiveProposalStatus + booking 연결", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "prop1",
        token: "tokA",
        status: ProposalStatus.ACTIVE,
        expiresAt: new Date(NOW.getTime() - 1), // 만료됨 → EXPIRED로 판정되어야
        items: [
          {
            villaId: "v1",
            checkIn: d("2026-07-01"),
            checkOut: d("2026-07-03"),
            totalVnd: 4_000_000n,
            villa: { name: "쏘나씨 V1" },
            booking: { id: "bk1", status: "CONFIRMED" },
          },
        ],
      },
    ]);
    const prisma = { proposal: { findMany } } as unknown as Parameters<typeof listSupplierProposals>[0];
    const rows = await listSupplierProposals(prisma, "sup1", NOW);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supplierId: "sup1", seller: BookingSeller.SUPPLIER },
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(ProposalStatus.EXPIRED); // 만료 반영
    expect(rows[0].totalVnd).toBe(4_000_000n);
    expect(rows[0].villaName).toBe("쏘나씨 V1");
    expect(rows[0].booking).toEqual({ id: "bk1", status: "CONFIRMED" });
  });
});
