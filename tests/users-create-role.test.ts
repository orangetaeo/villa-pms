import { beforeEach, describe, expect, it, vi } from "vitest";

// S-RBAC-4 — POST /api/users(계정 생성) + PATCH CHANGE_ROLE(역할 변경) 가드 검증
// 핸들러 직접호출 + mock 패턴 (villa-create-api.test.ts 참고)

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

// bcryptjs — 해시는 결정적 더미로 대체(빠르고 검증 용이)
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async (pw: string) => `hashed:${pw}`) },
}));

// prisma mock — POST(트랜잭션 user.create + (VENDOR)serviceVendor.create) + PATCH(트랜잭션 update) 지원
const mockUserFindUnique = vi.fn();
const mockUserCreate = vi.fn();
const mockVendorCreate = vi.fn();
const tx = {
  user: {
    findUnique: vi.fn(),
    create: (...a: unknown[]) => mockUserCreate(...a),
    update: vi.fn(),
  },
  serviceVendor: {
    create: (...a: unknown[]) => mockVendorCreate(...a),
  },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      // 중복 phone 사전검사는 트랜잭션 밖 최상위 findUnique 사용
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      create: (...a: unknown[]) => mockUserCreate(...a),
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import bcrypt from "bcryptjs";
import { writeAuditLog } from "@/lib/audit-log";
import { POST } from "@/app/api/users/route";
import { PATCH } from "@/app/api/users/[id]/route";

const OWNER = { user: { id: "owner-1", role: "OWNER" } };

const postReq = (body: unknown) =>
  POST(
    new Request("http://local/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const patchReq = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://local/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

const VALID_CREATE = {
  name: "Nguyễn Văn An",
  phone: "0901-234-567",
  password: "password123",
  role: "STAFF",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUserFindUnique.mockResolvedValue(null); // 기본: 중복 phone 없음
  mockUserCreate.mockResolvedValue({
    id: "user-new",
    role: "STAFF",
    name: "Nguyễn Văn An",
    phone: "0901234567",
    isActive: true,
    createdAt: new Date("2026-06-23T00:00:00Z"),
  });
  mockVendorCreate.mockResolvedValue({ id: "vendor-new" });
});

describe("POST /api/users — 권한", () => {
  it("미인증은 401", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await postReq(VALID_CREATE);
    expect(res.status).toBe(401);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("비OWNER(MANAGER)는 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "m-1", role: "MANAGER" } });
    const res = await postReq(VALID_CREATE);
    expect(res.status).toBe(403);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/users — 생성", () => {
  beforeEach(() => mockAuth.mockResolvedValue(OWNER));

  it("STAFF/MANAGER/SUPPLIER/CLEANER 생성 가능 (역할 화이트리스트)", async () => {
    for (const role of ["STAFF", "MANAGER", "SUPPLIER", "CLEANER"]) {
      mockUserCreate.mockResolvedValue({
        id: `u-${role}`,
        role,
        name: "x",
        phone: "0901234567",
        isActive: true,
        createdAt: new Date(),
      });
      const res = await postReq({ ...VALID_CREATE, role });
      expect(res.status).toBe(201);
    }
  });

  it("VENDOR 생성 시 로그인 계정 + ServiceVendor 엔티티를 함께 만든다 (깨진 벤더 방지)", async () => {
    mockUserCreate.mockResolvedValue({
      id: "u-vendor",
      role: "VENDOR",
      name: "Nguyễn Văn An",
      phone: "0901234567",
      isActive: true,
      createdAt: new Date(),
    });
    const res = await postReq({ ...VALID_CREATE, role: "VENDOR" });
    expect(res.status).toBe(201);
    // ServiceVendor 엔티티가 같은 트랜잭션에서 계정과 연결되어 생성됨
    expect(mockVendorCreate).toHaveBeenCalledTimes(1);
    const arg = mockVendorCreate.mock.calls[0][0] as {
      data: { name: string; phone: string; userId: string; active: boolean };
    };
    expect(arg.data.userId).toBe("u-vendor");
    expect(arg.data.name).toBe("Nguyễn Văn An");
    expect(arg.data.active).toBe(true);
  });

  it("VENDOR 외 역할 생성 시엔 ServiceVendor를 만들지 않는다", async () => {
    await postReq({ ...VALID_CREATE, role: "SUPPLIER" });
    expect(mockVendorCreate).not.toHaveBeenCalled();
  });

  it("화이트리스트 외 역할(OWNER)은 400", async () => {
    const res = await postReq({ ...VALID_CREATE, role: "OWNER" });
    expect(res.status).toBe(400);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("ADMIN 역할 부여 시도도 400 (단일 OWNER 유지·권한상승 차단)", async () => {
    const res = await postReq({ ...VALID_CREATE, role: "ADMIN" });
    expect(res.status).toBe(400);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("password<8은 400", async () => {
    const res = await postReq({ ...VALID_CREATE, password: "short" });
    expect(res.status).toBe(400);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("phone을 숫자만 정규화하여 저장하고 bcryptjs로 해시한다 (passwordHash 응답 부재)", async () => {
    const res = await postReq(VALID_CREATE);
    expect(res.status).toBe(201);
    const arg = mockUserCreate.mock.calls[0][0] as {
      data: { phone: string; passwordHash: string; isActive: boolean };
      select: Record<string, boolean>;
    };
    expect(arg.data.phone).toBe("0901234567"); // 0901-234-567 → 숫자만
    expect(bcrypt.hash).toHaveBeenCalledWith("password123", 12); // BCRYPT_ROUNDS 일원화(보안 P1-S2)
    expect(arg.data.passwordHash).toBe("hashed:password123");
    expect(arg.data.isActive).toBe(true);
    // 응답 select 화이트리스트에 passwordHash 없음
    expect(arg.select.passwordHash).toBeUndefined();
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.passwordHash).toBeUndefined();
  });

  it("중복 phone은 409 PHONE_TAKEN", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "existing" });
    const res = await postReq(VALID_CREATE);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "PHONE_TAKEN" });
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("비숫자만 있는 phone은 409 PHONE_TAKEN(빈 정규화)", async () => {
    const res = await postReq({ ...VALID_CREATE, phone: "----" });
    expect(res.status).toBe(409);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("감사로그 CREATE User 기록(role·name·phone, 비밀번호 제외)", async () => {
    await postReq(VALID_CREATE);
    const audit = (writeAuditLog as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as {
      userId: string;
      action: string;
      entity: string;
      changes: Record<string, unknown>;
    };
    expect(audit.userId).toBe("owner-1");
    expect(audit.action).toBe("CREATE");
    expect(audit.entity).toBe("User");
    expect(Object.keys(audit.changes).sort()).toEqual(["name", "phone", "role"]);
    expect(JSON.stringify(audit.changes)).not.toContain("password");
  });
});

describe("PATCH /api/users/[id] — CHANGE_ROLE 가드", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(OWNER);
    tx.user.findUnique.mockReset();
    tx.user.update.mockReset();
  });

  it("본인 역할 변경은 400 CANNOT_CHANGE_OWN_ROLE", async () => {
    const res = await patchReq("owner-1", { action: "CHANGE_ROLE", role: "STAFF" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "CANNOT_CHANGE_OWN_ROLE" });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("변경 대상 화이트리스트 외 역할(OWNER)은 400(zod) — 매니저/직원만 허용", async () => {
    const res = await patchReq("u-2", { action: "CHANGE_ROLE", role: "OWNER" });
    expect(res.status).toBe(400);
  });

  it("변경 대상 외부 역할(SUPPLIER)로도 400(zod) — 전환 불가", async () => {
    const res = await patchReq("u-2", { action: "CHANGE_ROLE", role: "SUPPLIER" });
    expect(res.status).toBe(400);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("외부 역할(SUPPLIER) 계정은 매니저/직원으로도 변경 불가 400 ROLE_NOT_CHANGEABLE (재가입 대상)", async () => {
    tx.user.findUnique.mockResolvedValue({
      id: "sup-1",
      role: "SUPPLIER",
      isActive: true,
      zaloUserId: null,
    });
    const res = await patchReq("sup-1", { action: "CHANGE_ROLE", role: "STAFF" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ROLE_NOT_CHANGEABLE" });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("직원(STAFF) → 매니저(MANAGER) 승격 정상 + 감사로그 UPDATE(old→new)", async () => {
    tx.user.findUnique.mockResolvedValue({
      id: "staff-1",
      role: "STAFF",
      isActive: true,
      zaloUserId: null,
    });
    tx.user.update.mockResolvedValue({
      id: "staff-1",
      isActive: true,
      zaloUserId: null,
      role: "MANAGER",
    });
    const res = await patchReq("staff-1", { action: "CHANGE_ROLE", role: "MANAGER" });
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("MANAGER");
    const audit = (writeAuditLog as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][0] as { action: string; changes: { role: { old: string; new: string } } };
    expect(audit.action).toBe("UPDATE");
    expect(audit.changes.role).toEqual({ old: "STAFF", new: "MANAGER" });
  });

  it("매니저(MANAGER) → 직원(STAFF) 강등 정상", async () => {
    tx.user.findUnique.mockResolvedValue({
      id: "mgr-1",
      role: "MANAGER",
      isActive: true,
      zaloUserId: null,
    });
    tx.user.update.mockResolvedValue({
      id: "mgr-1",
      isActive: true,
      zaloUserId: null,
      role: "STAFF",
    });
    const res = await patchReq("mgr-1", { action: "CHANGE_ROLE", role: "STAFF" });
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("STAFF");
  });

  it("비OWNER는 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "m-1", role: "MANAGER" } });
    const res = await patchReq("u-2", { action: "CHANGE_ROLE", role: "STAFF" });
    expect(res.status).toBe(403);
  });
});
