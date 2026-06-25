import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// #2b 미니바 회사표준(MinibarItem) — lib 헬퍼 + /api/admin/minibar CRUD 권한·AuditLog·검증 + 누수 가드.
//   unitPriceVnd = 우리 판매가. 쓰기 canSetPrice(STAFF 차단)·읽기 isOperator. MinibarItem엔 villaId 없음(구조적 누수 차단).

import { minibarItemName, MINIBAR_VND_DIGITS, generateMinibarItemKey } from "@/lib/minibar";

describe("lib/minibar 표시명·검증", () => {
  it("vi 로케일은 nameVi 우선, 비면 nameKo 폴백", () => {
    expect(minibarItemName({ nameKo: "생수", nameVi: "Nước suối" }, "vi")).toBe("Nước suối");
    expect(minibarItemName({ nameKo: "생수", nameVi: "" }, "vi")).toBe("생수");
    expect(minibarItemName({ nameKo: "생수", nameVi: null }, "vi")).toBe("생수");
  });

  it("ko/en/zh/ru 로케일은 nameKo 사용", () => {
    for (const loc of ["ko", "en", "zh", "ru"]) {
      expect(minibarItemName({ nameKo: "맥주", nameVi: "Bia" }, loc)).toBe("맥주");
    }
  });

  it("MINIBAR_VND_DIGITS — 비음수 정수만(최대 15자리), 소수·음수·콤마 거부", () => {
    expect(MINIBAR_VND_DIGITS.test("0")).toBe(true);
    expect(MINIBAR_VND_DIGITS.test("30000")).toBe(true);
    expect(MINIBAR_VND_DIGITS.test("")).toBe(false);
    expect(MINIBAR_VND_DIGITS.test("-1")).toBe(false);
    expect(MINIBAR_VND_DIGITS.test("3.5")).toBe(false);
    expect(MINIBAR_VND_DIGITS.test("30,000")).toBe(false);
    expect(MINIBAR_VND_DIGITS.test("1234567890123456")).toBe(false); // 16자리 초과
  });

  it("generateMinibarItemKey — mb_ 접두 안정키", () => {
    expect(generateMinibarItemKey(1).startsWith("mb_")).toBe(true);
  });
});

// ── CRUD API ───────────────────────────────────────────────────────────────
// vi.hoisted — mock 변수를 vi.mock 팩토리(파일 최상단 호이스트)보다 먼저 초기화(TDZ 회피).
const { mockAuth, mockWriteAuditLog, mockDb } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWriteAuditLog: vi.fn(async (..._a: unknown[]) => {}),
  mockDb: {
    minibarItem: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(async () => ({})),
    },
  },
}));
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => mockWriteAuditLog(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: mockDb }));

import { GET, POST } from "@/app/api/admin/minibar/route";
import { PATCH, DELETE } from "@/app/api/admin/minibar/[id]/route";

const post = (body: unknown) =>
  POST(
    new Request("http://local/api/admin/minibar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://local/api/admin/minibar/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
const del = (id: string) =>
  DELETE(new Request(`http://local/api/admin/minibar/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

const VALID = { nameKo: "생수", nameVi: "Nước suối", unitPriceVnd: "30000" };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.minibarItem.create.mockResolvedValue({
    id: "m1", itemKey: "mb_x", nameKo: "생수", nameVi: "Nước suối",
    unitPriceVnd: 30000n, sortOrder: 0, active: true,
  });
  mockDb.minibarItem.findUnique.mockResolvedValue({
    id: "m1", nameKo: "생수", unitPriceVnd: 30000n, active: true,
  });
  mockDb.minibarItem.update.mockResolvedValue({
    id: "m1", itemKey: "mb_x", nameKo: "탄산수", nameVi: "Nước suối",
    unitPriceVnd: 50000n, sortOrder: 0, active: true,
  });
});

describe("POST /api/admin/minibar — 생성 권한·검증·AuditLog", () => {
  it("비로그인 401", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await post(VALID)).status).toBe(401);
    expect(mockDb.minibarItem.create).not.toHaveBeenCalled();
  });

  it("STAFF 403 (canSetPrice 차단 — 판매가)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "st1", role: "STAFF" } });
    expect((await post(VALID)).status).toBe(403);
    expect(mockDb.minibarItem.create).not.toHaveBeenCalled();
  });

  it("SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await post(VALID)).status).toBe(403);
  });

  it("OWNER 200 — 생성 + 판매가 문자열 반환 + AuditLog CREATE", async () => {
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    const res = await post(VALID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.item.unitPriceVnd).toBe("30000"); // BigInt 직렬화 금지 → 문자열
    expect(mockDb.minibarItem.create).toHaveBeenCalledOnce();
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATE", entity: "MinibarItem" })
    );
  });

  it("MANAGER 200 (canSetPrice)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "mg", role: "MANAGER" } });
    expect((await post(VALID)).status).toBe(200);
  });

  it("단가 형식 위반(소수)은 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    expect((await post({ ...VALID, unitPriceVnd: "3.5" })).status).toBe(400);
    expect(mockDb.minibarItem.create).not.toHaveBeenCalled();
  });

  it("nameKo 누락은 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    expect((await post({ unitPriceVnd: "30000" })).status).toBe(400);
  });
});

describe("GET /api/admin/minibar — 읽기 권한", () => {
  it("STAFF도 목록 조회 가능 (isOperator)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "st1", role: "STAFF" } });
    expect((await GET()).status).toBe(200);
  });
  it("SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await GET()).status).toBe(403);
  });
});

describe("PATCH/DELETE /api/admin/minibar/[id]", () => {
  it("STAFF PATCH 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "st1", role: "STAFF" } });
    expect((await patch("m1", { unitPriceVnd: "50000" })).status).toBe(403);
  });

  it("OWNER PATCH 200 + 단가 변경 AuditLog", async () => {
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    const res = await patch("m1", { nameKo: "탄산수", unitPriceVnd: "50000" });
    expect(res.status).toBe(200);
    expect((await res.json()).item.unitPriceVnd).toBe("50000");
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "UPDATE", entity: "MinibarItem" })
    );
  });

  it("존재하지 않는 id PATCH 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    mockDb.minibarItem.findUnique.mockResolvedValue(null);
    expect((await patch("zzz", { active: false })).status).toBe(404);
  });

  it("OWNER DELETE 200 + AuditLog DELETE", async () => {
    mockAuth.mockResolvedValue({ user: { id: "o1", role: "OWNER" } });
    const res = await del("m1");
    expect(res.status).toBe(200);
    expect(mockDb.minibarItem.delete).toHaveBeenCalledOnce();
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DELETE", entity: "MinibarItem" })
    );
  });

  it("STAFF DELETE 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "st1", role: "STAFF" } });
    expect((await del("m1")).status).toBe(403);
    expect(mockDb.minibarItem.delete).not.toHaveBeenCalled();
  });
});

// ── 누수 가드 — 공급자·공개 라우트가 MinibarItem(판매가)을 참조하지 않는지 정적 검사 ──
describe("#2b 누수 0 — 공급자·공개 라우트는 MinibarItem 미참조", () => {
  const root = join(__dirname, "..");
  const SUPPLIER_PUBLIC_GLOBS = [
    "app/(supplier)",
    "app/p",
  ];
  function walk(dir: string): string[] {
    const fs = require("node:fs") as typeof import("node:fs");
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  }
  it("supplier·public 트리에 prisma.minibarItem 호출 없음", () => {
    for (const g of SUPPLIER_PUBLIC_GLOBS) {
      const dir = join(root, g);
      let files: string[] = [];
      try {
        files = walk(dir);
      } catch {
        continue; // 디렉터리 없으면 스킵
      }
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        expect(src.includes("minibarItem"), `${f} references minibarItem`).toBe(false);
      }
    }
  });
});
