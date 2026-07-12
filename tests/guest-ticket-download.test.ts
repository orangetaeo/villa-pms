// tests/guest-ticket-download.test.ts — 게스트 QR 티켓 다운로드 프록시 (오프라인 대비)
//   GET /api/g/[token]/service-orders/[id]/ticket-download?u=<idx>
//   ★보안: 토큰 무효 410 / 타 booking 주문 404 / u 범위밖·비정수 400 / 정상 200 + attachment 헤더.
//   u는 ticketUrls 인덱스만(임의 URL 미수용 — SSRF 차단).
import { describe, it, expect, vi, beforeEach } from "vitest";

const tokenFindUnique = vi.fn();
const soFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guestCheckinToken: { findUnique: (...a: unknown[]) => tokenFindUnique(...a) },
    serviceOrder: { findFirst: (...a: unknown[]) => soFindFirst(...a) },
  },
}));

// 토큰 상태는 순수 함수 — 실제 로직 사용(만료 판정 테스트 위해 expiresAt/revokedAt로 제어).
vi.mock("@/lib/guest-checkin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/guest-checkin")>("@/lib/guest-checkin");
  return actual;
});
const guestRateLimit = vi.fn(async (..._a: unknown[]): Promise<Response | null> => null);
vi.mock("@/lib/guest-rate-limit", () => ({ guestRateLimit: (...a: unknown[]) => guestRateLimit(...a) }));

import { GET } from "@/app/api/g/[token]/service-orders/[id]/ticket-download/route";

const params = (token = "tok", id = "so-1") => ({ params: Promise.resolve({ token, id }) });
const reqFor = (u: string | null) =>
  new Request(`http://local/api/g/tok/service-orders/so-1/ticket-download${u == null ? "" : `?u=${u}`}`);

const validToken = {
  bookingId: "bk-1",
  expiresAt: new Date(Date.now() + 86_400_000),
  revokedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  guestRateLimit.mockResolvedValue(null);
});

describe("게스트 티켓 다운로드 프록시 — 가드", () => {
  it("토큰 없음 → 404", async () => {
    tokenFindUnique.mockResolvedValue(null);
    const res = await GET(reqFor("0"), params());
    expect(res.status).toBe(404);
    expect(soFindFirst).not.toHaveBeenCalled();
  });

  it("만료·회수 토큰 → 410", async () => {
    tokenFindUnique.mockResolvedValue({ ...validToken, expiresAt: new Date(Date.now() - 1000) });
    const res = await GET(reqFor("0"), params());
    expect(res.status).toBe(410);
    expect(soFindFirst).not.toHaveBeenCalled();
  });

  it("u 없음 → 400", async () => {
    tokenFindUnique.mockResolvedValue({ ...validToken });
    const res = await GET(reqFor(null), params());
    expect(res.status).toBe(400);
  });

  it("u 비정수 → 400 (임의 URL·문자열 미수용)", async () => {
    tokenFindUnique.mockResolvedValue({ ...validToken });
    const res = await GET(reqFor("abc"), params());
    expect(res.status).toBe(400);
    const res2 = await GET(reqFor("1.5"), params());
    expect(res2.status).toBe(400);
    const res3 = await GET(reqFor("-1"), params());
    expect(res3.status).toBe(400);
    expect(soFindFirst).not.toHaveBeenCalled();
  });

  it("타 booking·존재하지 않는 주문(findFirst null) → 404", async () => {
    tokenFindUnique.mockResolvedValue({ ...validToken });
    soFindFirst.mockResolvedValue(null);
    const res = await GET(reqFor("0"), params());
    expect(res.status).toBe(404);
    // where에 bookingId·requestedVia GUEST 스코프 강제
    const where = (soFindFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ id: "so-1", bookingId: "bk-1", requestedVia: "GUEST" });
  });

  it("u 범위 밖 → 400", async () => {
    tokenFindUnique.mockResolvedValue({ ...validToken });
    soFindFirst.mockResolvedValue({ ticketUrls: ["https://cdn.example/a.png"] });
    const res = await GET(reqFor("5"), params());
    expect(res.status).toBe(400);
  });
});

describe("게스트 티켓 다운로드 프록시 — 정상", () => {
  it("정상 → 200 + Content-Disposition attachment + 확장자 파일명", async () => {
    tokenFindUnique.mockResolvedValue({ ...validToken });
    soFindFirst.mockResolvedValue({
      ticketUrls: ["https://cdn.example/first.png", "https://cdn.example/second.jpg"],
    });
    const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(async () =>
      new Response(body, { status: 200, headers: { "content-type": "image/jpeg", "content-length": "4" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(reqFor("1"), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ticket-2.jpg"');
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("private");
    // ★인덱스가 가리킨 신뢰된 URL만 fetch(임의 URL 아님)
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/second.jpg");

    vi.unstubAllGlobals();
  });

  it("원격 fetch 실패 → 502", async () => {
    tokenFindUnique.mockResolvedValue({ ...validToken });
    soFindFirst.mockResolvedValue({ ticketUrls: ["https://cdn.example/a.png"] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    const res = await GET(reqFor("0"), params());
    expect(res.status).toBe(502);

    vi.unstubAllGlobals();
  });

  it("디스크 모드 상대 URL(/uploads/…)은 요청 출처로 절대화해 fetch", async () => {
    tokenFindUnique.mockResolvedValue({ ...validToken });
    soFindFirst.mockResolvedValue({ ticketUrls: ["/uploads/t.png"] });
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([0x89, 0x50]), { status: 200, headers: { "content-type": "image/png" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(reqFor("0"), params());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("http://local/uploads/t.png");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ticket-1.png"');

    vi.unstubAllGlobals();
  });
});
