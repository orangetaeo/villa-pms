import { beforeEach, describe, expect, it, vi } from "vitest";

// auth·prisma·audit-log mock (villa-reject-api.test.ts 패턴 재사용)
// 사업 핵심 원칙 2(마진 비공개): 요율 PUT은 ADMIN 전용 — 권한·영속·증빙·응답 누수 회귀 가드
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const mockVillaFindUnique = vi.fn();
const tx = {
  villaRate: {
    update: vi.fn(
      async (_a: { where: { id: string }; data: Record<string, unknown> }) => ({})
    ),
  },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    villa: { findUnique: (...a: unknown[]) => mockVillaFindUnique(...a) },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}));

import { writeAuditLog } from "@/lib/audit-log";
import { PUT } from "@/app/api/villas/[id]/rates/route";

// 기존 요율 1행 헬퍼 — BigInt 컬럼 포함 (DB 반환 형상 모사)
const rate = (season: string, over: Record<string, unknown> = {}) => ({
  id: `r-${season}`,
  season,
  marginType: "PERCENT" as const,
  marginValue: BigInt(10),
  salePriceVnd: BigInt(1_650_000),
  salePriceKrw: 90_000,
  supplierCostVnd: BigInt(1_500_000),
  ...over,
});

const putRaw = (raw: string) =>
  PUT(
    new Request("http://local/api/villas/v1/rates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: raw,
    }),
    { params: Promise.resolve({ id: "v1" }) }
  );
const putReq = (body: unknown) => putRaw(JSON.stringify(body));

const VALID_RATE = {
  season: "LOW",
  marginType: "PERCENT",
  marginValue: "20",
  salePriceVnd: "1800000",
  salePriceKrw: 100_000,
};
const VALID_BODY = { rates: [VALID_RATE] };

describe("PUT /api/villas/[id]/rates — ADMIN 요율 수정 (T6.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVillaFindUnique.mockResolvedValue({
      id: "v1",
      rates: [rate("LOW"), rate("HIGH"), rate("PEAK")],
    });
  });

  it("비로그인 401 — 마진 표면 차단", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await putReq(VALID_BODY)).status).toBe(401);
  });

  it("SUPPLIER 403 / CLEANER 403 — 운영자 전용 (누수 가드)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await putReq(VALID_BODY)).status).toBe(403);
    mockAuth.mockResolvedValue({ user: { id: "c1", role: "CLEANER" } });
    expect((await putReq(VALID_BODY)).status).toBe(403);
    // 권한 차단 시 DB 미접근
    expect(mockVillaFindUnique).not.toHaveBeenCalled();
  });

  it("JSON 파싱 실패 400 (INVALID_BODY)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await putRaw("not-json{");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_BODY");
  });

  it("salePriceKrw 음수 400 (VALIDATION_FAILED)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    expect(
      (await putReq({ rates: [{ ...VALID_RATE, salePriceKrw: -1 }] })).status
    ).toBe(400);
  });

  it("marginValue 비숫자 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    expect(
      (await putReq({ rates: [{ ...VALID_RATE, marginValue: "10%" }] })).status
    ).toBe(400);
  });

  it("중복 시즌 400", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    expect(
      (await putReq({ rates: [VALID_RATE, { ...VALID_RATE, marginValue: "30" }] })).status
    ).toBe(400);
  });

  it("빈 배열·4개 초과 400 (min1·max3)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    expect((await putReq({ rates: [] })).status).toBe(400);
    const four = ["LOW", "HIGH", "PEAK", "LOW"].map((s) => ({ ...VALID_RATE, season: s }));
    expect((await putReq({ rates: four })).status).toBe(400);
  });

  it("미존재 빌라 404", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    mockVillaFindUnique.mockResolvedValue(null);
    expect((await putReq(VALID_BODY)).status).toBe(404);
  });

  it("성공: 존재 시즌 update + supplierCostVnd 불변(운영자 수정 차단) + 응답 {updated}", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    const res = await putReq(VALID_BODY);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toEqual(["LOW"]);
    expect(json.skipped).toEqual([]);

    // marginType·marginValue·salePriceVnd·salePriceKrw 저장
    expect(tx.villaRate.update).toHaveBeenCalledTimes(1);
    const arg = tx.villaRate.update.mock.calls[0]![0];
    expect(arg.where.id).toBe("r-LOW");
    expect(arg.data.marginType).toBe("PERCENT");
    expect(arg.data.marginValue).toBe(BigInt(20));
    expect(arg.data.salePriceVnd).toBe(BigInt(1_800_000));
    expect(arg.data.salePriceKrw).toBe(100_000);
    // 불변식: supplierCostVnd는 update data에서 제외 (공급자 입력 영역)
    expect("supplierCostVnd" in arg.data).toBe(false);
  });

  it("skipped: VillaRate 레코드 없는 시즌은 생성 안 함", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    mockVillaFindUnique.mockResolvedValue({ id: "v1", rates: [rate("HIGH")] });
    const res = await putReq(VALID_BODY); // LOW 요청이나 LOW 레코드 없음
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toEqual(["LOW"]);
    expect(json.updated).toEqual([]);
    expect(tx.villaRate.update).not.toHaveBeenCalled();
  });

  it("AuditLog: 갱신 시즌마다 VillaRate UPDATE + old/new diff 기록", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    await putReq(VALID_BODY);
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledTimes(1);
    const log = vi.mocked(writeAuditLog).mock.calls[0]![0];
    expect(log.entity).toBe("VillaRate");
    expect(log.action).toBe("UPDATE");
    expect(log.entityId).toBe("r-LOW");
    // diff: BigInt는 문자열화되어 old/new 보존
    expect(log.changes).toMatchObject({
      marginValue: { old: "10", new: "20" },
      salePriceVnd: { old: "1650000", new: "1800000" },
      salePriceKrw: { old: 90_000, new: 100_000 },
    });
  });

  it("응답 누수 0: 본문에 BigInt·원가·마진 값 미포함 (시즌 키만)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await putReq(VALID_BODY);
    const text = await res.text();
    expect(text).not.toMatch(/1500000|1650000|1800000|supplierCost|marginValue/);
    expect(JSON.parse(text)).toEqual({ updated: ["LOW"], skipped: [] });
  });
});
