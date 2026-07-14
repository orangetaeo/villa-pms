// 부가서비스 공급자 변경 허용 범위 확장 가드 매트릭스 (service-order-vendor-change-expansion)
//   새 규칙: vendorId 변경은 status∈{REQUESTED,CONFIRMED}·미정산·미이행·(TICKET이면 미발권)일 때만 허용.
//   살아있는 발주(PENDING_VENDOR·VENDOR_ACCEPTED)에서 교체하면 구 업체에 발주 취소 통보(무료 티켓 제외).
import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));

const soFindUnique = vi.fn();
const soUpdateMany = vi.fn();
const vendorFindUnique = vi.fn();
const catalogFindUnique = vi.fn();
const userFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    serviceOrder: {
      findUnique: (...a: unknown[]) => soFindUnique(...a),
      updateMany: (...a: unknown[]) => soUpdateMany(...a),
    },
    serviceVendor: { findUnique: (...a: unknown[]) => vendorFindUnique(...a) },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFindUnique(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

// 구 업체 취소 통보 + 발주 통보 헬퍼 — 발송 여부만 관찰(내부 Zalo/인앱은 별도 테스트 소관).
const sendVendorPoCancelledNotifications = vi.fn(
  async (..._a: unknown[]) => ({ zaloSent: true })
);
const sendVendorPoNotifications = vi.fn(async (..._a: unknown[]) => ({ zaloSent: true }));
vi.mock("@/lib/vendor-dispatch", () => ({
  sendVendorPoCancelledNotifications: (...a: unknown[]) => sendVendorPoCancelledNotifications(...a),
  sendVendorPoNotifications: (...a: unknown[]) => sendVendorPoNotifications(...a),
}));

vi.mock("@/lib/inapp-notification", () => ({
  enqueueInAppNotification: vi.fn(async () => {}),
  buildVendorNotifText: () => ({ title: "t", body: "b" }),
  vendorNotifLocale: () => "vi",
}));

import { PATCH } from "@/app/api/service-orders/[id]/route";
import { POST as DISPATCH } from "@/app/api/service-orders/[id]/dispatch/route";

const ADMIN = { user: { id: "admin-1", role: "ADMIN" } };

const patchReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// 기본 주문(비TICKET·유료) — 케이스별로 override.
const baseOrder = {
  id: "so-1",
  status: "REQUESTED",
  vendorId: "v-old",
  vendorStatus: null as string | null,
  type: "FOOD",
  priceVnd: 100000n,
  costVnd: 80000n,
  vendorSettledAt: null as Date | null,
  vendorCompletedAt: null as Date | null,
  ticketUrls: [] as string[],
  proposedServiceDate: null,
  vendorProposalRespondedAt: null,
  booking: { status: "CONFIRMED" },
};

// 구 업체 통보 블록이 쓰는 2차 조회(info) + 카탈로그.
const info = {
  quantity: 2,
  serviceDate: null,
  catalogItemId: "ci-1",
  vendorName: "구업체",
  booking: { villa: { name: "V11" } },
};

function primeChange(existing: Record<string, unknown>) {
  soFindUnique.mockReset();
  soFindUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(info);
  soUpdateMany.mockResolvedValue({ count: 1 });
  // 승인+활성 벤더 검증 + 구 업체 조회(동일 mock, superset 반환).
  vendorFindUnique.mockResolvedValue({
    id: "v-new",
    approvalStatus: "APPROVED",
    active: true,
    userId: "old-vu",
    user: { zaloUserId: "z-1", locale: "vi" },
  });
  catalogFindUnique.mockResolvedValue({ nameKo: "과일바구니" });
}

const call = (body: unknown) => PATCH(patchReq(body), { params: Promise.resolve({ id: "so-1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue(ADMIN);
  userFindMany.mockResolvedValue([{ id: "op-1" }]);
});

describe("허용 케이스 (200)", () => {
  it("REQUESTED / vendorStatus null (회귀) — 구 업체 통보 없음", async () => {
    primeChange({ ...baseOrder, status: "REQUESTED", vendorStatus: null });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(200);
    expect(sendVendorPoCancelledNotifications).not.toHaveBeenCalled();
  });

  it("REQUESTED / VENDOR_REJECTED (회귀) — 구 업체 통보 없음", async () => {
    primeChange({ ...baseOrder, status: "REQUESTED", vendorStatus: "VENDOR_REJECTED" });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(200);
    expect(sendVendorPoCancelledNotifications).not.toHaveBeenCalled();
  });

  it("CONFIRMED / PENDING_VENDOR — 허용 + 구 업체 통보 발송", async () => {
    primeChange({ ...baseOrder, status: "CONFIRMED", vendorStatus: "PENDING_VENDOR" });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(200);
    expect(sendVendorPoCancelledNotifications).toHaveBeenCalledOnce();
    // where에 새 허용 조건 반영(동시성 가드).
    expect(soUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "so-1",
          status: { in: ["REQUESTED", "CONFIRMED"] },
          vendorSettledAt: null,
          vendorCompletedAt: null,
        }),
      })
    );
  });

  it("CONFIRMED / VENDOR_ACCEPTED — 허용 + 구 업체 통보 발송", async () => {
    primeChange({ ...baseOrder, status: "CONFIRMED", vendorStatus: "VENDOR_ACCEPTED" });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(200);
    expect(sendVendorPoCancelledNotifications).toHaveBeenCalledOnce();
  });
});

describe("거부 케이스", () => {
  it("DELIVERED — 409 VENDOR_LOCKED(STATUS_CLOSED)", async () => {
    primeChange({ ...baseOrder, status: "DELIVERED", vendorStatus: "VENDOR_ACCEPTED" });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "VENDOR_LOCKED", reason: "STATUS_CLOSED" });
    expect(soUpdateMany).not.toHaveBeenCalled();
  });

  it("CANCELLED — 409 VENDOR_LOCKED(STATUS_CLOSED)", async () => {
    primeChange({ ...baseOrder, status: "CANCELLED", vendorStatus: null });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "VENDOR_LOCKED", reason: "STATUS_CLOSED" });
  });

  it("정산 완료(vendorSettledAt) — 409 VENDOR_LOCKED(SETTLED)", async () => {
    primeChange({ ...baseOrder, status: "CONFIRMED", vendorStatus: "VENDOR_ACCEPTED", vendorSettledAt: new Date() });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "VENDOR_LOCKED", reason: "SETTLED" });
  });

  it("이행 완료(vendorCompletedAt) — 409 VENDOR_LOCKED(COMPLETED)", async () => {
    primeChange({ ...baseOrder, status: "CONFIRMED", vendorStatus: "VENDOR_ACCEPTED", vendorCompletedAt: new Date() });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "VENDOR_LOCKED", reason: "COMPLETED" });
  });

  it("TICKET 발권 후(ticketUrls 존재) — 409 VENDOR_LOCKED(TICKET_ISSUED)", async () => {
    primeChange({
      ...baseOrder,
      type: "TICKET",
      status: "CONFIRMED",
      vendorStatus: "VENDOR_ACCEPTED",
      ticketUrls: ["https://x/qr1.png"],
    });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "VENDOR_LOCKED", reason: "TICKET_ISSUED" });
  });

  it("TICKET → null(직접 제공 전환) — 400 TICKET_VENDOR_REQUIRED", async () => {
    primeChange({ ...baseOrder, type: "TICKET", status: "REQUESTED", vendorStatus: null });
    const res = await call({ vendorId: null });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "TICKET_VENDOR_REQUIRED" });
    expect(soUpdateMany).not.toHaveBeenCalled();
  });

  it("비활성(active=false) 벤더로 교체 시도 — 400 VENDOR_NOT_APPROVED_OR_MISSING", async () => {
    primeChange({ ...baseOrder, status: "REQUESTED", vendorStatus: null });
    // 승인은 됐으나 비활성 — 판매·발주 불가(PR #304 canSellItem 정합).
    vendorFindUnique.mockResolvedValue({ id: "v-new", approvalStatus: "APPROVED", active: false });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "VENDOR_NOT_APPROVED_OR_MISSING" });
    expect(soUpdateMany).not.toHaveBeenCalled();
  });

  it("TICKET 미발권 + 새 벤더 지정 — 허용(200), where에 ticketUrls isEmpty 가드", async () => {
    primeChange({ ...baseOrder, type: "TICKET", status: "REQUESTED", vendorStatus: null });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(200);
    expect(soUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ticketUrls: { isEmpty: true } }),
      })
    );
  });
});

describe("구 업체 통보 발송 조건", () => {
  it("PENDING_VENDOR에서 교체 → 발송", async () => {
    primeChange({ ...baseOrder, status: "REQUESTED", vendorStatus: "PENDING_VENDOR" });
    await call({ vendorId: "v-new" });
    expect(sendVendorPoCancelledNotifications).toHaveBeenCalledOnce();
  });

  it("VENDOR_ACCEPTED에서 교체 → 발송", async () => {
    primeChange({ ...baseOrder, status: "CONFIRMED", vendorStatus: "VENDOR_ACCEPTED" });
    await call({ vendorId: "v-new" });
    expect(sendVendorPoCancelledNotifications).toHaveBeenCalledOnce();
  });

  it("vendorStatus null(미발주)에서 교체 → 미발송", async () => {
    primeChange({ ...baseOrder, status: "REQUESTED", vendorStatus: null });
    await call({ vendorId: "v-new" });
    expect(sendVendorPoCancelledNotifications).not.toHaveBeenCalled();
  });

  it("VENDOR_REJECTED에서 교체 → 미발송", async () => {
    primeChange({ ...baseOrder, status: "REQUESTED", vendorStatus: "VENDOR_REJECTED" });
    await call({ vendorId: "v-new" });
    expect(sendVendorPoCancelledNotifications).not.toHaveBeenCalled();
  });

  it("무료 티켓 살아있는 발주에서 교체 → 미발송(PO 이력 없음)", async () => {
    primeChange({
      ...baseOrder,
      type: "TICKET",
      status: "CONFIRMED",
      vendorStatus: "VENDOR_ACCEPTED",
      priceVnd: 0n,
      costVnd: 0n,
    });
    await call({ vendorId: "v-new" });
    expect(sendVendorPoCancelledNotifications).not.toHaveBeenCalled();
  });
});

describe("동시성 가드 (updateMany count===0)", () => {
  it("교체 사이 잠금 조건으로 전이 → 409 VENDOR_LOCKED, 통보 없음", async () => {
    soFindUnique.mockReset();
    soFindUnique.mockResolvedValueOnce({ ...baseOrder, status: "CONFIRMED", vendorStatus: "VENDOR_ACCEPTED" });
    soUpdateMany.mockResolvedValue({ count: 0 });
    vendorFindUnique.mockResolvedValue({ id: "v-new", approvalStatus: "APPROVED", active: true });
    const res = await call({ vendorId: "v-new" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "VENDOR_LOCKED" });
    expect(sendVendorPoCancelledNotifications).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("변경→재발주 체인 (CONFIRMED 경로 회귀 — PR #307)", () => {
  // 발주함 조회는 PENDING_VENDOR만 → 변경 후 자동 재발주가 CONFIRMED에서 실패하면 벤더 발주함에서 사라짐.
  //   PATCH가 발주 사이클을 리셋(vendorStatus=null)한 뒤, dispatch가 CONFIRMED 주문에서도 통과해 복귀해야 한다.
  const dispatchOrder = {
    id: "so-1",
    status: "CONFIRMED",
    vendorId: "v-new",
    vendorStatus: null, // 변경 직후 리셋 상태
    serviceDate: null,
    serviceTime: null,
    quantity: 2,
    costVnd: 80000n,
    selectedOptions: null,
    catalogItemId: "ci-1",
    vendorName: "새업체",
    guestNote: null,
    customerName: null,
    vendor: {
      id: "v-new",
      name: "새업체",
      userId: "new-vu",
      approvalStatus: "APPROVED",
      user: { zaloUserId: "z-2", locale: "vi" },
    },
    booking: { guestName: "홍길동", villa: { name: "V11", address: null } },
  };

  it("CONFIRMED + vendorStatus=null 주문 dispatch → 200 + PENDING_VENDOR 전이 + Zalo 발주", async () => {
    soFindUnique.mockReset();
    soFindUnique.mockResolvedValue(dispatchOrder);
    soUpdateMany.mockResolvedValue({ count: 1 });
    catalogFindUnique.mockResolvedValue({ nameKo: "과일바구니" });

    const res = await DISPATCH(new Request("http://local/x", { method: "POST" }), {
      params: Promise.resolve({ id: "so-1" }),
    });
    expect(res.status).toBe(200);
    expect(soUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "so-1", status: "CONFIRMED", vendorStatus: null },
        data: expect.objectContaining({ vendorStatus: "PENDING_VENDOR" }),
      })
    );
    expect(sendVendorPoNotifications).toHaveBeenCalledOnce();
  });

  it("CONFIRMED + VENDOR_ACCEPTED(발주 살아있음)는 재발주 불가 — 409 CANNOT_DISPATCH", async () => {
    soFindUnique.mockReset();
    soFindUnique.mockResolvedValue({ ...dispatchOrder, vendorStatus: "VENDOR_ACCEPTED" });

    const res = await DISPATCH(new Request("http://local/x", { method: "POST" }), {
      params: Promise.resolve({ id: "so-1" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "CANNOT_DISPATCH" });
    expect(sendVendorPoNotifications).not.toHaveBeenCalled();
  });
});
