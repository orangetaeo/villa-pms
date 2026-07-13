// 취소 티켓 다운로드 프록시 차단 (항목 7)
//   status=CANCELLED 주문의 티켓 다운로드는 404 — 이미 발급된 다운로드 URL 재사용까지 봉인.
//   비취소 주문은 정상 스트림(회귀 방지).
import { describe, it, expect, vi, beforeEach } from "vitest";

const tokenFindUnique = vi.fn();
const soFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: { findUnique: (...a: unknown[]) => tokenFindUnique(...a) },
    serviceOrder: { findFirst: (...a: unknown[]) => soFindFirst(...a) },
  },
}));
vi.mock("@/lib/guest-checkin", () => ({ guestTokenState: () => "OK" }));
vi.mock("@/lib/guest-rate-limit", () => ({ guestRateLimit: vi.fn(async () => null) }));

import { GET } from "@/app/api/g/[token]/service-orders/[id]/ticket-download/route";

const P = (token: string, id: string) => ({ params: Promise.resolve({ token, id }) });
const req = (u: string) => new Request(`http://local/api/g/tok/service-orders/o-1/ticket-download?u=${u}`);

beforeEach(() => {
  vi.clearAllMocks();
  tokenFindUnique.mockResolvedValue({ bookingId: "bk-1", expiresAt: new Date(Date.now() + 8.64e7), revokedAt: null });
});

describe("취소 주문 티켓 다운로드 차단 (항목 7)", () => {
  it("CANCELLED 주문 → 404 ORDER_NOT_FOUND · 업스트림 fetch 미호출", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    soFindFirst.mockResolvedValue({ status: "CANCELLED", ticketUrls: ["/u/a.jpg"] });
    const res = await GET(req("0"), P("tok", "o-1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "ORDER_NOT_FOUND" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("비취소(CONFIRMED) 주문 → 200 스트림(회귀 방지)", async () => {
    const body = new ReadableStream();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200, headers: { "content-type": "image/jpeg" } })
    );
    soFindFirst.mockResolvedValue({ status: "CONFIRMED", ticketUrls: ["/u/a.jpg"] });
    const res = await GET(req("0"), P("tok", "o-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });
});
