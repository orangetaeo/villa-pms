// 벤더 시간 제안 — 소비자 승인/거절 + 운영자 apply 자동확정 + 재제안 리셋 (ADR-0035)
//   - 게스트 accept: serviceDate/Time 교체 + status REQUESTED→CONFIRMED 원자 + outcome APPLIED, 벤더 통보(applied)
//   - 게스트 decline: outcome DECLINED + vendorStatus VENDOR_ACCEPTED→PENDING_VENDOR 복귀, 벤더 통보(declinedByGuest)
//   - 가드: 타 토큰/미제안/기해결/취소 → 404/409, 동시성 updateMany count=0 → 409
//   - 운영자 apply(GUEST)=CONFIRMED 동반 + outcome, 벤더 재제안 시 outcome/respondedAt null 리셋
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── prisma mock ──
const tokenFindUnique = vi.fn();
const soFindFirst = vi.fn();
const soFindUnique = vi.fn();
const soUpdateMany = vi.fn();
const catalogFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: { findUnique: (...a: unknown[]) => tokenFindUnique(...a) },
    serviceOrder: {
      findFirst: (...a: unknown[]) => soFindFirst(...a),
      findUnique: (...a: unknown[]) => soFindUnique(...a),
      updateMany: (...a: unknown[]) => soUpdateMany(...a),
    },
    serviceCatalogItem: { findUnique: (...a: unknown[]) => catalogFindUnique(...a) },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

vi.mock("@/lib/guest-checkin", () => ({ guestTokenState: () => "OK" }));
vi.mock("@/lib/guest-rate-limit", () => ({ guestRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/csrf", () => ({ assertSameOrigin: vi.fn(async () => null) }));

// 알림 — 스파이. 문구 빌더는 순수하므로 간단 스텁.
const enqueueInAppNotification = vi.fn((..._a: unknown[]) => Promise.resolve({}));
const enqueueInAppForOperators = vi.fn((..._a: unknown[]) => Promise.resolve(undefined));
vi.mock("@/lib/inapp-notification", () => ({
  enqueueInAppNotification: (...a: unknown[]) => enqueueInAppNotification(...a),
  enqueueInAppForOperators: (...a: unknown[]) => enqueueInAppForOperators(...a),
  buildVendorNotifText: (type: string) => ({ title: `t:${type}`, body: "b" }),
  buildAdminNotifText: (kind: string) => ({ title: `a:${kind}`, body: "b" }),
  vendorNotifLocale: () => "vi",
}));

const enqueueNotification = vi.fn((..._a: unknown[]) => Promise.resolve({}));
vi.mock("@/lib/zalo", () => ({ enqueueNotification: (...a: unknown[]) => enqueueNotification(...a) }));

vi.mock("@/lib/date-vn", () => ({
  toDateOnlyString: (d: Date) => (d ? new Date(d).toISOString().slice(0, 10) : null),
  parseUtcDateOnly: (s: string) => new Date(`${s}T00:00:00.000Z`),
}));

// api-guard — 게스트 라우트는 안 쓰지만 apply-proposal(requireCapability)·respond(requireAuth) 공용.
vi.mock("@/lib/api-guard", () => ({
  requireCapability: vi.fn(async () => ({ ok: true, session: { user: { id: "op-1" } } })),
  requireAuth: vi.fn(async () => ({ ok: true, session: { user: { id: "vu-1", role: "VENDOR" } } })),
}));
vi.mock("@/lib/permissions", () => ({
  isOperator: vi.fn(() => true),
  isVendor: () => true,
  OPERATOR_ROLES: ["OWNER", "MANAGER"],
}));
vi.mock("@/lib/vendor-auth", () => ({ getVendorIdForUser: vi.fn(async () => "v-1") }));
vi.mock("@/lib/vendor-order", () => {
  class InvalidVendorResponseError extends Error {}
  return { assertVendorResponse: vi.fn(() => undefined), InvalidVendorResponseError };
});
const sendVendorResponseOperatorNotifications = vi.fn((..._a: unknown[]) => Promise.resolve(undefined));
vi.mock("@/lib/vendor-dispatch", () => ({
  sendVendorResponseOperatorNotifications: (...a: unknown[]) =>
    sendVendorResponseOperatorNotifications(...a),
}));

import { POST as PROPOSAL } from "@/app/api/g/[token]/service-orders/[id]/proposal/route";
import { POST as APPLY } from "@/app/api/service-orders/[id]/apply-proposal/route";
import { POST as RESPOND } from "@/app/api/vendor/orders/[id]/respond/route";

const jsonReq = (body: unknown) =>
  new Request("http://local/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const gparams = (id = "so-1") => ({ params: Promise.resolve({ token: "tok", id }) });
const aparams = (id = "so-1") => ({ params: Promise.resolve({ id }) });

const vendorRel = { userId: "vu-1", user: { zaloUserId: "z-1", locale: "vi" } };
const baseOrder = {
  id: "so-1",
  status: "REQUESTED",
  vendorStatus: "VENDOR_ACCEPTED",
  serviceDate: new Date("2026-08-01T00:00:00Z"),
  serviceTime: "10:00",
  proposedServiceDate: new Date("2026-08-05T00:00:00Z"),
  proposedServiceTime: "15:00",
  vendorProposalRespondedAt: null,
  catalogItemId: "ci-1",
  vendorName: null,
  bookingId: "bk-1",
  vendor: vendorRel,
  booking: { villa: { name: "Villa A" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  tokenFindUnique.mockResolvedValue({
    bookingId: "bk-1",
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null,
  });
  catalogFindUnique.mockResolvedValue({ nameKo: "마사지" });
});

describe("게스트 시간 제안 응답 — accept", () => {
  it("제안 일정 교체 + status CONFIRMED 원자 + outcome APPLIED + 벤더 applied 통보", async () => {
    soFindFirst.mockResolvedValue({ ...baseOrder });
    soUpdateMany.mockResolvedValue({ count: 1 });

    const res = await PROPOSAL(jsonReq({ action: "accept" }), gparams());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: true, status: "CONFIRMED" });

    const upd = soUpdateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // 동시성 가드 — respondedAt null + status REQUESTED 스냅샷
    expect(upd.where).toMatchObject({ vendorProposalRespondedAt: null, status: "REQUESTED" });
    expect(upd.data).toMatchObject({
      status: "CONFIRMED",
      vendorProposalOutcome: "APPLIED",
      serviceTime: "15:00",
    });
    // 벤더 통보: 인앱 APPLIED + Zalo applied:true
    expect(enqueueInAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "VENDOR_PROPOSAL_APPLIED" })
    );
    const zaloArg = enqueueNotification.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(zaloArg.payload).toMatchObject({ applied: true });
    expect(zaloArg.payload).not.toHaveProperty("declinedByGuest");
    // 운영자 인앱 정보 알림
    expect(enqueueInAppForOperators).toHaveBeenCalledOnce();
  });
});

describe("게스트 시간 제안 응답 — decline", () => {
  it("outcome DECLINED + vendorStatus PENDING_VENDOR 복귀 + 벤더 declinedByGuest 통보", async () => {
    soFindFirst.mockResolvedValue({ ...baseOrder });
    soUpdateMany.mockResolvedValue({ count: 1 });

    const res = await PROPOSAL(jsonReq({ action: "decline" }), gparams());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: false });

    const upd = soUpdateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // ★비원자 방지 — where에 status=REQUESTED 필수(운영자 동시 취소 레이스를 DB가 판정, accept와 대칭)
    expect(upd.where).toMatchObject({
      vendorProposalRespondedAt: null,
      vendorStatus: "VENDOR_ACCEPTED",
      status: "REQUESTED",
    });
    expect(upd.data).toMatchObject({ vendorStatus: "PENDING_VENDOR", vendorProposalOutcome: "DECLINED" });
    // 상태는 그대로(교체 없음)
    expect(upd.data).not.toHaveProperty("status");

    expect(enqueueInAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "VENDOR_PROPOSAL_DECLINED" })
    );
    const zaloArg = enqueueNotification.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(zaloArg.payload).toMatchObject({ applied: false, declinedByGuest: true });
    // 거절 통보 일정은 원래 시간(복귀값)
    expect(zaloArg.payload).toMatchObject({ serviceDate: "2026-08-01", serviceTime: "10:00" });
  });
});

describe("게스트 시간 제안 응답 — 가드", () => {
  it("타 토큰/타 예약 주문(findFirst null) → 404", async () => {
    soFindFirst.mockResolvedValue(null);
    const res = await PROPOSAL(jsonReq({ action: "accept" }), gparams());
    expect(res.status).toBe(404);
    expect(soUpdateMany).not.toHaveBeenCalled();
  });

  it("제안 없음(proposedServiceDate null) → 409 NO_PROPOSAL", async () => {
    soFindFirst.mockResolvedValue({ ...baseOrder, proposedServiceDate: null });
    const res = await PROPOSAL(jsonReq({ action: "accept" }), gparams());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "NO_PROPOSAL" });
  });

  it("이미 해결(respondedAt 존재) → 409 ALREADY_RESOLVED", async () => {
    soFindFirst.mockResolvedValue({ ...baseOrder, vendorProposalRespondedAt: new Date() });
    const res = await PROPOSAL(jsonReq({ action: "accept" }), gparams());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ALREADY_RESOLVED" });
  });

  it("취소된 주문 → 409", async () => {
    soFindFirst.mockResolvedValue({ ...baseOrder, status: "CANCELLED" });
    const res = await PROPOSAL(jsonReq({ action: "accept" }), gparams());
    expect(res.status).toBe(409);
  });

  it("동시성 — updateMany count=0(운영자 apply 선점) → 409", async () => {
    soFindFirst.mockResolvedValue({ ...baseOrder });
    soUpdateMany.mockResolvedValue({ count: 0 });
    const res = await PROPOSAL(jsonReq({ action: "accept" }), gparams());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ALREADY_RESOLVED" });
    // count=0이면 통보 없음
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it("decline 비원자 방지 — 운영자가 그 사이 취소(status만 변경)해 count=0 → 409, 유령 통보 없음", async () => {
    // findFirst 시점엔 REQUESTED였지만, updateMany 직전 운영자 취소로 status=CANCELLED가 되면
    //   where의 status:"REQUESTED" 가드로 0건 → 409(CANCELLED 주문에 PENDING_VENDOR+DECLINED 덧씌움·통보 차단).
    soFindFirst.mockResolvedValue({ ...baseOrder });
    soUpdateMany.mockResolvedValue({ count: 0 });
    const res = await PROPOSAL(jsonReq({ action: "decline" }), gparams());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ALREADY_RESOLVED" });
    expect(enqueueNotification).not.toHaveBeenCalled();
    expect(enqueueInAppNotification).not.toHaveBeenCalled();
  });
});

describe("운영자 apply-proposal — GUEST 자동확정 + outcome", () => {
  const applyOrder = {
    id: "so-1",
    serviceDate: new Date("2026-08-01T00:00:00Z"),
    serviceTime: "10:00",
    proposedServiceDate: new Date("2026-08-05T00:00:00Z"),
    proposedServiceTime: "15:00",
    vendorProposalRespondedAt: null,
    requestedVia: "GUEST",
    status: "REQUESTED",
    vendorStatus: "VENDOR_ACCEPTED",
    quantity: 1,
    catalogItemId: "ci-1",
    vendorName: null,
    vendor: vendorRel,
    booking: { villa: { name: "Villa A" } },
  };

  it("apply=true·GUEST·REQUESTED → status CONFIRMED 동반 + outcome APPLIED + where status 가드", async () => {
    soFindUnique.mockResolvedValue({ ...applyOrder });
    soUpdateMany.mockResolvedValue({ count: 1 });

    const res = await APPLY(jsonReq({ apply: true }), aparams());
    expect(res.status).toBe(200);
    const upd = soUpdateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(upd.where).toMatchObject({ vendorProposalRespondedAt: null, status: "REQUESTED" });
    expect(upd.data).toMatchObject({ status: "CONFIRMED", vendorProposalOutcome: "APPLIED" });
  });

  it("apply=false(무시) → outcome DISMISSED · status 전이 없음", async () => {
    soFindUnique.mockResolvedValue({ ...applyOrder });
    soUpdateMany.mockResolvedValue({ count: 1 });

    const res = await APPLY(jsonReq({ apply: false }), aparams());
    expect(res.status).toBe(200);
    const upd = soUpdateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(upd.data).toMatchObject({ vendorProposalOutcome: "DISMISSED" });
    expect(upd.data).not.toHaveProperty("status");
    expect(upd.where).not.toHaveProperty("status");
  });

  it("파트너/운영자 발주(requestedVia≠GUEST) apply=true → 자동확정 없음", async () => {
    soFindUnique.mockResolvedValue({ ...applyOrder, requestedVia: "ADMIN" });
    soUpdateMany.mockResolvedValue({ count: 1 });
    const res = await APPLY(jsonReq({ apply: true }), aparams());
    expect(res.status).toBe(200);
    const upd = soUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(upd.data).not.toHaveProperty("status");
    expect(upd.data).toMatchObject({ vendorProposalOutcome: "APPLIED" });
  });
});

describe("벤더 respond — 재제안 outcome 리셋", () => {
  const respOrder = {
    id: "so-1",
    status: "REQUESTED",
    requestedVia: "GUEST",
    bookingId: "bk-1",
    vendorId: "v-1",
    vendorStatus: "PENDING_VENDOR",
    catalogItemId: "ci-1",
    vendorName: null,
    serviceDate: new Date("2026-08-01T00:00:00Z"),
    serviceTime: "10:00",
    quantity: 1,
    costVnd: 500000n,
    vendor: { name: "V", nameKo: "브이" },
    booking: { villa: { name: "Villa A" } },
  };

  it("action=propose → data에 vendorProposalOutcome:null · vendorProposalRespondedAt:null", async () => {
    soFindUnique.mockResolvedValue({ ...respOrder });
    soUpdateMany.mockResolvedValue({ count: 1 });

    const res = await RESPOND(
      jsonReq({ action: "propose", proposedServiceDate: "2026-08-06", proposedServiceTime: "16:00" }),
      aparams()
    );
    expect(res.status).toBe(200);
    const upd = soUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(upd.data).toMatchObject({
      vendorProposalOutcome: null,
      vendorProposalRespondedAt: null,
    });
  });
});
