import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BlockSource,
  BookingStatus,
  VillaStatus,
  type PrismaClient,
} from "@prisma/client";

// 실제 PrismaClient 생성 차단 — audit-log·prisma는 전역 클라이언트를 import한다
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { writeAuditLog } from "@/lib/audit-log";
import {
  diffIcalEvents,
  findEventBookingConflicts,
  findUnresolvedIcalConflicts,
  parseIcs,
  runIcalSync,
  syncVillaIcal,
  unfoldIcsLines,
  type ExistingIcalBlock,
  type FetchLike,
  type IcalEvent,
} from "@/lib/ical";
import { GET as cronGet } from "../app/api/cron/ical-sync/route";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function vevent(lines: string[]): string {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
}

function ics(...events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join(
    "\r\n"
  );
}

// ===================== 파서 =====================

describe("unfoldIcsLines", () => {
  it("공백/탭으로 시작하는 줄을 직전 줄에 이어붙인다 (RFC 5545)", () => {
    const lines = unfoldIcsLines(
      "SUMMARY:Airbnb (Not\r\n  available)\r\nUID:x\r\n\ty"
    );
    expect(lines).toEqual(["SUMMARY:Airbnb (Not available)", "UID:xy"]);
  });
});

describe("parseIcs — 날짜 결정 (계약 QA 조건 2)", () => {
  it("VALUE=DATE 종일 이벤트는 그 날짜 그대로 UTC 자정", () => {
    const { events, warnings } = parseIcs(
      ics(
        vevent([
          "UID:a1",
          "DTSTART;VALUE=DATE:20260701",
          "DTEND;VALUE=DATE:20260705",
        ])
      )
    );
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].startDate).toEqual(d("2026-07-01"));
    expect(events[0].endDate).toEqual(d("2026-07-05"));
  });

  it("bare yyyymmdd(파라미터 없는 DATE)도 동일하게 해석한다", () => {
    const { events } = parseIcs(
      ics(vevent(["UID:a2", "DTSTART:20260701", "DTEND:20260703"]))
    );
    expect(events[0].startDate).toEqual(d("2026-07-01"));
    expect(events[0].endDate).toEqual(d("2026-07-03"));
  });

  it("Z(UTC 순간)는 Asia/Ho_Chi_Minh 로컬 날짜로 환산한다", () => {
    // 2026-06-30T18:00Z = VN 2026-07-01 01:00 → 시작일 07-01
    // 2026-07-04T17:00Z = VN 2026-07-05 00:00 정각 → 올림 없이 07-05
    const { events } = parseIcs(
      ics(
        vevent(["UID:z1", "DTSTART:20260630T180000Z", "DTEND:20260704T170000Z"])
      )
    );
    expect(events[0].startDate).toEqual(d("2026-07-01"));
    expect(events[0].endDate).toEqual(d("2026-07-05"));
  });

  it("DTEND의 로컬 시간 성분이 자정이 아니면 +1일 올림 (재고 보수)", () => {
    // 2026-07-04T18:00Z = VN 2026-07-05 01:00 → 올림 → 07-06
    const { events } = parseIcs(
      ics(
        vevent(["UID:z2", "DTSTART:20260630T180000Z", "DTEND:20260704T180000Z"])
      )
    );
    expect(events[0].endDate).toEqual(d("2026-07-06"));
  });

  it("TZID DATE-TIME은 벽시계 날짜부를 직취한다 (체크아웃 시간은 올림)", () => {
    const { events } = parseIcs(
      ics(
        vevent([
          "UID:t1",
          "DTSTART;TZID=Asia/Ho_Chi_Minh:20260701T140000",
          "DTEND;TZID=Asia/Ho_Chi_Minh:20260705T110000",
        ])
      )
    );
    expect(events[0].startDate).toEqual(d("2026-07-01"));
    expect(events[0].endDate).toEqual(d("2026-07-06")); // 11:00 체크아웃 → 올림
  });

  it("Intl이 거부하는 미지원 TZID는 이벤트 스킵 + 경고", () => {
    const { events, warnings } = parseIcs(
      ics(
        vevent([
          "UID:bad-tz",
          "DTSTART;TZID=Not/AZone:20260701T140000",
          "DTEND;TZID=Not/AZone:20260705T110000",
        ])
      )
    );
    expect(events).toHaveLength(0);
    expect(warnings.some((w) => w.includes("bad-tz"))).toBe(true);
  });
});

describe("parseIcs — 이벤트 선별", () => {
  it("DTEND 누락 시 DTSTART+1일 (RFC 5545 종일 규정)", () => {
    const { events } = parseIcs(
      ics(vevent(["UID:e1", "DTSTART;VALUE=DATE:20260701"]))
    );
    expect(events[0].endDate).toEqual(d("2026-07-02"));
  });

  it("STATUS:CANCELLED 이벤트는 제외한다", () => {
    const { events } = parseIcs(
      ics(
        vevent([
          "UID:c1",
          "DTSTART;VALUE=DATE:20260701",
          "DTEND;VALUE=DATE:20260703",
          "STATUS:CANCELLED",
        ]),
        vevent([
          "UID:c2",
          "DTSTART;VALUE=DATE:20260710",
          "DTEND;VALUE=DATE:20260712",
        ])
      )
    );
    expect(events.map((e) => e.uid)).toEqual(["c2"]);
  });

  it("UID 누락 이벤트는 스킵 + 경고", () => {
    const { events, warnings } = parseIcs(
      ics(vevent(["DTSTART;VALUE=DATE:20260701", "DTEND;VALUE=DATE:20260703"]))
    );
    expect(events).toHaveLength(0);
    expect(warnings.some((w) => w.includes("UID 누락"))).toBe(true);
  });

  it("endDate ≤ startDate 이상 이벤트는 스킵 + 경고", () => {
    const { events, warnings } = parseIcs(
      ics(
        vevent([
          "UID:rev",
          "DTSTART;VALUE=DATE:20260705",
          "DTEND;VALUE=DATE:20260701",
        ])
      )
    );
    expect(events).toHaveLength(0);
    expect(warnings.some((w) => w.includes("rev"))).toBe(true);
  });

  it("같은 피드 내 중복 UID는 마지막 이벤트 채택 + 경고", () => {
    const { events, warnings } = parseIcs(
      ics(
        vevent([
          "UID:dup",
          "DTSTART;VALUE=DATE:20260701",
          "DTEND;VALUE=DATE:20260703",
        ]),
        vevent([
          "UID:dup",
          "DTSTART;VALUE=DATE:20260710",
          "DTEND;VALUE=DATE:20260712",
        ])
      )
    );
    expect(events).toHaveLength(1);
    expect(events[0].startDate).toEqual(d("2026-07-10"));
    expect(warnings.some((w) => w.includes("dup"))).toBe(true);
  });

  it("DURATION(DTEND 없음)은 미지원 — 스킵 + 경고", () => {
    const { events, warnings } = parseIcs(
      ics(vevent(["UID:dur", "DTSTART;VALUE=DATE:20260701", "DURATION:P3D"]))
    );
    expect(events).toHaveLength(0);
    expect(warnings.some((w) => w.includes("DURATION"))).toBe(true);
  });
});

// ===================== diff =====================

describe("diffIcalEvents", () => {
  const block = (
    id: string,
    uid: string | null,
    start: string,
    end: string
  ): ExistingIcalBlock => ({
    id,
    icalUid: uid,
    startDate: d(start),
    endDate: d(end),
  });
  const event = (uid: string, start: string, end: string): IcalEvent => ({
    uid,
    startDate: d(start),
    endDate: d(end),
  });

  it("생성/날짜변경/소멸을 UID 기준으로 분류한다", () => {
    const diff = diffIcalEvents(
      [
        block("b1", "keep", "2026-07-01", "2026-07-03"),
        block("b2", "moved", "2026-07-10", "2026-07-12"),
        block("b3", "gone", "2026-08-01", "2026-08-03"),
      ],
      [
        event("keep", "2026-07-01", "2026-07-03"),
        event("moved", "2026-07-11", "2026-07-13"),
        event("new", "2026-09-01", "2026-09-03"),
      ]
    );
    expect(diff.toCreate.map((e) => e.uid)).toEqual(["new"]);
    expect(diff.toUpdate.map((u) => u.blockId)).toEqual(["b2"]);
    expect(diff.toDelete.map((b) => b.id)).toEqual(["b3"]);
  });

  it("동일 입력이면 변경 0건 (멱등)", () => {
    const existing = [block("b1", "u1", "2026-07-01", "2026-07-03")];
    const diff = diffIcalEvents(existing, [
      event("u1", "2026-07-01", "2026-07-03"),
    ]);
    expect(diff.toCreate).toHaveLength(0);
    expect(diff.toUpdate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(0);
  });

  it("icalUid=null 고아 ICAL 블록은 삭제 대상", () => {
    const diff = diffIcalEvents([block("b9", null, "2026-07-01", "2026-07-03")], []);
    expect(diff.toDelete.map((b) => b.id)).toEqual(["b9"]);
  });
});

// ===================== 충돌 감지 =====================

describe("findEventBookingConflicts", () => {
  const event: IcalEvent = {
    uid: "ev",
    startDate: d("2026-07-05"),
    endDate: d("2026-07-08"),
  };

  it("점유 예약과 half-open 겹침이면 충돌", () => {
    const conflicts = findEventBookingConflicts(
      [event],
      [
        {
          id: "bk1",
          status: BookingStatus.CONFIRMED,
          checkIn: d("2026-07-07"),
          checkOut: d("2026-07-10"),
        },
      ]
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ uid: "ev", bookingId: "bk1" });
  });

  it("back-to-back(이벤트 종료일 = 체크인일)은 충돌 아님", () => {
    const conflicts = findEventBookingConflicts(
      [event],
      [
        {
          id: "bk2",
          status: BookingStatus.HOLD,
          checkIn: d("2026-07-08"),
          checkOut: d("2026-07-10"),
        },
      ]
    );
    expect(conflicts).toHaveLength(0);
  });
});

// ===================== DB 래퍼 (fake db) =====================

interface FakeBlock {
  id: string;
  villaId: string;
  startDate: Date;
  endDate: Date;
  source: BlockSource;
  icalUid: string | null;
  note?: string | null;
}

interface FakeBooking {
  id: string;
  villaId: string;
  status: BookingStatus;
  checkIn: Date;
  checkOut: Date;
}

interface FakeVilla {
  id: string;
  name: string;
  status: VillaStatus;
  icalImportUrls: string[];
}

function makeFakeDb(init: {
  blocks?: FakeBlock[];
  bookings?: FakeBooking[];
  villas?: FakeVilla[];
  failFindManyForVillaId?: string;
}) {
  let seq = 0;
  const state = {
    blocks: [...(init.blocks ?? [])],
    bookings: init.bookings ?? [],
    villas: init.villas ?? [],
  };

  const matchVillaId = (value: unknown, villaId: string) =>
    value === undefined ||
    value === villaId ||
    (typeof value === "object" &&
      value !== null &&
      (value as { in: string[] }).in.includes(villaId));

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = {
    calendarBlock: {
      findMany: async ({ where, select }: any) => {
        if (
          init.failFindManyForVillaId &&
          where.villaId === init.failFindManyForVillaId
        ) {
          throw new Error("DB 장애 시뮬레이션");
        }
        return state.blocks
          .filter(
            (b) =>
              matchVillaId(where.villaId, b.villaId) &&
              (where.source === undefined || b.source === where.source) &&
              (where.endDate?.gt === undefined ||
                b.endDate.getTime() > where.endDate.gt.getTime())
          )
          .map((b) =>
            select?.villa
              ? {
                  ...b,
                  villa: {
                    name:
                      state.villas.find((v) => v.id === b.villaId)?.name ?? "?",
                  },
                }
              : { ...b }
          );
      },
      create: async ({ data }: any) => {
        const blockData = data as Omit<FakeBlock, "id">;
        const created: FakeBlock = { id: `blk_${++seq}`, ...blockData };
        state.blocks.push(created);
        return { id: created.id };
      },
      update: async ({ where, data }: any) => {
        const target = state.blocks.find((b) => b.id === where.id);
        if (!target) throw new Error("not found");
        Object.assign(target, data);
        return { ...target };
      },
      deleteMany: async ({ where }: any) => {
        const ids = new Set(where.id.in as string[]);
        const before = state.blocks.length;
        state.blocks = state.blocks.filter(
          (b) => !(ids.has(b.id) && b.source === where.source)
        );
        return { count: before - state.blocks.length };
      },
    },
    booking: {
      findMany: async ({ where }: any) =>
        state.bookings
          .filter(
            (b) =>
              matchVillaId(where.villaId, b.villaId) &&
              (where.status.in as BookingStatus[]).includes(b.status) &&
              (where.checkIn?.lt === undefined ||
                b.checkIn.getTime() < where.checkIn.lt.getTime()) &&
              (where.checkOut?.gt === undefined ||
                b.checkOut.getTime() > where.checkOut.gt.getTime())
          )
          .map((b) => ({ ...b })),
    },
    villa: {
      findMany: async ({ where }: any) =>
        state.villas
          .filter(
            (v) => v.status === where.status && v.icalImportUrls.length > 0
          )
          .map((v) => ({
            id: v.id,
            name: v.name,
            icalImportUrls: v.icalImportUrls,
          })),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { db: db as unknown as PrismaClient, state };
}

function makeFakeFetch(responses: Record<string, string | Error>): FetchLike {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = responses[url];
    if (body === undefined) throw new Error(`예상 밖 URL: ${url}`);
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, text: async () => body } as Response;
  }) as FetchLike;
}

const VILLA = { id: "v1", name: "쏘나씨 V12", icalImportUrls: ["https://feed.example/a.ics"] };

const FEED_TWO_EVENTS = ics(
  vevent(["UID:u1", "DTSTART;VALUE=DATE:20260701", "DTEND;VALUE=DATE:20260705"]),
  vevent(["UID:u2", "DTSTART;VALUE=DATE:20260710", "DTEND;VALUE=DATE:20260712"])
);

describe("syncVillaIcal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("최초 동기화: VEVENT → CalendarBlock(ICAL, icalUid) 생성 + AuditLog", async () => {
    const { db, state } = makeFakeDb({});
    const result = await syncVillaIcal(
      db,
      VILLA,
      makeFakeFetch({ "https://feed.example/a.ics": FEED_TWO_EVENTS })
    );
    expect(result).toMatchObject({ created: 2, updated: 0, deleted: 0, deletionSkipped: false });
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks.every((b) => b.source === BlockSource.ICAL)).toBe(true);
    expect(state.blocks.map((b) => b.icalUid).sort()).toEqual(["u1", "u2"]);
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(writeAuditLog).mock.calls[0][0]).toMatchObject({
      userId: null,
      action: "CREATE",
      entity: "CalendarBlock",
    });
  });

  it("멱등성: 동일 ICS 2회째는 생성/갱신/삭제 0건", async () => {
    const { db } = makeFakeDb({});
    const fetchFn = makeFakeFetch({ "https://feed.example/a.ics": FEED_TWO_EVENTS });
    await syncVillaIcal(db, VILLA, fetchFn);
    vi.clearAllMocks();
    const second = await syncVillaIcal(db, VILLA, fetchFn);
    expect(second).toMatchObject({ created: 0, updated: 0, deleted: 0 });
    expect(vi.mocked(writeAuditLog)).not.toHaveBeenCalled();
  });

  it("소멸 UID는 삭제하고 같은 빌라의 MANUAL 블록은 불변", async () => {
    const manual: FakeBlock = {
      id: "manual1",
      villaId: "v1",
      startDate: d("2026-07-20"),
      endDate: d("2026-07-22"),
      source: BlockSource.MANUAL,
      icalUid: null,
    };
    const gone: FakeBlock = {
      id: "gone1",
      villaId: "v1",
      startDate: d("2026-08-01"),
      endDate: d("2026-08-03"),
      source: BlockSource.ICAL,
      icalUid: "vanished",
    };
    const { db, state } = makeFakeDb({ blocks: [manual, gone] });
    const result = await syncVillaIcal(
      db,
      VILLA,
      makeFakeFetch({ "https://feed.example/a.ics": FEED_TWO_EVENTS })
    );
    expect(result.deleted).toBe(1);
    expect(state.blocks.find((b) => b.id === "gone1")).toBeUndefined();
    expect(state.blocks.find((b) => b.id === "manual1")).toBeDefined();
    expect(
      vi.mocked(writeAuditLog).mock.calls.some(
        ([p]) => p.action === "DELETE" && p.entityId === "gone1"
      )
    ).toBe(true);
  });

  it("날짜가 바뀐 UID는 갱신한다", async () => {
    const existing: FakeBlock = {
      id: "mv1",
      villaId: "v1",
      startDate: d("2026-07-01"),
      endDate: d("2026-07-04"), // 피드는 07-05까지 — 변경됨
      source: BlockSource.ICAL,
      icalUid: "u1",
    };
    const { db, state } = makeFakeDb({ blocks: [existing] });
    const result = await syncVillaIcal(
      db,
      VILLA,
      makeFakeFetch({ "https://feed.example/a.ics": FEED_TWO_EVENTS })
    );
    expect(result.updated).toBe(1);
    expect(state.blocks.find((b) => b.id === "mv1")?.endDate).toEqual(
      d("2026-07-05")
    );
  });

  it("fetch 실패 시 기존 ICAL 블록을 삭제하지 않는다 (재고 보수)", async () => {
    const existing: FakeBlock = {
      id: "keep1",
      villaId: "v1",
      startDate: d("2026-07-01"),
      endDate: d("2026-07-05"),
      source: BlockSource.ICAL,
      icalUid: "u1",
    };
    const { db, state } = makeFakeDb({ blocks: [existing] });
    const result = await syncVillaIcal(
      db,
      VILLA,
      makeFakeFetch({ "https://feed.example/a.ics": new Error("타임아웃") })
    );
    expect(result).toMatchObject({ created: 0, updated: 0, deleted: 0, deletionSkipped: true });
    expect(result.errors).toHaveLength(1);
    expect(state.blocks).toHaveLength(1);
  });

  it("URL 2개 중 1개 실패: 삭제 0건 + 성공 URL의 upsert는 정상 수행 (QA 조건 1)", async () => {
    const villa2urls = {
      ...VILLA,
      icalImportUrls: ["https://feed.example/ok.ics", "https://feed.example/down.ics"],
    };
    // down.ics 출처였던 기존 블록 — 실패 시 소멸로 오판해 삭제하면 안 됨
    const fromDownFeed: FakeBlock = {
      id: "down1",
      villaId: "v1",
      startDate: d("2026-08-10"),
      endDate: d("2026-08-12"),
      source: BlockSource.ICAL,
      icalUid: "down-uid",
    };
    const { db, state } = makeFakeDb({ blocks: [fromDownFeed] });
    const result = await syncVillaIcal(
      db,
      villa2urls,
      makeFakeFetch({
        "https://feed.example/ok.ics": FEED_TWO_EVENTS,
        "https://feed.example/down.ics": new Error("HTTP 503"),
      })
    );
    expect(result.created).toBe(2); // 성공 피드 upsert는 수행
    expect(result.deleted).toBe(0); // 삭제는 전면 스킵
    expect(result.deletionSkipped).toBe(true);
    expect(state.blocks.find((b) => b.id === "down1")).toBeDefined();
  });

  it("허용되지 않은 URL 스킴(file:)은 해당 URL 실패 처리 (SSRF 차단)", async () => {
    const result = await syncVillaIcal(
      makeFakeDb({}).db,
      { ...VILLA, icalImportUrls: ["file:///etc/passwd"] },
      makeFakeFetch({})
    );
    expect(result.errors.some((e) => e.includes("스킴"))).toBe(true);
    expect(result.deletionSkipped).toBe(true);
  });

  it("점유 예약과 겹친 이벤트는 충돌 보고 + 블록은 그래도 생성 (점유 우선)", async () => {
    const { db, state } = makeFakeDb({
      bookings: [
        {
          id: "bk1",
          villaId: "v1",
          status: BookingStatus.CONFIRMED,
          checkIn: d("2026-07-03"),
          checkOut: d("2026-07-06"),
        },
        {
          id: "bk-cancelled",
          villaId: "v1",
          status: BookingStatus.CANCELLED,
          checkIn: d("2026-07-03"),
          checkOut: d("2026-07-06"),
        },
      ],
    });
    const result = await syncVillaIcal(
      db,
      VILLA,
      makeFakeFetch({ "https://feed.example/a.ics": FEED_TWO_EVENTS })
    );
    expect(result.conflicts).toHaveLength(1); // CANCELLED는 비점유 — 미보고
    expect(result.conflicts[0]).toMatchObject({ uid: "u1", bookingId: "bk1" });
    expect(state.blocks).toHaveLength(2); // 충돌이어도 생성
  });
});

describe("runIcalSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ACTIVE + icalImportUrls 있는 빌라만 순회하고 집계한다", async () => {
    const { db } = makeFakeDb({
      villas: [
        { id: "v1", name: "A", status: VillaStatus.ACTIVE, icalImportUrls: ["https://feed.example/a.ics"] },
        { id: "v-inactive", name: "B", status: VillaStatus.INACTIVE, icalImportUrls: ["https://feed.example/x.ics"] },
        { id: "v-nourl", name: "C", status: VillaStatus.ACTIVE, icalImportUrls: [] },
      ],
    });
    const summary = await runIcalSync(
      db,
      makeFakeFetch({ "https://feed.example/a.ics": FEED_TWO_EVENTS })
    );
    expect(summary.villaCount).toBe(1);
    expect(summary.created).toBe(2);
    expect(summary.errorCount).toBe(0);
  });

  it("한 빌라의 예외가 다른 빌라 동기화를 중단시키지 않는다 (실패 격리)", async () => {
    const { db } = makeFakeDb({
      villas: [
        { id: "v-broken", name: "B", status: VillaStatus.ACTIVE, icalImportUrls: ["https://feed.example/a.ics"] },
        { id: "v1", name: "A", status: VillaStatus.ACTIVE, icalImportUrls: ["https://feed.example/a.ics"] },
      ],
      failFindManyForVillaId: "v-broken",
    });
    const summary = await runIcalSync(
      db,
      makeFakeFetch({ "https://feed.example/a.ics": FEED_TWO_EVENTS })
    );
    expect(summary.villaCount).toBe(2);
    expect(summary.errorCount).toBe(1);
    expect(summary.created).toBe(2); // v1은 정상 수행
  });
});

describe("findUnresolvedIcalConflicts", () => {
  it("ICAL 블록 × 점유 예약 겹침을 빌라 이름과 함께 반환한다", async () => {
    const { db } = makeFakeDb({
      villas: [
        { id: "v1", name: "쏘나씨 V12", status: VillaStatus.ACTIVE, icalImportUrls: [] },
      ],
      blocks: [
        {
          id: "ib1",
          villaId: "v1",
          startDate: d("2026-07-05"),
          endDate: d("2026-07-08"),
          source: BlockSource.ICAL,
          icalUid: "u1",
        },
        {
          id: "mb1",
          villaId: "v1",
          startDate: d("2026-07-05"),
          endDate: d("2026-07-08"),
          source: BlockSource.MANUAL, // MANUAL은 충돌 경보 대상 아님
          icalUid: null,
        },
      ],
      bookings: [
        {
          id: "bk1",
          villaId: "v1",
          status: BookingStatus.HOLD,
          checkIn: d("2026-07-07"),
          checkOut: d("2026-07-10"),
        },
      ],
    });
    const conflicts = await findUnresolvedIcalConflicts(db, d("2026-07-01"));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      villaName: "쏘나씨 V12",
      blockId: "ib1",
      bookingId: "bk1",
    });
  });
});

// ===================== cron 라우트 인증 =====================

describe("GET /api/cron/ical-sync — 인증 게이트", () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("CRON_SECRET 미설정이면 500 (무인증 개방 금지)", async () => {
    delete process.env.CRON_SECRET;
    const res = await cronGet(new Request("http://local/api/cron/ical-sync"));
    expect(res.status).toBe(500);
  });

  it("Bearer 토큰 불일치면 401", async () => {
    process.env.CRON_SECRET = "topsecret";
    const res = await cronGet(
      new Request("http://local/api/cron/ical-sync", {
        headers: { authorization: "Bearer wrong" },
      })
    );
    expect(res.status).toBe(401);
  });
});
