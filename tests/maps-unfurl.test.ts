// 구글지도 링크 펼치기(unfurl) — og:image·장소명 추출, SSRF 가드(지도 링크만).
import { afterEach, describe, expect, it, vi } from "vitest";
import { unfurlMapsLink } from "@/lib/maps-unfurl";

const RESOLVED =
  "https://www.google.com/maps/place/JUSTSHOES/@10.1309511,103.9840908,18.38z/data=!4m6";
const OG_IMAGE =
  "https://maps.google.com/maps/api/staticmap?center=10.1309511%2C103.9840908&amp;zoom=18&amp;size=900x900";

function htmlWith(ogImage: string | null): string {
  return `<html><head>
    <meta property="og:title" content="Google Maps">
    ${ogImage ? `<meta property="og:image" content="${ogImage}">` : ""}
    <meta content="Find local businesses" property="og:description">
  </head></html>`;
}

function mockFetch(opts: { url: string; html: string; ok?: boolean }) {
  return vi.fn(async () => ({
    ok: opts.ok ?? true,
    url: opts.url,
    text: async () => opts.html,
  })) as unknown as typeof fetch;
}

afterEach(() => vi.restoreAllMocks());

describe("unfurlMapsLink", () => {
  it("지도 링크 → og:image(엔티티 디코드)·장소명 추출", async () => {
    vi.stubGlobal("fetch", mockFetch({ url: RESOLVED, html: htmlWith(OG_IMAGE) }));
    const r = await unfurlMapsLink("https://maps.app.goo.gl/BAgmL37AV9o3v32NA");
    expect(r?.title).toBe("JUSTSHOES");
    expect(r?.image).toBe(
      "https://maps.google.com/maps/api/staticmap?center=10.1309511%2C103.9840908&zoom=18&size=900x900"
    );
  });

  it("속성 순서 반대(content 먼저)인 og:image도 추출", async () => {
    const html = `<meta content="${OG_IMAGE}" property="og:image">`;
    vi.stubGlobal("fetch", mockFetch({ url: RESOLVED, html }));
    const r = await unfurlMapsLink("https://goo.gl/maps/x");
    expect(r?.image).toContain("staticmap");
  });

  it("og:image 없으면 image=null이지만 장소명은 추출", async () => {
    vi.stubGlobal("fetch", mockFetch({ url: RESOLVED, html: htmlWith(null) }));
    const r = await unfurlMapsLink("https://maps.app.goo.gl/x");
    expect(r?.image).toBeNull();
    expect(r?.title).toBe("JUSTSHOES");
  });

  it("지도 링크가 아니면 fetch 안 하고 null (SSRF 가드)", async () => {
    const f = mockFetch({ url: RESOLVED, html: htmlWith(OG_IMAGE) });
    vi.stubGlobal("fetch", f);
    const r = await unfurlMapsLink("https://evil.example.com/internal");
    expect(r).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("리다이렉트 최종 호스트가 구글이 아니면 파싱 안 함(image/title null)", async () => {
    vi.stubGlobal("fetch", mockFetch({ url: "https://evil.example.com/x", html: htmlWith(OG_IMAGE) }));
    const r = await unfurlMapsLink("https://maps.app.goo.gl/x");
    expect(r).toEqual({ image: null, title: null });
  });

  it("fetch 실패는 null(칩 폴백)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }) as unknown as typeof fetch
    );
    expect(await unfurlMapsLink("https://maps.app.goo.gl/x")).toBeNull();
  });
});
