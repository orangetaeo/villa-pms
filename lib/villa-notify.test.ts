// T-admin-supplier-visibility — 공급자 빌라 이벤트 → 운영자 통지
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  maybeNotifyVillaContentUpdated,
  notifyOperatorsVillaPendingReview,
} from "./villa-notify";

interface MockOptions {
  operators?: { id: string }[];
  villa?: { status: string; name: string } | null;
  pendingDup?: { id: string } | null;
}

function mockDb(opts: MockOptions = {}) {
  const userFindMany = vi.fn(async () => opts.operators ?? [{ id: "op-1" }, { id: "op-2" }]);
  const villaFindUnique = vi.fn(async () => opts.villa ?? null);
  const notifFindFirst = vi.fn(async () => opts.pendingDup ?? null);
  const notifCreate = vi.fn(async (args: unknown) => args);
  const db = {
    user: { findMany: userFindMany },
    villa: { findUnique: villaFindUnique },
    notification: { findFirst: notifFindFirst, create: notifCreate },
  } as unknown as PrismaClient;
  return { db, userFindMany, villaFindUnique, notifFindFirst, notifCreate };
}

describe("notifyOperatorsVillaPendingReview — 신규 등록·재제출 승인 대기 통지", () => {
  it("zalo 연결 활성 운영자 전원에게 1건씩 적재, payload에 resubmitted 포함", async () => {
    const m = mockDb({ operators: [{ id: "op-1" }, { id: "op-2" }] });
    await notifyOperatorsVillaPendingReview(m.db, {
      villaId: "v1",
      villaName: "테스트 빌라",
      supplierName: "Tyy",
      resubmitted: true,
    });
    expect(m.notifCreate).toHaveBeenCalledTimes(2);
    const first = m.notifCreate.mock.calls[0][0] as {
      data: { type: string; payload: Record<string, unknown> };
    };
    expect(first.data.type).toBe("VILLA_PENDING_REVIEW");
    expect(first.data.payload).toMatchObject({
      villaId: "v1",
      villaName: "테스트 빌라",
      supplierName: "Tyy",
      resubmitted: true,
    });
  });

  it("운영자 0명(미연결)이어도 예외 없이 0건", async () => {
    const m = mockDb({ operators: [] });
    await notifyOperatorsVillaPendingReview(m.db, {
      villaId: "v1",
      villaName: "V",
      supplierName: "S",
      resubmitted: false,
    });
    expect(m.notifCreate).not.toHaveBeenCalled();
  });
});

describe("maybeNotifyVillaContentUpdated — 승인 후 콘텐츠 수정 통지 게이트", () => {
  it("actor가 SUPPLIER가 아니면(운영자 자기 수정) 아무 조회도 안 함", async () => {
    const m = mockDb();
    await maybeNotifyVillaContentUpdated(m.db, {
      villaId: "v1",
      kind: "PHOTOS",
      actorRole: "ADMIN",
    });
    expect(m.villaFindUnique).not.toHaveBeenCalled();
    expect(m.notifCreate).not.toHaveBeenCalled();
  });

  it("빌라가 ACTIVE가 아니면(마법사·재제출 중) 통지 스킵", async () => {
    const m = mockDb({ villa: { status: "PENDING_REVIEW", name: "V" } });
    await maybeNotifyVillaContentUpdated(m.db, {
      villaId: "v1",
      kind: "AMENITIES",
      actorRole: "SUPPLIER",
    });
    expect(m.notifCreate).not.toHaveBeenCalled();
  });

  it("ACTIVE + 중복 없음 → 운영자 전원에게 VILLA_CONTENT_UPDATED 적재", async () => {
    const m = mockDb({
      villa: { status: "ACTIVE", name: "썬셋 A3" },
      operators: [{ id: "op-1" }],
    });
    await maybeNotifyVillaContentUpdated(m.db, {
      villaId: "v1",
      kind: "INFO",
      actorRole: "SUPPLIER",
    });
    expect(m.notifCreate).toHaveBeenCalledTimes(1);
    const call = m.notifCreate.mock.calls[0][0] as {
      data: { type: string; payload: Record<string, unknown> };
    };
    expect(call.data.type).toBe("VILLA_CONTENT_UPDATED");
    expect(call.data.payload).toMatchObject({ villaId: "v1", villaName: "썬셋 A3", kind: "INFO" });
  });

  it("같은 빌라·같은 kind의 PENDING 알림이 있으면 스킵(연속 업로드 1건 수렴)", async () => {
    const m = mockDb({
      villa: { status: "ACTIVE", name: "V" },
      pendingDup: { id: "n-1" },
    });
    await maybeNotifyVillaContentUpdated(m.db, {
      villaId: "v1",
      kind: "PHOTOS",
      actorRole: "SUPPLIER",
    });
    expect(m.notifCreate).not.toHaveBeenCalled();
  });

  it("db 예외는 삼킨다(best-effort — 본 mutation 성공에 영향 없음)", async () => {
    const m = mockDb({ villa: { status: "ACTIVE", name: "V" } });
    (m.db.notification.findFirst as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("db down")
    );
    await expect(
      maybeNotifyVillaContentUpdated(m.db, { villaId: "v1", kind: "PHOTOS", actorRole: "SUPPLIER" })
    ).resolves.toBeUndefined();
  });
});
