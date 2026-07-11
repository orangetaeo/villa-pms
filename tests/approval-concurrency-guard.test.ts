// 파트너·원천 공급자 자가가입 승인/거절 동시성 가드 회귀 테스트
//   두 라우트(partners·vendors approval PATCH)는 읽은 approvalStatus 위에서 전이를 판정한 뒤
//   updateMany({where:{ approvalStatus: 읽은상태 }}) 로 DB 레벨 재확인한다. 읽기~쓰기 사이 다른 요청이
//   상태를 바꿔 count!==1 이면 409 CONCURRENT_MODIFICATION 으로 막고, 감사로그도 남기지 않는다.
//   정상 전이(승인·반려)는 200 + 감사로그. 승인/반려 방향은 현행대로 읽은 상태에서 무조건 허용.
import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));

const partnerFindUnique = vi.fn();
const partnerUpdateMany = vi.fn();
const vendorFindUnique = vi.fn();
const vendorUpdateMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    partner: {
      findUnique: (...a: unknown[]) => partnerFindUnique(...a),
      updateMany: (...a: unknown[]) => partnerUpdateMany(...a),
    },
    serviceVendor: {
      findUnique: (...a: unknown[]) => vendorFindUnique(...a),
      updateMany: (...a: unknown[]) => vendorUpdateMany(...a),
    },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

import { PATCH as PARTNER_PATCH } from "@/app/api/partners/[id]/approval/route";
import { PATCH as VENDOR_PATCH } from "@/app/api/vendors/[id]/approval/route";

const OWNER = { user: { id: "owner-1", role: "OWNER" } };

const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue(OWNER);
});

describe("partners approval 동시성 가드", () => {
  beforeEach(() => {
    partnerFindUnique.mockResolvedValue({ id: "p-1", approvalStatus: "PENDING_APPROVAL" });
  });

  it("정상 승인은 200 + 감사로그, where에 읽은 approvalStatus 가드", async () => {
    partnerUpdateMany.mockResolvedValue({ count: 1 });
    const res = await PARTNER_PATCH(jsonReq({ action: "APPROVE" }), {
      params: Promise.resolve({ id: "p-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "p-1", approvalStatus: "APPROVED" });
    expect(partnerUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p-1", approvalStatus: "PENDING_APPROVAL" },
        data: expect.objectContaining({ approvalStatus: "APPROVED", rejectionReason: null }),
      })
    );
    expect(writeAuditLog).toHaveBeenCalledOnce();
  });

  it("정상 반려는 200 + rejectionReason 데이터", async () => {
    partnerUpdateMany.mockResolvedValue({ count: 1 });
    const res = await PARTNER_PATCH(jsonReq({ action: "REJECT", rejectionReason: "서류 미비" }), {
      params: Promise.resolve({ id: "p-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "p-1", approvalStatus: "REJECTED" });
    expect(partnerUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvalStatus: "REJECTED", rejectionReason: "서류 미비" }),
      })
    );
    expect(writeAuditLog).toHaveBeenCalledOnce();
  });

  it("읽기~쓰기 사이 상태가 바뀌어 count===0 이면 409, 감사로그 없음", async () => {
    partnerUpdateMany.mockResolvedValue({ count: 0 }); // 다른 요청이 먼저 전이시킴
    const res = await PARTNER_PATCH(jsonReq({ action: "APPROVE" }), {
      params: Promise.resolve({ id: "p-1" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "CONCURRENT_MODIFICATION" });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("없는 파트너는 404 (updateMany 미호출)", async () => {
    partnerFindUnique.mockResolvedValue(null);
    const res = await PARTNER_PATCH(jsonReq({ action: "APPROVE" }), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
    expect(partnerUpdateMany).not.toHaveBeenCalled();
  });
});

describe("vendors approval 동시성 가드", () => {
  beforeEach(() => {
    vendorFindUnique.mockResolvedValue({ id: "v-1", approvalStatus: "PENDING_APPROVAL" });
  });

  it("정상 승인은 200 + 감사로그, where에 읽은 approvalStatus 가드", async () => {
    vendorUpdateMany.mockResolvedValue({ count: 1 });
    const res = await VENDOR_PATCH(jsonReq({ action: "APPROVE" }), {
      params: Promise.resolve({ id: "v-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "v-1", approvalStatus: "APPROVED" });
    expect(vendorUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "v-1", approvalStatus: "PENDING_APPROVAL" },
        data: expect.objectContaining({ approvalStatus: "APPROVED", rejectionReason: null }),
      })
    );
    expect(writeAuditLog).toHaveBeenCalledOnce();
  });

  it("반려 후 재승인(REJECTED→APPROVED)도 읽은 상태 가드로 허용 (현행 전이 방향 보존)", async () => {
    vendorFindUnique.mockResolvedValue({ id: "v-1", approvalStatus: "REJECTED" });
    vendorUpdateMany.mockResolvedValue({ count: 1 });
    const res = await VENDOR_PATCH(jsonReq({ action: "APPROVE" }), {
      params: Promise.resolve({ id: "v-1" }),
    });
    expect(res.status).toBe(200);
    expect(vendorUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "v-1", approvalStatus: "REJECTED" } })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          approvalStatus: { old: "REJECTED", new: "APPROVED" },
        }),
      })
    );
  });

  it("읽기~쓰기 사이 상태가 바뀌어 count===0 이면 409, 감사로그 없음", async () => {
    vendorUpdateMany.mockResolvedValue({ count: 0 });
    const res = await VENDOR_PATCH(jsonReq({ action: "REJECT" }), {
      params: Promise.resolve({ id: "v-1" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "CONCURRENT_MODIFICATION" });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("없는 공급자는 404 (updateMany 미호출)", async () => {
    vendorFindUnique.mockResolvedValue(null);
    const res = await VENDOR_PATCH(jsonReq({ action: "APPROVE" }), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
    expect(vendorUpdateMany).not.toHaveBeenCalled();
  });
});
