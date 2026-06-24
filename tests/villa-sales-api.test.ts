import { beforeEach, describe, expect, it, vi } from "vitest";

// ADR-0011 판매정보 저장 — PATCH /api/villas/[id]/sales.
// auth·prisma·audit-log mock (villa-reject-api.test 패턴). 권한·zod·영속·AuditLog 마스킹 검증.
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));

const auditCalls: Array<{ entity: string; action: string; changes?: unknown }> = [];
vi.mock("@/lib/audit-log", () => ({
  writeAuditLog: vi.fn(async (p: { entity: string; action: string; changes?: unknown }) => {
    auditCalls.push({ entity: p.entity, action: p.action, changes: p.changes });
  }),
}));

type AnyArg = { data: Record<string, unknown> & { data?: Record<string, unknown>[] } };
const tx = {
  villa: {
    findUnique: vi.fn(),
    update: vi.fn(async (_a: AnyArg) => ({})),
  },
  villaBedroom: {
    deleteMany: vi.fn(async () => ({})),
    createMany: vi.fn(async (_a: AnyArg) => ({})),
  },
  villaFeature: {
    deleteMany: vi.fn(async () => ({})),
    createMany: vi.fn(async (_a: AnyArg) => ({})),
  },
};
const transactionSpy = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (fn: (t: unknown) => Promise<unknown>) => transactionSpy(fn) },
}));

import { PATCH } from "@/app/api/villas/[id]/sales/route";

const req = (body: unknown) =>
  PATCH(
    new Request("http://local/api/villas/v1/sales", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "v1" }) }
  );

const BASE = {
  checkInTime: 840,
  checkOutTime: 660,
  smokingAllowed: false,
  petsAllowed: true,
  parkingSlots: 2,
  baseDepositVnd: "5000000",
  wifiSsid: "VillaSea",
  wifiPassword: "secret-pw-123",
  extraBedAvailable: true,
  bedrooms: [
    { roomIndex: 1, roomLabel: "마스터룸", bedType: "KING", bedCount: 1, capacity: 2 },
    { roomIndex: 2, bedType: "TWIN", bedCount: 2, capacity: 2 },
  ],
  features: [
    { category: "VIEW", featureKey: "viewSea" },
    { category: "FACILITY", featureKey: "bbq" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  auditCalls.length = 0;
  tx.villa.findUnique.mockResolvedValue({ id: "v1" });
});

describe("권한 — ADMIN 전용 (입력 주체는 테오 팀)", () => {
  it("비로그인 401 + DB 미접근", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await req(BASE)).status).toBe(401);
    expect(transactionSpy).not.toHaveBeenCalled();
  });
  it("SUPPLIER 403 + DB 미접근", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await req(BASE)).status).toBe(403);
    expect(transactionSpy).not.toHaveBeenCalled();
  });
  it("CLEANER 403 + DB 미접근", async () => {
    mockAuth.mockResolvedValue({ user: { id: "c1", role: "CLEANER" } });
    expect((await req(BASE)).status).toBe(403);
    expect(transactionSpy).not.toHaveBeenCalled();
  });
});

describe("zod 검증 — 화이트리스트·범위·url", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } }));

  it("임의 bedType 거부 (enum 화이트리스트)", async () => {
    const res = await req({ ...BASE, bedrooms: [{ roomIndex: 1, bedType: "WATERBED", bedCount: 1 }] });
    expect(res.status).toBe(400);
  });
  it("임의 featureKey 거부 (사전 화이트리스트)", async () => {
    const res = await req({ ...BASE, features: [{ category: "VIEW", featureKey: "__bogus__" }] });
    expect(res.status).toBe(400);
  });
  it("category 불일치 featureKey 거부 (bbq는 FACILITY인데 VIEW로)", async () => {
    const res = await req({ ...BASE, features: [{ category: "VIEW", featureKey: "bbq" }] });
    expect(res.status).toBe(400);
  });
  it("음수 정수 거부 (beachDistanceM)", async () => {
    const res = await req({ ...BASE, beachDistanceM: -10 });
    expect(res.status).toBe(400);
  });
  it("체크인 시각 범위초과 거부 (1440)", async () => {
    const res = await req({ ...BASE, checkInTime: 1440 });
    expect(res.status).toBe(400);
  });
  it("잘못된 url 거부 (http 비-https)", async () => {
    const res = await req({ ...BASE, googleMapUrl: "http://maps.example/x" });
    expect(res.status).toBe(400);
  });
  it("잘못된 url 거부 (스킴 없음)", async () => {
    const res = await req({ ...BASE, googleMapUrl: "not-a-url" });
    expect(res.status).toBe(400);
  });
  it("https url 통과", async () => {
    const res = await req({ ...BASE, googleMapUrl: "https://maps.google.com/?q=x" });
    expect(res.status).toBe(200);
  });
  it("roomLabel·capacity null 허용 (라벨/수용인원 미입력 침실 — 폼이 null 전송)", async () => {
    // 회귀: optional만 두면 null이 거부되어 "저장 실패"가 났음. nullable 허용 확인
    const res = await req({
      ...BASE,
      bedrooms: [{ roomIndex: 1, roomLabel: null, bedType: "KING", bedCount: 1, capacity: null }],
    });
    expect(res.status).toBe(200);
  });
  it("같은 roomIndex bathroomCount 불일치 거부", async () => {
    const res = await req({
      ...BASE,
      bedrooms: [
        { roomIndex: 1, bedType: "KING", bedCount: 1, capacity: 2, bathroomCount: 1 },
        { roomIndex: 1, bedType: "SINGLE", bedCount: 1, capacity: 2, bathroomCount: 2 },
      ],
    });
    expect(res.status).toBe(400);
  });
  it("같은 roomIndex capacity 불일치 거부", async () => {
    const res = await req({
      ...BASE,
      bedrooms: [
        { roomIndex: 1, bedType: "KING", bedCount: 1, capacity: 2 },
        { roomIndex: 1, bedType: "SINGLE", bedCount: 1, capacity: 4 },
      ],
    });
    expect(res.status).toBe(400);
  });
  it("중복 featureKey 거부 (@@unique 사전 차단)", async () => {
    const res = await req({
      ...BASE,
      features: [
        { category: "VIEW", featureKey: "viewSea" },
        { category: "VIEW", featureKey: "viewSea" },
      ],
    });
    expect(res.status).toBe(400);
  });
});

describe("성공 — 스칼라 update + 자식 전체 교체 영속", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } }));

  it("미존재 빌라 404", async () => {
    tx.villa.findUnique.mockResolvedValue(null);
    expect((await req(BASE)).status).toBe(404);
  });

  it("스칼라 update + bedroom/feature deleteMany→createMany 호출", async () => {
    const res = await req(BASE);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ id: "v1", bedroomCount: 2, featureCount: 2 });

    // 스칼라 update — baseDepositVnd는 BigInt로 변환되어 저장
    expect(tx.villa.update).toHaveBeenCalledTimes(1);
    const updData = tx.villa.update.mock.calls[0][0].data;
    expect(updData.baseDepositVnd).toBe(5000000n);
    expect(updData.checkInTime).toBe(840);
    expect(updData.extraBedAvailable).toBe(true);

    // 자식 전체 교체
    expect(tx.villaBedroom.deleteMany).toHaveBeenCalledWith({ where: { villaId: "v1" } });
    expect(tx.villaBedroom.createMany).toHaveBeenCalled();
    expect(tx.villaFeature.deleteMany).toHaveBeenCalledWith({ where: { villaId: "v1" } });
    expect(tx.villaFeature.createMany).toHaveBeenCalled();
    // bedroom 행 매핑 — roomLabel 미입력은 null
    const bedData = tx.villaBedroom.createMany.mock.calls[0][0].data as unknown as Array<{
      roomLabel: unknown;
    }>;
    expect(bedData).toHaveLength(2);
    expect(bedData[1].roomLabel).toBeNull();
  });

  it("전용욕실 자동합산 — Villa.bathrooms = roomIndex별 bathroomCount 합 (중복 행 1회)", async () => {
    const res = await req({
      ...BASE,
      bedrooms: [
        // 1번방: 침대 2행이지만 bathroomCount는 동일(2) → 방 단위 1회만 합산
        { roomIndex: 1, bedType: "KING", bedCount: 1, capacity: 2, bathroomCount: 2 },
        { roomIndex: 1, bedType: "SINGLE", bedCount: 1, capacity: 2, bathroomCount: 2 },
        // 2번방: bathroomCount 1
        { roomIndex: 2, bedType: "TWIN", bedCount: 2, capacity: 2, bathroomCount: 1 },
      ],
    });
    expect(res.status).toBe(200);
    expect(tx.villa.update.mock.calls[0][0].data.bathrooms).toBe(3); // 2 + 1
  });
  it("빈 bedrooms면 bathrooms 자동갱신 안 함 (기존 값 보존)", async () => {
    const res = await req({ ...BASE, bedrooms: [] });
    expect(res.status).toBe(200);
    expect(tx.villa.update.mock.calls[0][0].data.bathrooms).toBeUndefined();
  });
  it("셀링포인트 풀 태그(privatePool) 있으면 hasPool=true 강제 (수영장 자동보정)", async () => {
    const res = await req({
      ...BASE,
      hasPool: false,
      features: [{ category: "FACILITY", featureKey: "privatePool" }],
    });
    expect(res.status).toBe(200);
    expect(tx.villa.update.mock.calls[0][0].data.hasPool).toBe(true);
  });
  it("풀 태그 없고 hasPool=false면 그대로 false (자동 OFF 안 함)", async () => {
    const res = await req({ ...BASE, hasPool: false, features: [] });
    expect(res.status).toBe(200);
    expect(tx.villa.update.mock.calls[0][0].data.hasPool).toBe(false);
  });

  it("빈 bedrooms·features 허용 (전체 해제) — createMany 미호출, deleteMany만", async () => {
    const res = await req({ ...BASE, bedrooms: [], features: [] });
    expect(res.status).toBe(200);
    expect(tx.villaBedroom.deleteMany).toHaveBeenCalled();
    expect(tx.villaBedroom.createMany).not.toHaveBeenCalled();
    expect(tx.villaFeature.createMany).not.toHaveBeenCalled();
  });
});

describe("AuditLog — entity 3종 + wifiPassword 마스킹", () => {
  beforeEach(() => mockAuth.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } }));

  it("Villa·VillaBedroom·VillaFeature 3종 기록", async () => {
    await req(BASE);
    const entities = auditCalls.map((c) => c.entity);
    expect(entities).toContain("Villa");
    expect(entities).toContain("VillaBedroom");
    expect(entities).toContain("VillaFeature");
  });

  it("wifiPassword 평문이 AuditLog changes에 남지 않고 마스킹됨", async () => {
    await req(BASE);
    const villaLog = auditCalls.find((c) => c.entity === "Villa");
    const changes = villaLog?.changes as Record<string, { old?: unknown; new?: unknown }>;
    expect(changes.wifiPassword).toEqual({ old: "***", new: "***" });
    // 어떤 AuditLog에도 평문 비번 문자열이 직렬화되지 않아야 함
    expect(JSON.stringify(auditCalls)).not.toContain("secret-pw-123");
    // baseDepositVnd는 BigInt가 아닌 문자열로 직렬화 (Json 컬럼 안전)
    expect(changes.baseDepositVnd).toEqual({ new: "5000000" });
    // wifiSsid(공개 가능)는 그대로 기록
    expect(changes.wifiSsid).toEqual({ new: "VillaSea" });
  });
});

// /p select 누수 단위 검증 — 페이지 소스에 wifi select가 없고, 신규 공개 필드는 포함됨을 정적 확인
describe("/p 누수 가드 — wifi 미포함 (정적 검증)", async () => {
  const fs = await import("node:fs/promises");
  const fileURL = new URL("../app/p/[token]/page.tsx", import.meta.url);
  const src = await fs.readFile(fileURL, "utf8");

  it("/p villa select에 wifiPassword·wifiSsid 부재 (주석 제외, select 키 미존재)", () => {
    // 주석 텍스트의 단어 언급은 무해 — 실제 select 키(`wifiX: true/false`)가 없어야 한다
    expect(src).not.toMatch(/wifiPassword\s*:/);
    expect(src).not.toMatch(/wifiSsid\s*:/);
  });
  it("/p villa select에 신규 공개 필드 포함 (FE 렌더 가능)", () => {
    for (const f of [
      "googleMapUrl",
      "beachDistanceM",
      "areaSqm",
      "floors",
      "checkInTime",
      "checkOutTime",
      "parkingSlots",
      "baseDepositVnd",
      "extraBedAvailable",
      "bedroomDetails",
      "features",
    ]) {
      expect(src).toContain(f);
    }
  });
});
