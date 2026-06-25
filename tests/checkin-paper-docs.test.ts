import { beforeEach, describe, expect, it, vi } from "vitest";

// #1 체크인 종이서류 — 검증 함수 + PATCH /api/bookings/[id]/checkin/paper-docs 가드.
import { assertPaperDocUrls, PAPER_DOC_PATH } from "@/lib/checkin";

describe("assertPaperDocUrls — doc- 화이트리스트 (QA 가드레일 a)", () => {
  it("doc- 비공개 경로 통과 + 빈 배열 허용(전체 삭제)", () => {
    expect(() => assertPaperDocUrls([])).not.toThrow();
    expect(() => assertPaperDocUrls(["/api/passports/doc-abc.jpg", "/api/passports/doc-x_y-1.png"])).not.toThrow();
  });
  it("여권(무접두)·서명(sig-)·공개 URL 거부", () => {
    expect(() => assertPaperDocUrls(["/api/passports/abc.jpg"])).toThrow(RangeError); // 여권
    expect(() => assertPaperDocUrls(["/api/passports/sig-abc.jpg"])).toThrow(RangeError); // 서명
    expect(() => assertPaperDocUrls(["/uploads/x.jpg"])).toThrow(RangeError); // 공개
    expect(() => assertPaperDocUrls(["https://evil.com/doc-x.jpg"])).toThrow(RangeError); // 외부
    expect(() => assertPaperDocUrls(["/api/passports/doc-../secret"])).toThrow(RangeError); // 경로탈출 문자
  });
  it("비배열·비문자열·30장 초과 거부", () => {
    expect(() => assertPaperDocUrls("nope")).toThrow(RangeError);
    expect(() => assertPaperDocUrls([123])).toThrow(RangeError);
    expect(() => assertPaperDocUrls(Array(31).fill("/api/passports/doc-a.jpg"))).toThrow(RangeError);
    expect(() => assertPaperDocUrls(Array(30).fill("/api/passports/doc-a.jpg"))).not.toThrow();
  });
  it("PAPER_DOC_PATH는 doc- 접두만 매칭", () => {
    expect(PAPER_DOC_PATH.test("/api/passports/doc-a.jpg")).toBe(true);
    expect(PAPER_DOC_PATH.test("/api/passports/a.jpg")).toBe(false);
  });
});

// ── PATCH 라우트 가드 ──
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const tx = {
  checkInRecord: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
};
const transactionSpy = vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (fn: (t: unknown) => Promise<unknown>) => transactionSpy(fn) },
}));

import { PATCH } from "@/app/api/bookings/[id]/checkin/paper-docs/route";
import { writeAuditLog } from "@/lib/audit-log";

const req = (body: unknown) =>
  PATCH(
    new Request("http://local/api/bookings/b1/checkin/paper-docs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "b1" }) }
  );

const DOCS = { paperDocUrls: ["/api/passports/doc-a.jpg"] };

beforeEach(() => {
  vi.clearAllMocks();
  tx.checkInRecord.findUnique.mockResolvedValue({ id: "rec1", paperDocUrls: [] });
});

describe("PATCH paper-docs — 가드", () => {
  it("비로그인 401 (tx 미진입)", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await req(DOCS)).status).toBe(401);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("SUPPLIER 403 (운영자 전용)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "s1", role: "SUPPLIER" } });
    expect((await req(DOCS)).status).toBe(403);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("CLEANER 403", async () => {
    mockAuth.mockResolvedValue({ user: { id: "c1", role: "CLEANER" } });
    expect((await req(DOCS)).status).toBe(403);
  });

  it("잘못된 URL(여권/공개) 400 (저장 안 됨)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await req({ paperDocUrls: ["/api/passports/abc.jpg"] });
    expect(res.status).toBe(400);
    expect(tx.checkInRecord.update).not.toHaveBeenCalled();
  });

  it("체크인 기록 없음 409 (미체크인)", async () => {
    tx.checkInRecord.findUnique.mockResolvedValue(null);
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await req(DOCS);
    expect(res.status).toBe(409);
    expect(tx.checkInRecord.update).not.toHaveBeenCalled();
  });

  it("성공: 운영자 + 기록 존재 → 저장 + AuditLog", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "STAFF" } });
    const res = await req(DOCS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bookingId: "b1", paperDocCount: 1 });
    expect(tx.checkInRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "b1" },
        data: { paperDocUrls: ["/api/passports/doc-a.jpg"] },
      })
    );
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "CheckInRecord", entityId: "rec1", action: "UPDATE" })
    );
  });

  it("빈 배열로 전체 삭제 허용 (200)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", role: "OWNER" } });
    const res = await req({ paperDocUrls: [] });
    expect(res.status).toBe(200);
    expect(tx.checkInRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paperDocUrls: [] } })
    );
  });
});
