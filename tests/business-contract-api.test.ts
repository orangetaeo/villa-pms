import { beforeEach, describe, expect, it, vi } from "vitest";

// 사업 계약서 API 가드·스코프·전이 검증. 핸들러 직접호출 + prisma/auth mock.
// 렌더(lib/business-contract)는 실구현 사용(정본 md fs 로드) — 서명 성공 경로에서 실제 치환 검증.

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/security-event", () => ({ recordSecurityEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/storage", () => ({
  savePassportFile: vi.fn(async () => ({ fileName: "sig-1700000000000-usr1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png" })),
  isAllowedImageMime: (m: string) => m === "image/png",
}));

const bc = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
};
const user = {
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    businessContract: {
      findMany: (...a: unknown[]) => bc.findMany(...a),
      findFirst: (...a: unknown[]) => bc.findFirst(...a),
      findUnique: (...a: unknown[]) => bc.findUnique(...a),
      create: (...a: unknown[]) => bc.create(...a),
      update: (...a: unknown[]) => bc.update(...a),
      updateMany: (...a: unknown[]) => bc.updateMany(...a),
    },
    user: {
      findFirst: (...a: unknown[]) => user.findFirst(...a),
      findUnique: (...a: unknown[]) => user.findUnique(...a),
      findMany: (...a: unknown[]) => user.findMany(...a),
    },
  },
}));

import { GET as adminList, POST as adminCreate } from "@/app/api/admin/business-contracts/route";
import { PATCH } from "@/app/api/admin/business-contracts/[id]/route";
import { POST as sendRoute } from "@/app/api/admin/business-contracts/[id]/send/route";
import { POST as voidRoute } from "@/app/api/admin/business-contracts/[id]/void/route";
import { GET as mine } from "@/app/api/business-contracts/mine/route";
import { POST as sign } from "@/app/api/business-contracts/[id]/sign/route";

const OWNER = { user: { id: "owner1", role: "OWNER" } };
const STAFF = { user: { id: "staff1", role: "STAFF" } };
const SUPPLIER = { user: { id: "sup1", role: "SUPPLIER" } };

const P = (id: string) => ({ params: Promise.resolve({ id }) });
const jreq = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  mockAuth.mockReset();
  Object.values(bc).forEach((f) => f.mockReset());
  Object.values(user).forEach((f) => f.mockReset());
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ADMIN POST /business-contracts (생성)", () => {
  it("비운영자(STAFF)는 403", async () => {
    mockAuth.mockResolvedValue(STAFF);
    const res = await adminCreate(jreq("http://x/api/admin/business-contracts", "POST", {
      counterpartId: "sup1", locale: "vi", terms: {},
    }));
    expect(res.status).toBe(403);
  });

  it("counterpart SUPPLIER → VILLA_SUPPLY 자동 결정·생성(201)", async () => {
    mockAuth.mockResolvedValue(OWNER);
    user.findFirst.mockResolvedValue({ id: "sup1", role: "SUPPLIER" });
    bc.findFirst.mockResolvedValue(null); // 중복 없음
    bc.create.mockResolvedValue({ id: "c1" });
    const res = await adminCreate(jreq("http://x/api/admin/business-contracts", "POST", {
      counterpartId: "sup1",
      locale: "vi",
      terms: { companyName: "빌라고", companyPassport: "M1", payMethod: "CASH" },
    }));
    expect(res.status).toBe(201);
    expect(bc.create).toHaveBeenCalled();
    const arg = bc.create.mock.calls[0][0];
    expect(arg.data.type).toBe("VILLA_SUPPLY");
    expect(arg.data.status).toBe("DRAFT");
  });

  it("role 불일치(counterpart=OWNER)는 400", async () => {
    mockAuth.mockResolvedValue(OWNER);
    user.findFirst.mockResolvedValue({ id: "o2", role: "OWNER" });
    const res = await adminCreate(jreq("http://x/api/admin/business-contracts", "POST", {
      counterpartId: "o2", locale: "ko", terms: { companyName: "c", companyPassport: "p", partnerCompany: "여행사", partnerRep: "김", partnerContact: "010" },
    }));
    expect(res.status).toBe(400);
  });

  it("파트너에 vi locale 요청은 400(파트너=ko만)", async () => {
    mockAuth.mockResolvedValue(OWNER);
    user.findFirst.mockResolvedValue({ id: "pt1", role: "PARTNER" });
    const res = await adminCreate(jreq("http://x/api/admin/business-contracts", "POST", {
      counterpartId: "pt1", locale: "vi", terms: { companyName: "c", companyPassport: "p", partnerCompany: "여행사", partnerRep: "김", partnerContact: "010" },
    }));
    expect(res.status).toBe(400);
  });

  it("termsJson에 원가/마진 키(누수)는 400", async () => {
    mockAuth.mockResolvedValue(OWNER);
    user.findFirst.mockResolvedValue({ id: "sup1", role: "SUPPLIER" });
    const res = await adminCreate(jreq("http://x/api/admin/business-contracts", "POST", {
      counterpartId: "sup1", locale: "vi",
      terms: { companyName: "빌라고", companyPassport: "M1", payMethod: "CASH", salePriceKrw: 100000 },
    }));
    expect(res.status).toBe(400);
  });

  it("이미 DRAFT/SENT 존재 시 409(ACTIVE), SIGNED 존재 시 409(SIGNED)", async () => {
    mockAuth.mockResolvedValue(OWNER);
    user.findFirst.mockResolvedValue({ id: "sup1", role: "SUPPLIER" });
    const terms = { companyName: "빌라고", companyPassport: "M1", payMethod: "CASH" };

    bc.findFirst.mockResolvedValueOnce({ id: "c0", status: "SENT" });
    let res = await adminCreate(jreq("http://x", "POST", { counterpartId: "sup1", locale: "vi", terms }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ACTIVE_CONTRACT_EXISTS");

    bc.findFirst.mockResolvedValueOnce({ id: "cS", status: "SIGNED" });
    res = await adminCreate(jreq("http://x", "POST", { counterpartId: "sup1", locale: "vi", terms }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("SIGNED_CONTRACT_EXISTS");
  });
});

describe("ADMIN PATCH (DRAFT만 수정)", () => {
  it("DRAFT는 수정 가능", async () => {
    mockAuth.mockResolvedValue(OWNER);
    bc.findUnique.mockResolvedValue({ id: "c1", type: "VILLA_SUPPLY", status: "DRAFT", locale: "vi" });
    bc.update.mockResolvedValue({});
    const res = await PATCH(jreq("http://x", "PATCH", { locale: "ko" }), P("c1"));
    expect(res.status).toBe(200);
  });

  it("SENT/SIGNED는 409(봉인)", async () => {
    mockAuth.mockResolvedValue(OWNER);
    bc.findUnique.mockResolvedValue({ id: "c1", type: "VILLA_SUPPLY", status: "SENT", locale: "vi" });
    const res = await PATCH(jreq("http://x", "PATCH", { locale: "ko" }), P("c1"));
    expect(res.status).toBe(409);
  });
});

describe("ADMIN send / void (전이)", () => {
  it("send: DRAFT→SENT (원자 전이 count 1)", async () => {
    mockAuth.mockResolvedValue(OWNER);
    bc.findUnique.mockResolvedValue({ id: "c1", status: "DRAFT" });
    bc.updateMany.mockResolvedValue({ count: 1 });
    const res = await sendRoute(jreq("http://x", "POST"), P("c1"));
    expect(res.status).toBe(200);
  });

  it("send: 이미 SENT면 409", async () => {
    mockAuth.mockResolvedValue(OWNER);
    bc.findUnique.mockResolvedValue({ id: "c1", status: "SENT" });
    const res = await sendRoute(jreq("http://x", "POST"), P("c1"));
    expect(res.status).toBe(409);
  });

  it("void: SIGNED도 VOID로", async () => {
    mockAuth.mockResolvedValue(OWNER);
    bc.findUnique.mockResolvedValue({ id: "c1", status: "SIGNED" });
    bc.update.mockResolvedValue({});
    const res = await voidRoute(jreq("http://x", "POST"), P("c1"));
    expect(res.status).toBe(200);
    expect(bc.update.mock.calls[0][0].data.status).toBe("VOID");
  });
});

describe("상대방 GET /business-contracts/mine (스코프·SENT 게이트)", () => {
  it("운영자는 403(자기 계약 개념 없음)", async () => {
    mockAuth.mockResolvedValue(OWNER);
    const res = await mine(jreq("http://x/api/business-contracts/mine", "GET"));
    expect(res.status).toBe(403);
  });

  it("SUPPLIER는 counterpartId=자기 + SENT|SIGNED만 조회(where 강제)", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findMany.mockResolvedValue([]);
    user.findUnique.mockResolvedValue({ name: "A", phone: "090", zaloContact: null });
    const res = await mine(jreq("http://x/api/business-contracts/mine", "GET"));
    expect(res.status).toBe(200);
    const where = bc.findMany.mock.calls[0][0].where;
    expect(where.counterpartId).toBe("sup1");
    expect(where.status).toEqual({ in: ["SENT", "SIGNED"] });
  });
});

describe("상대방 POST /business-contracts/[id]/sign (스코프·멱등·레이스)", () => {
  const signReq = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set("signature", new File([new Uint8Array([1, 2, 3])], "sig.png", { type: "image/png" }));
    return new Request("http://x/api/business-contracts/c1/sign", { method: "POST", body: fd });
  };

  it("타인/미존재 계약은 404", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findFirst.mockResolvedValue(null);
    const res = await sign(signReq({ signName: "A", idNumber: "1", address: "addr" }), P("c1"));
    expect(res.status).toBe(404);
  });

  it("운영자 role은 403(상대방 전용)", async () => {
    mockAuth.mockResolvedValue(OWNER);
    const res = await sign(signReq({ signName: "A", idNumber: "1", address: "addr" }), P("c1"));
    expect(res.status).toBe(403);
  });

  it("이미 SIGNED면 멱등 409", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findFirst.mockResolvedValue({ id: "c1", type: "VILLA_SUPPLY", locale: "vi", status: "SIGNED", termsJson: {} });
    const res = await sign(signReq({ signName: "A", idNumber: "1", address: "addr" }), P("c1"));
    expect(res.status).toBe(409);
  });

  it("DRAFT(미발송)은 서명 불가 409", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findFirst.mockResolvedValue({ id: "c1", type: "VILLA_SUPPLY", locale: "vi", status: "DRAFT", termsJson: {} });
    const res = await sign(signReq({ signName: "A", idNumber: "1", address: "addr" }), P("c1"));
    expect(res.status).toBe(409);
  });

  it("SENT 정상 서명 → 200 + SIGNED 전이(where status:SENT)·contentHash 저장", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findFirst.mockResolvedValue({
      id: "c1",
      type: "VILLA_SUPPLY",
      locale: "vi",
      status: "SENT",
      termsJson: { companyName: "빌라고", companyPassport: "M1", payMethod: "CASH", cancelFreeDays: 14, cancelPartialPct: 50 },
    });
    user.findUnique.mockResolvedValue({ name: "Nguyen", phone: "090", zaloContact: null });
    bc.updateMany.mockResolvedValue({ count: 1 });
    const res = await sign(signReq({ signName: "Nguyen", idNumber: "012345", address: "Phu Quoc" }), P("c1"));
    expect(res.status).toBe(200);
    const upd = bc.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "c1", status: "SENT" });
    expect(upd.data.status).toBe("SIGNED");
    expect(upd.data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(upd.data.counterpartAddress).toBe("Phu Quoc");
  });

  it("동시 서명 레이스: updateMany count 0 → 409", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findFirst.mockResolvedValue({
      id: "c1", type: "VILLA_SUPPLY", locale: "vi", status: "SENT",
      termsJson: { companyName: "빌라고", companyPassport: "M1", payMethod: "CASH", cancelFreeDays: 14, cancelPartialPct: 50 },
    });
    user.findUnique.mockResolvedValue({ name: "Nguyen", phone: "090", zaloContact: null });
    bc.updateMany.mockResolvedValue({ count: 0 });
    const res = await sign(signReq({ signName: "Nguyen", idNumber: "012345", address: "Phu Quoc" }), P("c1"));
    expect(res.status).toBe(409);
  });

  it("서명 입력에 {{ 주입은 400", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findFirst.mockResolvedValue({
      id: "c1", type: "VILLA_SUPPLY", locale: "vi", status: "SENT",
      termsJson: { companyName: "빌라고", companyPassport: "M1", payMethod: "CASH" },
    });
    const res = await sign(signReq({ signName: "A {{signDate}}", idNumber: "1", address: "addr" }), P("c1"));
    expect(res.status).toBe(400);
  });
});
