import { describe, it, expect, vi } from "vitest";
import { isInternalIp, assertPublicUrl, safeFetch, SsrfBlockedError, type LookupAllFn } from "./ssrf-guard";

describe("isInternalIp — 내부 IP 대역 판정 (보안 P0-8)", () => {
  it("IPv4 사설·루프백·링크로컬(메타데이터)을 내부로 본다", () => {
    expect(isInternalIp("169.254.169.254")).toBe(true); // 클라우드 메타데이터
    expect(isInternalIp("127.0.0.1")).toBe(true);
    expect(isInternalIp("10.0.0.5")).toBe(true);
    expect(isInternalIp("172.16.3.4")).toBe(true);
    expect(isInternalIp("172.31.255.1")).toBe(true);
    expect(isInternalIp("192.168.1.1")).toBe(true);
    expect(isInternalIp("100.64.0.1")).toBe(true); // CGNAT
    expect(isInternalIp("0.0.0.0")).toBe(true);
  });

  it("공인 IPv4는 내부가 아니다", () => {
    expect(isInternalIp("8.8.8.8")).toBe(false);
    expect(isInternalIp("1.1.1.1")).toBe(false);
    expect(isInternalIp("172.32.0.1")).toBe(false); // 172.16/12 경계 밖
    expect(isInternalIp("11.0.0.1")).toBe(false);
  });

  it("IPv6 루프백·ULA·링크로컬·IPv4매핑 내부를 잡는다", () => {
    expect(isInternalIp("::1")).toBe(true);
    expect(isInternalIp("fc00::1")).toBe(true);
    expect(isInternalIp("fd12::1")).toBe(true);
    expect(isInternalIp("fe80::1")).toBe(true);
    expect(isInternalIp("::ffff:127.0.0.1")).toBe(true);
    // hex 표기 IPv4-매핑 — ::ffff:a9fe:a9fe = 169.254.169.254(메타데이터), ::ffff:0a00:0001 = 10.0.0.1
    expect(isInternalIp("::ffff:a9fe:a9fe")).toBe(true);
    expect(isInternalIp("::ffff:0a00:0001")).toBe(true);
    expect(isInternalIp("fec0::1")).toBe(true); // site-local(deprecated)
    expect(isInternalIp("::ffff:0808:0808")).toBe(false); // 8.8.8.8 공인 매핑
    expect(isInternalIp("2001:4860:4860::8888")).toBe(false); // 공인(구글 DNS)
  });
});

describe("assertPublicUrl", () => {
  const publicLookup: LookupAllFn = async () => [{ address: "93.184.216.34" }];
  const internalLookup: LookupAllFn = async () => [{ address: "10.1.2.3" }];

  it("http/https 외 스킴 거부", async () => {
    await expect(assertPublicUrl("file:///etc/passwd", publicLookup)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicUrl("gopher://x", publicLookup)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("내부 IP 직접 지정 거부 (DNS 불필요)", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/내부 IP/);
    await expect(assertPublicUrl("http://127.0.0.1:8080/")).rejects.toThrow(/내부 IP/);
  });

  it("도메인이 내부 IP로 resolve되면 거부 (DNS 리바인딩 차단)", async () => {
    await expect(assertPublicUrl("https://evil.example.com/cal.ics", internalLookup)).rejects.toThrow(/내부 IP로 resolve/);
  });

  it("공인 도메인은 통과", async () => {
    await expect(assertPublicUrl("https://calendar.example.com/x.ics", publicLookup)).resolves.toBeUndefined();
  });
});

describe("safeFetch — 리다이렉트 수동 추적 + 매 홉 재검증", () => {
  const publicLookup: LookupAllFn = async () => [{ address: "93.184.216.34" }];

  it("공인 URL 200은 그대로 반환", async () => {
    const fetchFn = vi.fn(async () => new Response("BEGIN:VCALENDAR", { status: 200 }));
    const res = await safeFetch("https://ok.example.com/x.ics", { fetchFn, lookupAll: publicLookup });
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("내부 IP로의 리다이렉트를 차단한다 (302 → 169.254.169.254)", async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      if (String(url).includes("start.example.com")) {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/meta" } });
      }
      return new Response("secret", { status: 200 });
    });
    await expect(
      safeFetch("https://start.example.com/x.ics", { fetchFn, lookupAll: publicLookup }),
    ).rejects.toThrow(/내부 IP 직접 지정/);
    // 첫 홉만 fetch, 메타데이터 fetch는 일어나지 않음
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("리다이렉트 한도 초과 시 차단", async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      const n = Number(u.searchParams.get("n") ?? "0");
      return new Response(null, { status: 302, headers: { location: `https://loop.example.com/x?n=${n + 1}` } });
    });
    await expect(
      safeFetch("https://loop.example.com/x?n=0", { fetchFn, lookupAll: publicLookup, maxRedirects: 3 }),
    ).rejects.toThrow(/리다이렉트 한도/);
  });
});
