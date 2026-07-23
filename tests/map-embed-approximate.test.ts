import { describe, expect, it } from "vitest";
import { toEmbedUrl } from "@/components/villa/map-embed-url";

// 제안 링크 지도 "대략 위치" 모드 — 건물 단위 핀 노출로 공급자 특정 → 우회예약을 막는다(원칙1).
describe("toEmbedUrl — approximate(대략 위치) 모드", () => {
  const precise = "https://www.google.com/maps/place/Villa/@10.226789,103.956123,15z";

  it("정밀 모드(기본)는 좌표를 그대로, z=15로 임베드한다", () => {
    const url = toEmbedUrl(precise);
    expect(url).toContain("z=15");
    expect(decodeURIComponent(url!)).toContain("10.226789,103.956123");
  });

  it("approximate=true면 좌표를 소수 2자리로 뭉개고 줌을 낮춘다", () => {
    const url = toEmbedUrl(precise, { approximate: true });
    expect(url).toContain("z=13");
    const decoded = decodeURIComponent(url!);
    expect(decoded).toContain("10.23,103.96"); // 반올림
    expect(decoded).not.toContain("10.226789"); // 원본 정밀 좌표는 사라진다
  });

  it("q= 좌표 링크도 approximate면 뭉갠다", () => {
    const url = toEmbedUrl("https://maps.google.com/maps?q=10.229999,103.951111", {
      approximate: true,
    });
    expect(decodeURIComponent(url!)).toContain("10.23,103.95");
    expect(url).toContain("z=13");
  });

  it("검색어(장소명) 링크는 좌표가 없어 텍스트는 그대로, 줌만 낮춘다", () => {
    const url = toEmbedUrl("https://www.google.com/maps?q=Long+Beach+Phu+Quoc", {
      approximate: true,
    });
    expect(decodeURIComponent(url!)).toContain("Long Beach Phu Quoc");
    expect(url).toContain("z=13");
  });

  it("비허용 호스트·short URL은 모드와 무관하게 null", () => {
    expect(toEmbedUrl("https://maps.app.goo.gl/abcd", { approximate: true })).toBeNull();
    expect(toEmbedUrl("https://evil.com/@10.2,103.9", { approximate: true })).toBeNull();
  });
});
