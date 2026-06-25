import { beforeEach, describe, expect, it, vi } from "vitest";

// #2c 빌라별 미니바 비치수량 오버라이드 — PATCH /api/villas/[id]/minibar-stock (ADR-0017).
//   운영자(isOperator) 전용·SUPPLIER/CLEANER 차단. 수량(qty)만 저장하고 가격(unitPriceVnd)은 일절
//   조회·수정하지 않는다(회사표준 MinibarItem 유지, 마진 비공개 원칙2).
//   qty === 회사표준 stockQty → 오버라이드 행 삭제(표준 추종), 다르면 upsert. 미지/비활성 품목은 silent drop.
//
//   기존 테스트(minibar-company-standard·villa-amenities-minibar-leak)가 다루지 않던 신규 라우트의
//   권한 게이트·표준추종 로직·누수(AuditLog에 가격 미포함)를 검증한다.

const { mockAuth, mockWriteAuditLog, mockTx, mockDb } = vi.hoisted(() => {
  const tx = {
    villa: { findUnique: vi.fn() },
    minibarItem: { findMany: vi.fn() },
    villaMinibarStock: { deleteMany: vi.fn(), upsert: vi.fn() },
  };
  return {
    mockAuth: vi.fn(),
    mockWriteAuditLog: vi.fn(async (..._a: unknown[]) => {}),
    mockTx: tx,
    mockDb: {
      // 라우트는 $transaction 콜백에 tx를 주입 — 동일 mockTx로 위임
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    },
  };
});
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => mockWriteAuditLog(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: mockDb }));

import { PATCH } from "@/app/api/villas/[id]/minibar-stock/route";

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://local/api/villas/${id}/minibar-stock`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

// 회사표준 2품목: m1 표준 2개, m2 표준 5개
const STD_ITEMS = [
  { id: "m1", stockQty: 2 },
  { id: "m2", stockQty: 5 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockTx.villa.findUnique.mockResolvedValue({ id: "v1" });
  mockTx.minibarItem.findMany.mockResolvedValue(STD_ITEMS);
  mockTx.villaMinibarStock.deleteMany.mockResolvedValue({ count: 1 });
  mockTx.villaMinibarStock.upsert.mockResolvedValue({});
});

describe("PATCH minibar-stock — 권한 게이트", () => {
  it("비로그인 401 (트랜잭션 미진입)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await patch("v1", { stocks: [{ minibarItemId: "m1", qty: 3 }] });
    expect(res.status).toBe(401);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("SUPPLIER 403 (미니바는 회사 운영 영역 — 공급자 차단)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "SUPPLIER" } });
    const res = await patch("v1", { stocks: [{ minibarItemId: "m1", qty: 3 }] });
    expect(res.status).toBe(403);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("CLEANER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "CLEANER" } });
    const res = await patch("v1", { stocks: [{ minibarItemId: "m1", qty: 3 }] });
    expect(res.status).toBe(403);
  });

  it("STAFF 200 — isOperator 허용(수량만, 가격 무관)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "STAFF" } });
    const res = await patch("v1", { stocks: [{ minibarItemId: "m1", qty: 3 }] });
    expect(res.status).toBe(200);
  });

  it("OWNER 200", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "OWNER" } });
    const res = await patch("v1", { stocks: [{ minibarItemId: "m1", qty: 3 }] });
    expect(res.status).toBe(200);
  });
});

describe("PATCH minibar-stock — 표준추종 로직", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "u1", role: "OWNER" } }));

  it("qty !== 표준 → upsert (오버라이드 저장), deleteMany 미호출", async () => {
    const res = await patch("v1", { stocks: [{ minibarItemId: "m1", qty: 3 }] });
    expect(res.status).toBe(200);
    expect(mockTx.villaMinibarStock.upsert).toHaveBeenCalledOnce();
    expect(mockTx.villaMinibarStock.deleteMany).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.changed).toBe(1);
  });

  it("qty === 표준 → deleteMany (표준 추종), upsert 미호출", async () => {
    const res = await patch("v1", { stocks: [{ minibarItemId: "m1", qty: 2 }] });
    expect(res.status).toBe(200);
    expect(mockTx.villaMinibarStock.deleteMany).toHaveBeenCalledOnce();
    expect(mockTx.villaMinibarStock.upsert).not.toHaveBeenCalled();
  });

  it("미지/비활성 품목 itemId → silent drop (delete·upsert 모두 미호출)", async () => {
    const res = await patch("v1", { stocks: [{ minibarItemId: "UNKNOWN", qty: 9 }] });
    expect(res.status).toBe(200);
    expect(mockTx.villaMinibarStock.upsert).not.toHaveBeenCalled();
    expect(mockTx.villaMinibarStock.deleteMany).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.changed).toBe(0);
  });

  it("혼합 — upsert(m1≠2)·삭제(m2=5)·drop(미지) 동시 처리", async () => {
    const res = await patch("v1", {
      stocks: [
        { minibarItemId: "m1", qty: 4 }, // ≠2 → upsert
        { minibarItemId: "m2", qty: 5 }, // ===5 → deleteMany
        { minibarItemId: "ghost", qty: 1 }, // 미지 → drop
      ],
    });
    expect(res.status).toBe(200);
    expect(mockTx.villaMinibarStock.upsert).toHaveBeenCalledOnce();
    expect(mockTx.villaMinibarStock.deleteMany).toHaveBeenCalledOnce();
  });

  it("존재하지 않는 빌라 → 404 (오버라이드 미생성)", async () => {
    mockTx.villa.findUnique.mockResolvedValue(null);
    const res = await patch("nope", { stocks: [{ minibarItemId: "m1", qty: 3 }] });
    expect(res.status).toBe(404);
    expect(mockTx.villaMinibarStock.upsert).not.toHaveBeenCalled();
  });
});

describe("PATCH minibar-stock — 누수·검증", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "u1", role: "OWNER" } }));

  it("AuditLog에 가격 미포함 — 항목 수만 기록(누수 0)", async () => {
    await patch("v1", { stocks: [{ minibarItemId: "m1", qty: 3 }] });
    expect(mockWriteAuditLog).toHaveBeenCalledOnce();
    const arg = mockWriteAuditLog.mock.calls[0][0] as {
      action: string;
      entity: string;
      changes: Record<string, unknown>;
    };
    expect(arg.action).toBe("UPDATE");
    expect(arg.entity).toBe("Villa");
    // 가격 관련 키가 어디에도 없어야 함
    const serialized = JSON.stringify(arg.changes);
    expect(serialized).not.toMatch(/price|unitPrice|salePrice|cost|margin/i);
    expect(arg.changes.minibarStock).toEqual({ new: 1 });
  });

  it("재고 라우트는 minibarItem 가격 컬럼을 조회하지 않는다(active·stockQty만)", async () => {
    await patch("v1", { stocks: [{ minibarItemId: "m1", qty: 3 }] });
    const sel = mockTx.minibarItem.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    };
    expect(sel.where).toEqual({ active: true });
    expect(sel.select).toEqual({ id: true, stockQty: true });
    expect(sel.select.unitPriceVnd).toBeUndefined();
  });

  it("qty 범위 초과(>9999)는 400", async () => {
    const res = await patch("v1", { stocks: [{ minibarItemId: "m1", qty: 10000 }] });
    expect(res.status).toBe(400);
  });

  it("음수 qty는 400", async () => {
    const res = await patch("v1", { stocks: [{ minibarItemId: "m1", qty: -1 }] });
    expect(res.status).toBe(400);
  });

  it("stocks 200개 초과는 400", async () => {
    const stocks = Array.from({ length: 201 }, (_, i) => ({ minibarItemId: `m${i}`, qty: 1 }));
    const res = await patch("v1", { stocks });
    expect(res.status).toBe(400);
  });

  it("잘못된 JSON 본문은 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", role: "OWNER" } });
    const res = await PATCH(
      new Request("http://local/api/villas/v1/minibar-stock", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
      { params: Promise.resolve({ id: "v1" }) }
    );
    expect(res.status).toBe(400);
  });
});
