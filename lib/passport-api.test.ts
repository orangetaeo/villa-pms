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

  // T10.5(F10 D5): 공급자는 본인이 업로드한 파일만 서빙(파일명 업로더 id 매칭). 타인 여권은 403.
  it("SUPPLIER — 타인 업로드 파일 403 (타인 여권 차단)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    // "a.jpg"·운영자 업로드 파일은 s1 소유 아님 → 403
    expect((await callGet("a.jpg")).status).toBe(403);
    expect(
      (await callGet("1717000000000-adminUser-0a1b2c3d-4e5f-6789-abcd-ef0123456789.jpg")).status
    ).toBe(403);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("SUPPLIER — 본인 업로드 파일은 서빙 허용 (자기 게스트분)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    // 파일명에 업로더 id(s1)가 박혀 있어야 본인 파일로 인정 (sig- 접두 서명도 동일)
    const own = "1717000000000-s1-0a1b2c3d-4e5f-6789-abcd-ef0123456789.jpg";
    const res = await callGet(own);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
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

describe("POST /api/uploads/passport — 여권·서명 업로드 (운영자+공급자)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const call = () =>
    passportUpload(new Request("http://local/api/uploads/passport", { method: "POST" }));

  // T10.5(F10 D5): 공급자도 자기 게스트 체크인·아웃 증빙 업로드 허용(파일명 업로더 id로 본인 스코프 한정).
  //   비로그인·CLEANER 등은 차단. (SUPPLIER는 권한 통과 → formData 없으니 400 invalid_body, 403 아님)
  it("비로그인 401 / CLEANER 403 / SUPPLIER 통과(권한 게이트)", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "c1", role: "CLEANER" } });
    expect((await call()).status).toBe(403);
    // SUPPLIER는 권한 통과 — body 없으니 400(invalid_body). 403이 아니어야 함(게이트 통과 증거).
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await call()).status).not.toBe(403);
  });
});
