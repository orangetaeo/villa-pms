import { describe, expect, it, vi } from "vitest";
import { loadCostAlerts } from "@/lib/cost-alerts";
import type { PrismaClient } from "@prisma/client";

// 회귀: 기간별 원가 일괄변경 등 비호환 payload(season·oldCostVnd 없음)가 들어와도
// loadCostAlerts가 throw하지 않고 그 항목만 건너뛴다(BigInt(undefined) 크래시 방지).
function makerisma(notifPayloads: unknown[]) {
  return {
    notification: {
      findMany: vi.fn(async () =>
        notifPayloads.map((payload, i) => ({ id: `n${i}`, payload, createdAt: new Date("2026-06-24T00:00:00Z") }))
      ),
    },
    proposal: { findMany: vi.fn(async () => [{ id: "pr1", token: "tok", clientName: "C", saleCurrency: "VND", items: [] }]) },
    // ADR-0014: 판매가 조회는 VillaRatePeriod 시즌 대표행 기반(구 villaRate 제거).
    villaRatePeriod: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient;
}

describe("loadCostAlerts — 비호환 payload 방어", () => {
  it("season·oldCostVnd 없는 payload는 건너뜀(throw 안 함)", async () => {
    const prisma = makerisma([
      { villaId: "v1", villaName: "V1", proposalId: "pr1", change: "ratePeriodsCost" }, // 신규 비호환 형태
    ]);
    const groups = await loadCostAlerts(prisma, "admin1");
    expect(groups).toEqual([]); // 크래시 없이 빈 결과
  });

  it("호환 payload는 정상 처리", async () => {
    const prisma = makerisma([
      { villaId: "v1", villaName: "V1", season: "PEAK", oldCostVnd: "5000000", newCostVnd: "6000000", proposalId: "pr1" },
    ]);
    const groups = await loadCostAlerts(prisma, "admin1");
    expect(groups).toHaveLength(1);
    expect(groups[0].rows[0]).toMatchObject({ season: "PEAK", oldCostVnd: "5000000", newCostVnd: "6000000" });
  });

  it("혼재 — 비호환은 건너뛰고 호환만 처리(throw 없음)", async () => {
    const prisma = makerisma([
      { villaId: "v1", villaName: "V1", proposalId: "pr1", change: "ratePeriodsCost" },
      { villaId: "v1", villaName: "V1", season: "HIGH", oldCostVnd: "2000000", newCostVnd: null, proposalId: "pr1" },
    ]);
    const groups = await loadCostAlerts(prisma, "admin1");
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].season).toBe("HIGH");
  });
});
