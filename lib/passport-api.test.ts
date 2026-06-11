import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 여권 비공개 파이프라인 라우트 테스트 (T3.1, QA M2)
 * GET /api/passports/[name] — ADMIN 가드 + private,no-store + 경로 탈출 차단
 * POST /api/uploads/passport — ADMIN 전용
 */

const mockAuth = vi.fn();
const mockReadFile = vi.fn();

vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));
vi.mock("fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("fs")>();
  return {
    ...real,
    promises: {
      ...real.promises,
      readFile: (...args: unknown[]) => mockReadFile(...args),
    },
  };
});

import { GET as passportGet } from "../app/api/passports/[name]/route";
import { POST as passportUpload } from "../app/api/uploads/passport/route";

const callGet = (name: string) =>
  passportGet(new Request(`http://local/api/passports/${name}`), {
    params: Promise.resolve({ name }),
  });

describe("GET /api/passports/[name] — 여권 서빙 (조건 A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(Buffer.from([0xff, 0xd8]));
  });

  it("비로그인 401 — 공개 /uploads와 달리 무인증 접근 불가", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await callGet("a.jpg")).status).toBe(401);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("SUPPLIER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await callGet("a.jpg")).status).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("경로 탈출 파일명 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    for (const bad of ["..", "a..b/../x.jpg", "a b.jpg", "%2e%2e"]) {
      const res = await callGet(bad);
      expect(res.status, bad).toBe(400);
    }
  });

  it("ADMIN 성공: private,no-store + nosniff 헤더 (캐시 잔존 차단 — 90일 삭제 정합)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await callGet("123-admin-uuid.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("파일 없음 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    expect((await callGet("missing.jpg")).status).toBe(404);
  });
});

describe("POST /api/uploads/passport — 여권 업로드 (ADMIN 전용)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const call = () =>
    passportUpload(new Request("http://local/api/uploads/passport", { method: "POST" }));

  it("비로그인 401 / SUPPLIER 403 (공개 업로드와 달리 SUPPLIER도 차단)", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await call()).status).toBe(403);
  });
});
