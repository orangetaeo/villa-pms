import { beforeEach, describe, expect, it, vi } from "vitest";

// 협의(네고) API 가드·스코프·전이 검증 (T-contract-negotiation S2).
// 핸들러 직접호출 + prisma/auth mock — business-contract-api.test.ts와 같은 방식.

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/security-event", () => ({ recordSecurityEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const notifyRequested = vi.fn(async () => {});
const notifyResolved = vi.fn(async () => {});
vi.mock("@/lib/contract-negotiation-notify", () => ({
  notifyOperatorsNegotiationRequested: (...a: unknown[]) => notifyRequested(...(a as [])),
  notifyCounterpartNegotiationResolved: (...a: unknown[]) => notifyResolved(...(a as [])),
}));

const bc = { findUnique: vi.fn(), update: vi.fn() };
const neg = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() };
const user = { findUnique: vi.fn() };

const txClient = {
  contractNegotiation: { updateMany: (...a: unknown[]) => neg.updateMany(...a) },
  businessContract: { update: (...a: unknown[]) => bc.update(...a) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    businessContract: {
      findUnique: (...a: unknown[]) => bc.findUnique(...a),
      update: (...a: unknown[]) => bc.update(...a),
    },
    contractNegotiation: {
      findFirst: (...a: unknown[]) => neg.findFirst(...a),
      findUnique: (...a: unknown[]) => neg.findUnique(...a),
      create: (...a: unknown[]) => neg.create(...a),
      updateMany: (...a: unknown[]) => neg.updateMany(...a),
    },
    user: { findUnique: (...a: unknown[]) => user.findUnique(...a) },
    $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient),
  },
}));

import { POST as createNegotiation } from "@/app/api/business-contracts/[id]/negotiations/route";
import { POST as resolveNegotiation } from "@/app/api/admin/business-contracts/[id]/negotiations/[negId]/route";
import { DEFAULT_CANCEL_TIERS } from "@/lib/cancel-tiers";

const OWNER = { user: { id: "owner1", role: "OWNER" } };
const SUPPLIER = { user: { id: "sup1", role: "SUPPLIER" } };
const OTHER_SUPPLIER = { user: { id: "sup2", role: "SUPPLIER" } };

const P = (id: string) => ({ params: Promise.resolve({ id }) });
const P2 = (id: string, negId: string) => ({ params: Promise.resolve({ id, negId }) });
const jreq = (method: string, body?: unknown) =>
  new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const SENT_CONTRACT = {
  id: "c1",
  type: "VILLA_SUPPLY",
  status: "SENT",
  locale: "vi",
  counterpartId: "sup1",
};

beforeEach(() => {
  mockAuth.mockReset();
  [notifyRequested, notifyResolved].forEach((f) => f.mockReset());
  [...Object.values(bc), ...Object.values(neg), ...Object.values(user)].forEach((f) => f.mockReset());
  user.findUnique.mockResolvedValue({ name: "Nguyen Van A" });
});

describe("POST /business-contracts/[id]/negotiations — 상대방 협의 요청", () => {
  it("본인 SENT 계약 + 프리셋 사유 → 201 + 운영자 통지", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findUnique.mockResolvedValue(SENT_CONTRACT);
    neg.findFirst.mockResolvedValue(null);
    neg.create.mockResolvedValue({
      id: "n1",
      clauseKey: "cancelTiers",
      reason: "CANCEL_PAY_RATE",
      status: "OPEN",
      createdAt: new Date(),
    });

    const res = await createNegotiation(
      jreq("POST", { clauseKey: "cancelTiers", reason: "CANCEL_PAY_RATE" }),
      P("c1"),
    );
    expect(res.status).toBe(201);
    expect(notifyRequested).toHaveBeenCalledTimes(1);
  });

  it("남의 계약 → 404 (존재 비노출)", async () => {
    mockAuth.mockResolvedValue(OTHER_SUPPLIER);
    bc.findUnique.mockResolvedValue(SENT_CONTRACT); // counterpartId=sup1 ≠ sup2
    const res = await createNegotiation(
      jreq("POST", { clauseKey: "cancelTiers", reason: "CANCEL_PAY_RATE" }),
      P("c1"),
    );
    expect(res.status).toBe(404);
    expect(neg.create).not.toHaveBeenCalled();
  });

  it("SIGNED 계약 → 409 (봉인 후 협의 불가)", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findUnique.mockResolvedValue({ ...SENT_CONTRACT, status: "SIGNED" });
    const res = await createNegotiation(
      jreq("POST", { clauseKey: "cancelTiers", reason: "CANCEL_PAY_RATE" }),
      P("c1"),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "NOT_NEGOTIABLE" });
  });

  it("같은 조항에 OPEN이 이미 있으면 409 (중복 스팸 차단)", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findUnique.mockResolvedValue(SENT_CONTRACT);
    neg.findFirst.mockResolvedValue({ id: "n0" });
    const res = await createNegotiation(
      jreq("POST", { clauseKey: "cancelTiers", reason: "CANCEL_PAY_RATE" }),
      P("c1"),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ALREADY_OPEN" });
  });

  it("계약 타입에 없는 조항 → 400", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findUnique.mockResolvedValue({ ...SENT_CONTRACT, type: "SERVICE_VENDOR" });
    const res = await createNegotiation(
      jreq("POST", { clauseKey: "cancelTiers", reason: "CANCEL_PAY_RATE" }),
      P("c1"),
    );
    expect(res.status).toBe(400);
  });

  it("★ 회사 손실 상한을 넘는 역제안 → 400", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    bc.findUnique.mockResolvedValue(SENT_CONTRACT);
    const bad = DEFAULT_CANCEL_TIERS.map((t, i) => (i === 1 ? { ...t, supplierPayPct: 30 } : t));
    const res = await createNegotiation(
      jreq("POST", { clauseKey: "cancelTiers", reason: "CANCEL_PAY_RATE", proposedTiers: bad }),
      P("c1"),
    );
    expect(res.status).toBe(400);
    expect(neg.create).not.toHaveBeenCalled();
  });

  it("운영자(OWNER)는 협의 요청 주체가 아님 → 403", async () => {
    mockAuth.mockResolvedValue(OWNER);
    const res = await createNegotiation(
      jreq("POST", { clauseKey: "cancelTiers", reason: "CANCEL_PAY_RATE" }),
      P("c1"),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /admin/.../negotiations/[negId] — 운영자 해소", () => {
  const OPEN_NEG = {
    id: "n1",
    contractId: "c1",
    clauseKey: "cancelTiers",
    status: "OPEN",
    createdById: "sup1",
  };
  const baseTerms = {
    companyName: "KIM HAKTAE",
    companyPassport: "M1",
    companyContactVn: "0799493138",
    payMethod: "CASH",
  };

  it("수용 + 조건 반영 → 계약 termsJson 갱신 + 상대방 통지", async () => {
    mockAuth.mockResolvedValue(OWNER);
    neg.findUnique.mockResolvedValue(OPEN_NEG);
    bc.findUnique.mockResolvedValue(SENT_CONTRACT);
    neg.updateMany.mockResolvedValue({ count: 1 });
    bc.update.mockResolvedValue({});

    const proposed = DEFAULT_CANCEL_TIERS.map((t, i) =>
      i === 1 ? { ...t, supplierPayPct: 30, guestRefundPct: 70 } : t,
    );
    const res = await resolveNegotiation(
      jreq("POST", { action: "ACCEPT", terms: { ...baseTerms, cancelTiers: proposed } }),
      P2("c1", "n1"),
    );
    expect(res.status).toBe(200);
    expect(bc.update).toHaveBeenCalledTimes(1);
    expect(notifyResolved).toHaveBeenCalledTimes(1);
  });

  it("★ 수용하려는 조건이 회사 손실이면 400 — 계약 미갱신", async () => {
    mockAuth.mockResolvedValue(OWNER);
    neg.findUnique.mockResolvedValue(OPEN_NEG);
    bc.findUnique.mockResolvedValue(SENT_CONTRACT);
    const bad = DEFAULT_CANCEL_TIERS.map((t, i) => (i === 1 ? { ...t, supplierPayPct: 30 } : t));
    const res = await resolveNegotiation(
      jreq("POST", { action: "ACCEPT", terms: { ...baseTerms, cancelTiers: bad } }),
      P2("c1", "n1"),
    );
    expect(res.status).toBe(400);
    expect(bc.update).not.toHaveBeenCalled();
    expect(neg.updateMany).not.toHaveBeenCalled();
  });

  it("SIGNED 계약의 조건은 수용으로도 바뀌지 않는다 → 409 (봉인)", async () => {
    mockAuth.mockResolvedValue(OWNER);
    neg.findUnique.mockResolvedValue(OPEN_NEG);
    bc.findUnique.mockResolvedValue({ ...SENT_CONTRACT, status: "SIGNED" });
    const res = await resolveNegotiation(
      jreq("POST", { action: "ACCEPT", terms: { ...baseTerms } }),
      P2("c1", "n1"),
    );
    expect(res.status).toBe(409);
    expect(bc.update).not.toHaveBeenCalled();
  });

  it("거절은 사유 필수 → 400", async () => {
    mockAuth.mockResolvedValue(OWNER);
    const res = await resolveNegotiation(jreq("POST", { action: "REJECT" }), P2("c1", "n1"));
    expect(res.status).toBe(400);
  });

  it("거절 + 사유 → 200, 조건 불변, 상대방 통지", async () => {
    mockAuth.mockResolvedValue(OWNER);
    neg.findUnique.mockResolvedValue(OPEN_NEG);
    bc.findUnique.mockResolvedValue(SENT_CONTRACT);
    neg.updateMany.mockResolvedValue({ count: 1 });
    const res = await resolveNegotiation(
      jreq("POST", { action: "REJECT", resolvedNote: "성수기 조건은 유지합니다" }),
      P2("c1", "n1"),
    );
    expect(res.status).toBe(200);
    expect(bc.update).not.toHaveBeenCalled();
    expect(notifyResolved).toHaveBeenCalledTimes(1);
  });

  it("이미 해소된 협의 → 409", async () => {
    mockAuth.mockResolvedValue(OWNER);
    neg.findUnique.mockResolvedValue({ ...OPEN_NEG, status: "ACCEPTED" });
    const res = await resolveNegotiation(jreq("POST", { action: "ACCEPT" }), P2("c1", "n1"));
    expect(res.status).toBe(409);
  });

  it("동시 해소 레이스(count=0) → 409, 조건 갱신도 롤백", async () => {
    mockAuth.mockResolvedValue(OWNER);
    neg.findUnique.mockResolvedValue(OPEN_NEG);
    bc.findUnique.mockResolvedValue(SENT_CONTRACT);
    neg.updateMany.mockResolvedValue({ count: 0 }); // 다른 운영자가 먼저 해소
    const res = await resolveNegotiation(
      jreq("POST", { action: "ACCEPT", terms: { ...baseTerms } }),
      P2("c1", "n1"),
    );
    expect(res.status).toBe(409);
    expect(bc.update).not.toHaveBeenCalled();
    expect(notifyResolved).not.toHaveBeenCalled();
  });

  it("협의 id가 다른 계약 소속이면 404 (교차 접근 차단)", async () => {
    mockAuth.mockResolvedValue(OWNER);
    neg.findUnique.mockResolvedValue({ ...OPEN_NEG, contractId: "cOTHER" });
    const res = await resolveNegotiation(jreq("POST", { action: "ACCEPT" }), P2("c1", "n1"));
    expect(res.status).toBe(404);
  });

  it("공급자는 해소 불가 → 403", async () => {
    mockAuth.mockResolvedValue(SUPPLIER);
    const res = await resolveNegotiation(jreq("POST", { action: "ACCEPT" }), P2("c1", "n1"));
    expect(res.status).toBe(403);
  });
});
