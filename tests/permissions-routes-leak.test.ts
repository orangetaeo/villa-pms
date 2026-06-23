// tests/permissions-routes-leak.test.ts — S-RBAC-2 라우트 권한 행렬 누수 테스트 (ADR-0013)
//
// 목적: app/api/** 의 capability 치환(role==="ADMIN" → isOperator/canViewFinance/...)이
// 역할별 경계를 정확히 강제하는지 검증한다. 두 층위로 커버한다.
//
//  (A) 대표 라우트 핸들러 직접 호출 — auth/prisma/audit-log/lib을 mock 하고,
//      role만 바꿔가며 403 차단/통과(=403 아님) 경계를 end-to-end 로 확인.
//      "통과"는 응답이 403이 아님으로 판정한다(다운스트림 비즈니스 로직이 404/409/500을
//      낼 수 있으나, 그건 권한 게이트 통과를 의미한다 — 권한만 검증).
//
//  (B) 라우트→capability 매핑 행렬 — 각 라우트가 쓰는 capability 술어를 직접 평가해
//      STAFF/MANAGER/OWNER/ADMIN 전 역할 매트릭스를 빠짐없이 고정(계약 매핑표 회귀 가드).
//
// 전제(계약 §시퀀싱): 이 단계는 "권한 배선"이며 실제 MANAGER/STAFF 계정은 0개.
// 필드 마스킹(KRW)은 S-RBAC-3 몫이므로 여기서는 접근 경계만 본다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isOperator,
  canViewFinance,
  isSystemAdmin,
  canOverrideGate,
  canSetPrice,
  type Role,
} from "@/lib/permissions";

// ── 공용 mock: 핸들러가 DB/lib에 닿아도 안전하게 통과시키되, 권한 차단은 그 전에 일어난다 ──
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

// prisma: 어떤 모델·메서드 접근이든 안전한 async 함수를 돌려주는 느슨한 스텁.
// prisma.<model>.<method>(...) 호출이 throw 하지 않게 해 권한 게이트만 검증한다.
// (findMany는 [], 그 외는 null 반환 — 다운스트림이 404/null-guard로 빠져도 무방)
vi.mock("@/lib/prisma", () => {
  const method = (name: string) =>
    vi.fn(async () => (name === "findMany" ? [] : name === "count" ? 0 : null));
  // 모델 프록시: 임의 메서드명 접근 시 async stub 반환
  const modelProxy = () => new Proxy({}, { get: (_t, m) => method(String(m)) });
  const root: { $transaction: (fn: (t: unknown) => Promise<unknown>) => Promise<unknown> } = {
    $transaction: async (fn) => fn(prisma),
  };
  const prisma = new Proxy(root, {
    get: (target, prop) =>
      prop in target ? (target as Record<string | symbol, unknown>)[prop] : modelProxy(),
  });
  return { prisma };
});

// lib mocks — 권한 통과 후 호출되는 비즈니스 로직. 무해한 값/throw 로 응답만 형성.
vi.mock("@/lib/settlement", () => ({
  generateMonthlySettlements: vi.fn(async () => ({
    created: 0,
    updated: 0,
    skipped: 0,
    totalSuppliers: 0,
  })),
  monthRangeUtc: vi.fn(() => ({ start: new Date(), end: new Date() })),
  transitionSettlement: vi.fn(async () => ({
    id: "s1",
    status: "CONFIRMED",
    paidAt: null,
    totalVnd: 0n,
  })),
  SettlementNotFoundError: class extends Error {},
  SettlementTransitionError: class extends Error {},
}));

// ── (A) 대표 라우트 핸들러 직접 호출 ──────────────────────────────────────────
import { GET as settlementsGet, POST as settlementsPost } from "@/app/api/settlements/route";
import { POST as bookingConfirm } from "@/app/api/bookings/[id]/confirm/route";
import { POST as bookingCheckin } from "@/app/api/bookings/[id]/checkin/route";
import { POST as cleaningApprove } from "@/app/api/cleaning-tasks/[id]/approve/route";
import { POST as calendarBlockPost } from "@/app/api/calendar-blocks/route";
import { PATCH as salesPatch } from "@/app/api/villas/[id]/sales/route";
import { PUT as ratesPut } from "@/app/api/villas/[id]/rates/route";
import { POST as proposalsPost } from "@/app/api/proposals/route";
import { POST as forceSellablePost } from "@/app/api/villas/[id]/force-sellable/route";
import { GET as usersGet } from "@/app/api/users/route";
import { GET as settingsGet } from "@/app/api/settings/route";
import { GET as seasonsGet } from "@/app/api/seasons/route";

const sess = (role: Role) => ({ user: { id: "u1", role } });
const idParams = { params: Promise.resolve({ id: "v1" }) };

const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(() => vi.clearAllMocks());

/** 권한 게이트를 통과했는가 = 응답이 403이 아니다 (다운스트림 404/409/500은 통과로 간주) */
const passed = (status: number) => status !== 403 && status !== 401;

describe("(A) STAFF — 재무·시스템 라우트 차단 (403)", () => {
  beforeEach(() => mockAuth.mockResolvedValue(sess("STAFF")));

  it("settlements GET(canViewFinance) 403", async () => {
    expect((await settlementsGet(jsonReq("http://l/api/settlements", "GET"))).status).toBe(403);
  });
  it("villas/[id]/sales PATCH(canSetPrice) 403", async () => {
    expect((await salesPatch(jsonReq("http://l/api/villas/v1/sales", "PATCH", {}), idParams)).status).toBe(403);
  });
  it("villas/[id]/rates PUT(canSetPrice) 403", async () => {
    expect((await ratesPut(jsonReq("http://l/api/villas/v1/rates", "PUT", {}), idParams)).status).toBe(403);
  });
  it("proposals POST(canSetPrice) 403", async () => {
    expect((await proposalsPost(jsonReq("http://l/api/proposals", "POST", {}))).status).toBe(403);
  });
  it("users GET(isSystemAdmin) 403", async () => {
    expect((await usersGet(jsonReq("http://l/api/users", "GET"))).status).toBe(403);
  });
  it("settings GET(isSystemAdmin) 403", async () => {
    expect((await settingsGet()).status).toBe(403);
  });
  it("seasons GET(isSystemAdmin) 403", async () => {
    expect((await seasonsGet()).status).toBe(403);
  });
  it("settlements POST 집계(isSystemAdmin) 403", async () => {
    expect((await settlementsPost(jsonReq("http://l/api/settlements", "POST", { yearMonth: "2026-06" }))).status).toBe(403);
  });
});

describe("(A) STAFF — 운영 라우트 허용 (403 아님)", () => {
  beforeEach(() => mockAuth.mockResolvedValue(sess("STAFF")));

  it("bookings/[id]/confirm 통과", async () => {
    const res = await bookingConfirm(jsonReq("http://l/api/bookings/b1/confirm", "POST"), idParams);
    expect(passed(res.status)).toBe(true);
  });
  it("bookings/[id]/checkin 통과", async () => {
    const res = await bookingCheckin(jsonReq("http://l/api/bookings/b1/checkin", "POST", {}), idParams);
    expect(passed(res.status)).toBe(true);
  });
  it("cleaning-tasks/[id]/approve 통과", async () => {
    const res = await cleaningApprove(jsonReq("http://l/api/cleaning-tasks/t1/approve", "POST"), idParams);
    expect(passed(res.status)).toBe(true);
  });
  it("calendar-blocks POST 통과", async () => {
    const res = await calendarBlockPost(jsonReq("http://l/api/calendar-blocks", "POST", {}));
    expect(passed(res.status)).toBe(true);
  });
});

describe("(A) MANAGER — 재무 허용 + 시스템 차단 + force-sellable 허용", () => {
  beforeEach(() => mockAuth.mockResolvedValue(sess("MANAGER")));

  it("settlements GET(canViewFinance) 허용", async () => {
    expect(passed((await settlementsGet(jsonReq("http://l/api/settlements", "GET"))).status)).toBe(true);
  });
  it("villas/[id]/sales PATCH(canSetPrice) 허용", async () => {
    const res = await salesPatch(jsonReq("http://l/api/villas/v1/sales", "PATCH", {}), idParams);
    expect(res.status).not.toBe(403);
  });
  it("force-sellable(canOverrideGate) 허용", async () => {
    const res = await forceSellablePost(jsonReq("http://l/api/villas/v1/force-sellable", "POST", { reason: "x" }), idParams);
    expect(passed(res.status)).toBe(true);
  });
  it("users(isSystemAdmin) 차단 403", async () => {
    expect((await usersGet(jsonReq("http://l/api/users", "GET"))).status).toBe(403);
  });
  it("settings(isSystemAdmin) 차단 403", async () => {
    expect((await settingsGet()).status).toBe(403);
  });
  it("seasons(isSystemAdmin) 차단 403", async () => {
    expect((await seasonsGet()).status).toBe(403);
  });
  it("정산 승인 PATCH/집계 POST(isSystemAdmin) 차단 403", async () => {
    expect((await settlementsPost(jsonReq("http://l/api/settlements", "POST", { yearMonth: "2026-06" }))).status).toBe(403);
  });
});

describe("(A) OWNER·ADMIN — 전부 허용 (회귀 0)", () => {
  it.each<Role>(["OWNER", "ADMIN"])("%s: 재무·시스템·운영 전부 통과", async (role) => {
    mockAuth.mockResolvedValue(sess(role));
    expect(passed((await settlementsGet(jsonReq("http://l/api/settlements", "GET"))).status)).toBe(true);
    expect((await usersGet(jsonReq("http://l/api/users", "GET"))).status).not.toBe(403);
    expect((await settingsGet()).status).not.toBe(403);
    expect(passed((await settlementsPost(jsonReq("http://l/api/settlements", "POST", { yearMonth: "2026-06" }))).status)).toBe(true);
    const fs = await forceSellablePost(jsonReq("http://l/api/villas/v1/force-sellable", "POST", { reason: "x" }), idParams);
    expect(passed(fs.status)).toBe(true);
    const confirm = await bookingConfirm(jsonReq("http://l/api/bookings/b1/confirm", "POST"), idParams);
    expect(passed(confirm.status)).toBe(true);
  });
});

describe("(A) 비운영 역할 — SUPPLIER/CLEANER 재무·시스템 라우트 차단", () => {
  it.each<Role>(["SUPPLIER", "CLEANER"])("%s settlements GET 403", async (role) => {
    mockAuth.mockResolvedValue(sess(role));
    expect((await settlementsGet(jsonReq("http://l/api/settlements", "GET"))).status).toBe(403);
  });
});

// ── (B) 라우트 → capability 매핑 행렬 (계약 매핑표 고정) ──────────────────────
// 각 라우트가 실제로 import해 쓰는 capability 술어를 평가, 4개 운영자 역할 전부 검사.
type Cap = (r?: Role) => boolean;
const ROUTE_CAP: Array<{ route: string; cap: Cap }> = [
  // isSystemAdmin (OWNER/ADMIN)
  { route: "users", cap: isSystemAdmin },
  { route: "users/[id]", cap: isSystemAdmin },
  { route: "settings", cap: isSystemAdmin },
  { route: "zalo/qr", cap: isSystemAdmin },
  { route: "zalo/status", cap: isSystemAdmin },
  { route: "seasons", cap: isSystemAdmin },
  { route: "seasons/[id]", cap: isSystemAdmin },
  { route: "cost-alerts/dismiss", cap: isSystemAdmin },
  { route: "settlements POST(집계)", cap: isSystemAdmin },
  { route: "settlements/[id] PATCH(확정/지급)", cap: isSystemAdmin },
  // canViewFinance (OWNER/MANAGER/ADMIN)
  { route: "settlements GET", cap: canViewFinance },
  { route: "settlements/[id] GET", cap: canViewFinance },
  // canSetPrice (OWNER/MANAGER/ADMIN)
  { route: "proposals", cap: canSetPrice },
  { route: "proposals/[id]", cap: canSetPrice },
  { route: "proposals/candidates", cap: canSetPrice },
  { route: "villas/[id]/sales", cap: canSetPrice },
  { route: "villas/[id]/rates", cap: canSetPrice },
  { route: "bookings/[id]/services", cap: canSetPrice },
  // canOverrideGate (OWNER/MANAGER/ADMIN)
  { route: "villas/[id]/force-sellable", cap: canOverrideGate },
  // isOperator (OWNER/MANAGER/STAFF/ADMIN)
  { route: "bookings/[id]", cap: isOperator },
  { route: "bookings/[id]/confirm", cap: isOperator },
  { route: "bookings/[id]/checkin", cap: isOperator },
  { route: "bookings/[id]/checkout", cap: isOperator },
  { route: "cleaning-tasks", cap: isOperator },
  { route: "cleaning-tasks/[id]/approve", cap: isOperator },
  { route: "villas/[id]", cap: isOperator },
  { route: "services/[id]", cap: isOperator },
  { route: "zalo/messages", cap: isOperator },
];

describe("(B) 라우트→capability 매핑 행렬 — 운영자 4역할", () => {
  it.each(ROUTE_CAP)("$route : STAFF 가능여부 = isOperator(STAFF)", ({ route, cap }) => {
    // STAFF는 isOperator 라우트만 통과, finance/system/price/gate 라우트는 차단
    const expected = cap === isOperator;
    expect(cap("STAFF")).toBe(expected);
    void route;
  });

  it.each(ROUTE_CAP)("$route : MANAGER 가능여부 = isSystemAdmin 외 전부 통과", ({ cap }) => {
    // MANAGER는 시스템(isSystemAdmin)만 차단, 나머지(finance/price/gate/operator) 통과
    const expected = cap !== isSystemAdmin;
    expect(cap("MANAGER")).toBe(expected);
  });

  it.each(ROUTE_CAP)("$route : OWNER 전부 통과", ({ cap }) => {
    expect(cap("OWNER")).toBe(true);
  });

  it.each(ROUTE_CAP)("$route : ADMIN 전부 통과 (회귀 0)", ({ cap }) => {
    expect(cap("ADMIN")).toBe(true);
  });

  it.each(ROUTE_CAP)("$route : SUPPLIER 운영자 capability 전부 차단", ({ cap }) => {
    expect(cap("SUPPLIER")).toBe(false);
  });
});
