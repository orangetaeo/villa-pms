// 발행 고아(PUBLISHING) 자동 회수 회귀 테스트 (T-publish-orphan-reaper)
//   2026-07-22 사고: 발행 cron이 QUEUED→PUBLISHING 선점 후 배포 교체 502로 죽어 행이 PUBLISHING에 영구히 갇혔다.
//   reapStalePublishing()은 45분 초과 PUBLISHING만 FAILED로 회수하고(살아있는 발행은 보호),
//   ★ QUEUED로는 절대 되돌리지 않는다(중복 게시 방지 — 이 파일의 핵심 회귀 단언).
//
//   prisma는 in-memory 페이크로 모킹한다. where 조건(status·updatedAt lt cutoff)이 실제로 걸러지는지까지
//   검증하려면 단순 mockResolvedValue로는 부족하기 때문(컷오프 미만 보호·다른 status 무영향·경합 가드가
//   전부 조건식 자체의 계약이다 — 반환값만 목킹하면 가드를 지워도 테스트가 통과한다, QA 지적 F1).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface Row {
  id: string;
  status: string;
  updatedAt: Date;
  failReason: string | null;
  igMediaId?: string | null;
}

interface WhereClause {
  id?: string;
  status?: string;
  updatedAt?: { lt?: Date };
}

const store: { instagramPost: Row[]; youtubeShort: Row[] } = { instagramPost: [], youtubeShort: [] };

function matches(row: Row, where: WhereClause): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.status !== undefined && row.status !== where.status) return false;
  if (where.updatedAt?.lt !== undefined && !(row.updatedAt < where.updatedAt.lt)) return false;
  return true;
}

const igUpdateMany = vi.fn(async ({ where, data }: { where: WhereClause; data: Partial<Row> }) =>
  applyUpdate(store.instagramPost, where, data)
);
const ytUpdateMany = vi.fn(async ({ where, data }: { where: WhereClause; data: Partial<Row> }) =>
  applyUpdate(store.youtubeShort, where, data)
);

function applyUpdate(rows: Row[], where: WhereClause, data: Partial<Row>) {
  const hits = rows.filter((r) => matches(r, where));
  for (const r of hits) {
    Object.assign(r, data);
    r.updatedAt = new Date(); // Prisma @updatedAt 에뮬레이션
  }
  return { count: hits.length };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    instagramPost: {
      findMany: async ({ where }: { where: WhereClause }) =>
        store.instagramPost.filter((r) => matches(r, where)).map((r) => ({ id: r.id })),
      updateMany: (args: { where: WhereClause; data: Partial<Row> }) => igUpdateMany(args),
    },
    youtubeShort: {
      findMany: async ({ where }: { where: WhereClause }) =>
        store.youtubeShort.filter((r) => matches(r, where)).map((r) => ({ id: r.id })),
      updateMany: (args: { where: WhereClause; data: Partial<Row> }) => ytUpdateMany(args),
    },
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }));

const notifyMarketing = vi.fn();
vi.mock("@/lib/marketing-notify", () => ({ notifyMarketing: (...a: unknown[]) => notifyMarketing(...a) }));

import {
  reapStalePublishing,
  PUBLISH_ORPHAN_FAIL_REASON,
  PUBLISH_ORPHAN_TIMEOUT_MS,
} from "@/lib/marketing/reap-stale-publishing";

const NOW = new Date("2026-07-23T04:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);

const row = (id: string, status: string, ageMin: number): Row => ({
  id,
  status,
  updatedAt: minutesAgo(ageMin),
  failReason: null,
});

/** 컷오프(45분) 초과 = 고아. */
const STALE_MIN = 46;
/** 컷오프 미만 = 아직 살아있는 발행(회수 금지). */
const LIVE_MIN = 44;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  store.instagramPost = [];
  store.youtubeShort = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reapStalePublishing — 고아 판정", () => {
  // ★ 컷오프 근거는 maxDuration(Vercel 힌트 — self-hosted에서 미강제)이 아니라 발행 경로 fetch 타임아웃 합이다.
  //   인스타 캐러셀 10장 최악 ≈23분(자식 생성 10×30s + 자식 폴링 10×90s + 부모 30s+90s + publish 30s + permalink 30s).
  //   45분 = 그 약 2배. lib/instagram/publish.ts의 타임아웃·캐러셀 장수를 올리면 이 값도 함께 올려야 한다.
  it("컷오프는 45분이다(캐러셀 최악 ≈23분의 약 2배)", () => {
    expect(PUBLISH_ORPHAN_TIMEOUT_MS).toBe(45 * 60 * 1000);
    expect(PUBLISH_ORPHAN_TIMEOUT_MS).toBeGreaterThan(23 * 60 * 1000);
  });

  it("컷오프 초과 PUBLISHING은 FAILED + failReason으로 회수하고 감사로그 1건을 남긴다", async () => {
    store.instagramPost = [row("ig-1", "PUBLISHING", STALE_MIN)];

    const res = await reapStalePublishing();

    expect(res).toEqual({ instagram: 1, youtube: 0 });
    expect(store.instagramPost[0].status).toBe("FAILED");
    expect(store.instagramPost[0].failReason).toBe(PUBLISH_ORPHAN_FAIL_REASON);
    expect(writeAuditLog).toHaveBeenCalledOnce();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        action: "UPDATE",
        entity: "InstagramPost",
        entityId: "ig-1",
        changes: expect.objectContaining({ status: { old: "PUBLISHING", new: "FAILED" } }),
      })
    );
  });

  it("★ 회수 결과는 QUEUED가 아니라 FAILED다 (자동 재발행 = 중복 게시 회귀 방지)", async () => {
    store.instagramPost = [row("ig-1", "PUBLISHING", STALE_MIN)];
    store.youtubeShort = [row("yt-1", "PUBLISHING", STALE_MIN)];

    await reapStalePublishing();

    expect(store.instagramPost[0].status).toBe("FAILED");
    expect(store.youtubeShort[0].status).toBe("FAILED");
    expect(store.instagramPost[0].status).not.toBe("QUEUED");
    expect(store.youtubeShort[0].status).not.toBe("QUEUED");
    // 어떤 갱신도 QUEUED를 쓰지 않았다.
    for (const call of [...igUpdateMany.mock.calls, ...ytUpdateMany.mock.calls]) {
      expect(call[0].data.status).toBe("FAILED");
    }
  });

  it("컷오프 직전(44분) PUBLISHING은 건드리지 않는다(살아있는 발행 보호)", async () => {
    store.instagramPost = [row("ig-live", "PUBLISHING", LIVE_MIN)];
    store.youtubeShort = [row("yt-live", "PUBLISHING", LIVE_MIN)];

    const res = await reapStalePublishing();

    expect(res).toEqual({ instagram: 0, youtube: 0 });
    expect(store.instagramPost[0].status).toBe("PUBLISHING");
    expect(store.youtubeShort[0].status).toBe("PUBLISHING");
    expect(igUpdateMany).not.toHaveBeenCalled();
    expect(ytUpdateMany).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("QUEUED·PUBLISHED·FAILED 행은 아무리 오래돼도 영향 없다", async () => {
    store.instagramPost = [
      row("ig-q", "QUEUED", 999),
      row("ig-p", "PUBLISHED", 999),
      row("ig-f", "FAILED", 999),
    ];
    store.youtubeShort = [row("yt-q", "QUEUED", 999), row("yt-p", "PUBLISHED", 999)];

    const res = await reapStalePublishing();

    expect(res).toEqual({ instagram: 0, youtube: 0 });
    expect(store.instagramPost.map((r) => r.status)).toEqual(["QUEUED", "PUBLISHED", "FAILED"]);
    expect(store.youtubeShort.map((r) => r.status)).toEqual(["QUEUED", "PUBLISHED"]);
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(notifyMarketing).not.toHaveBeenCalled();
  });

  it("유튜브 고아도 회수하며 편집 축이 아닌 발행 축(status)만 바꾼다", async () => {
    store.youtubeShort = [row("yt-1", "PUBLISHING", STALE_MIN), row("yt-2", "PUBLISHING", STALE_MIN)];

    const res = await reapStalePublishing();

    expect(res).toEqual({ instagram: 0, youtube: 2 });
    expect(ytUpdateMany.mock.calls[0][0].data).toEqual({
      status: "FAILED",
      failReason: PUBLISH_ORPHAN_FAIL_REASON,
    });
    expect(writeAuditLog).toHaveBeenCalledTimes(2);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entity: "YoutubeShort" }));
  });

  it("갱신 직전에 다른 실행이 상태를 바꿔 count=0이면 세지도 않고 감사로그도 없다", async () => {
    store.instagramPost = [row("ig-1", "PUBLISHING", STALE_MIN)];
    igUpdateMany.mockImplementationOnce(async () => ({ count: 0 })); // 방금 PUBLISHED된 행

    const res = await reapStalePublishing();

    expect(res).toEqual({ instagram: 0, youtube: 0 });
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(notifyMarketing).not.toHaveBeenCalled();
  });

  // ★ 원자성 가드 실증(QA 지적 F1): 위 테스트는 updateMany의 **반환값**을 목킹하므로 호출부 처리만 검증한다.
  //   where의 status 가드를 지워도(예: {id}만 남겨도) 통과해버린다. 여기서는 실제 store에 경합을 재현하고
  //   갱신 판정을 페이크 DB(applyUpdate)에 위임해 **가드 자체**를 검증한다.
  //   (검출력 확인: where를 {id}로 바꾸면 이 테스트가 실패한다 — 실제로 뮤테이션해 확인함.)
  it("★ findMany 직후 그 행이 발행 성공(PUBLISHED)하면 덮어쓰지 않는다 — updateMany status 가드", async () => {
    store.instagramPost = [row("ig-1", "PUBLISHING", STALE_MIN)];
    // 고아로 집힌 뒤 updateMany가 돌기 직전, 다른 실행이 발행을 성공시킨다.
    igUpdateMany.mockImplementationOnce(async ({ where, data }) => {
      const target = store.instagramPost.find((r) => r.id === "ig-1")!;
      target.status = "PUBLISHED";
      target.igMediaId = "media-999";
      target.updatedAt = new Date(); // @updatedAt 갱신
      return applyUpdate(store.instagramPost, where, data); // 판정은 페이크 DB(=조건식)에 위임
    });

    const res = await reapStalePublishing();

    expect(res).toEqual({ instagram: 0, youtube: 0 });
    expect(store.instagramPost[0].status).toBe("PUBLISHED"); // 발행 성공을 덮어쓰지 않았다
    expect(store.instagramPost[0].igMediaId).toBe("media-999");
    expect(store.instagramPost[0].failReason).toBeNull();
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(notifyMarketing).not.toHaveBeenCalled();
  });
});

describe("reapStalePublishing — 운영자 경보", () => {
  it("회수분이 있으면 모델별 기존 kind로 경보한다(새 enum 추가 없음)", async () => {
    store.instagramPost = [row("ig-1", "PUBLISHING", STALE_MIN)];
    store.youtubeShort = [row("yt-1", "PUBLISHING", STALE_MIN)];

    await reapStalePublishing();

    expect(notifyMarketing).toHaveBeenCalledTimes(2);
    expect(notifyMarketing).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "IG_PUBLISH_FAILED", href: "/marketing/instagram" })
    );
    expect(notifyMarketing).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "YT_PUBLISH_FAILED", href: "/marketing/youtube" })
    );
  });

  it("회수 0건이면 알림을 보내지 않는다", async () => {
    store.instagramPost = [row("ig-live", "PUBLISHING", LIVE_MIN)];
    store.youtubeShort = [];

    const res = await reapStalePublishing();

    expect(res).toEqual({ instagram: 0, youtube: 0 });
    expect(notifyMarketing).not.toHaveBeenCalled();
  });

  it("알림 실패는 회수 결과를 깨지 않는다(격리)", async () => {
    store.youtubeShort = [row("yt-1", "PUBLISHING", STALE_MIN)];
    notifyMarketing.mockRejectedValueOnce(new Error("zalo down"));

    await expect(reapStalePublishing()).resolves.toEqual({ instagram: 0, youtube: 1 });
    expect(store.youtubeShort[0].status).toBe("FAILED");
  });

  // ★ 부분 실패 격리(QA 지적 F3): 예전 구조는 IG를 회수한 뒤 어디서든 throw하면 함수 전체가 터져
  //   **행은 이미 FAILED인데 경보가 한 번도 안 나가는** 조용한 유실이 났다(다음 주기엔 PUBLISHING이 아니라 재감지 불가).
  it("한 축이 도중에 실패해도 그때까지의 회수분은 경보하고, 다른 축은 계속 돈다", async () => {
    store.instagramPost = [row("ig-1", "PUBLISHING", STALE_MIN), row("ig-2", "PUBLISHING", STALE_MIN)];
    store.youtubeShort = [row("yt-1", "PUBLISHING", STALE_MIN)];
    igUpdateMany
      .mockImplementationOnce(async ({ where, data }) => applyUpdate(store.instagramPost, where, data))
      .mockImplementationOnce(async () => {
        throw new Error("db connection lost");
      });

    const res = await reapStalePublishing();

    // IG는 1건까지 회수 후 중단, 유튜브 축은 정상 진행.
    expect(res).toEqual({ instagram: 1, youtube: 1 });
    expect(store.instagramPost[0].status).toBe("FAILED");
    expect(store.instagramPost[1].status).toBe("PUBLISHING"); // 실패해 회수되지 않은 행은 그대로 → 다음 주기 재시도
    expect(store.youtubeShort[0].status).toBe("FAILED");
    // 성공한 회수분의 경보는 반드시 나간다(두 축 모두).
    expect(notifyMarketing).toHaveBeenCalledTimes(2);
    expect(notifyMarketing).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "IG_PUBLISH_FAILED", summary: expect.stringContaining("1건") })
    );
    expect(notifyMarketing).toHaveBeenCalledWith(expect.objectContaining({ kind: "YT_PUBLISH_FAILED" }));
  });
});
