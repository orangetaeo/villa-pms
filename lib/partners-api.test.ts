import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/partners + /api/partners/[id] 라우트 테스트 (PARTNER-2)
 * auth·prisma·audit-log mock. 누수 가드 핵심: canViewFinance 외(STAFF·SUPPLIER) 차단.
 */

const mockAuth = vi.fn();
const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    partner: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import { writeAuditLog } from "@/lib/audit-log";
import { GET, POST } from "../app/api/partners/route";
import { GET as GET_ID, PATCH } from "../app/api/partners/[id]/route";

const samplePartner = {
  id: "p1",
  type: "TRAVEL_AGENCY",
  name: "A여행사",
  nameVi: null,
  contactPhone: null,
  contactZaloUid: null,
  contactEmail: null,
  creditTier: "B",
  creditLimitVnd: 10_000_000n,
  depositRatePct: 30,
  paymentTermDays: 30,
  billingCycle: "MONTHLY",
  status: "ACTIVE",
  contractUrl: null,
  memo: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
};

const postReq = (body: unknown) =>
  new Request("http://local/api/partners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const patchReq = (body: unknown) =>
  PATCH(
    new Request("http://local/api/partners/p1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "p1" }) }
  );

const getIdReq = () =>
  GET_ID(new Request("http://local/api/partners/p1"), {
    params: Promise.resolve({ id: "p1" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([{ ...samplePartner, receivables: [], _count: { bookings: 0 } }]);
  mockFindUnique.mockResolvedValue({
    ...samplePartner,
    receivables: [],
    bookings: [],
    _count: { bookings: 0 },
  });
  mockCreate.mockResolvedValue({ ...samplePartner, id: "p2" });
  mockUpdate.mockResolvedValue({ ...samplePartner, creditLimitVnd: 20_000_000n });
});

describe("GET /api/partners — 누수 가드", () => {
  it("비로그인 → 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it("STAFF → 403 (재무 비노출)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "STAFF" } });
    expect((await GET()).status).toBe(403);
  });
  it("SUPPLIER → 403 (마진·미수 비노출)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "SUPPLIER" } });
    expect((await GET()).status).toBe(403);
  });
  it("ADMIN → 200, BigInt는 문자열로 직렬화", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.partners[0].partner.creditLimitVnd).toBe("10000000");
    expect(json.partners[0].outstandingVnd).toBe("0");
  });
});

describe("POST /api/partners", () => {
  it("STAFF → 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "STAFF" } });
    expect((await POST(postReq({ type: "TRAVEL_AGENCY", name: "X" }))).status).toBe(403);
  });
  it("잘못된 body → 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    const res = await POST(postReq({ name: "이름없음타입" }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
  it("creditLimitVnd 비숫자 → 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    const res = await POST(
      postReq({ type: "LAND_AGENCY", name: "랜드", creditLimitVnd: "1,000" })
    );
    expect(res.status).toBe(400);
  });
  it("OWNER 생성 → 201 + BigInt 변환 + AuditLog", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner1", role: "OWNER" } });
    const res = await POST(
      postReq({
        type: "TRAVEL_AGENCY",
        name: "신규여행사",
        creditTier: "B",
        creditLimitVnd: "5000000",
        depositRatePct: 30,
        paymentTermDays: 30,
      })
    );
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ creditLimitVnd: 5_000_000n, depositRatePct: 30 }),
      })
    );
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATE", entity: "Partner" })
    );
  });
});

describe("GET /api/partners/[id]", () => {
  it("SUPPLIER → 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "SUPPLIER" } });
    expect((await getIdReq()).status).toBe(403);
  });
  it("없는 파트너 → 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    mockFindUnique.mockResolvedValue(null);
    expect((await getIdReq()).status).toBe(404);
  });
  it("ADMIN → 200 상세(직렬화)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "ADMIN" } });
    const res = await getIdReq();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.partner.partner.id).toBe("p1");
    expect(json.partner.outstandingVnd).toBe("0");
  });
});

describe("PATCH /api/partners/[id]", () => {
  it("STAFF → 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u", role: "STAFF" } });
    expect((await patchReq({ name: "x" })).status).toBe(403);
  });
  it("없는 파트너 → 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    mockFindUnique.mockResolvedValue(null);
    expect((await patchReq({ name: "x" })).status).toBe(404);
  });
  it("신용한도 변경 → 200 + AuditLog(old/new)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner1", role: "OWNER" } });
    const res = await patchReq({ creditLimitVnd: "20000000" });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ creditLimitVnd: 20_000_000n }),
      })
    );
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "UPDATE",
        entity: "Partner",
        changes: expect.objectContaining({
          creditLimitVnd: { old: "10000000", new: "20000000" },
        }),
      })
    );
  });
  it("빈 body → 400 (수정 필드 없음)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "OWNER" } });
    expect((await patchReq({})).status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // 신용한도·등급 변경 OWNER 전용화 (QA Minor — 위험통제 마스터)
  it("MANAGER가 신용한도 실변경 시도 → 403, update 미호출", async () => {
    mockAuth.mockResolvedValue({ user: { id: "m", role: "MANAGER" } });
    const res = await patchReq({ creditLimitVnd: "20000000" }); // 기존 10M → 변경
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("CREDIT_FIELDS_OWNER_ONLY");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("MANAGER가 등급 실변경 시도 → 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "m", role: "MANAGER" } });
    const res = await patchReq({ creditTier: "C" }); // 기존 B → 변경
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it("MANAGER가 연락처만 수정(신용 미변경) → 200", async () => {
    mockAuth.mockResolvedValue({ user: { id: "m", role: "MANAGER" } });
    const res = await patchReq({ contactPhone: "0900000000" });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });
  it("MANAGER가 신용 필드 동일값 재전송(폼 전체 전송) → 200, 차단 안 함", async () => {
    mockAuth.mockResolvedValue({ user: { id: "m", role: "MANAGER" } });
    // 기존값과 동일(10M, B) + 다른 필드 변경 → 실변경 아님 → 통과
    const res = await patchReq({ creditLimitVnd: "10000000", creditTier: "B", memo: "메모" });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });
  it("OWNER는 신용한도 변경 가능 → 200", async () => {
    mockAuth.mockResolvedValue({ user: { id: "owner1", role: "OWNER" } });
    const res = await patchReq({ creditLimitVnd: "20000000" });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();
  });
});
