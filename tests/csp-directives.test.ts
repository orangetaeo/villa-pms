// CSP 디렉티브 회귀 방지 (T-sec-csp).
//
// enforce 전환 시 한 줄만 빠져도 기능이 통째로 죽는 항목들이 있다. 특히:
//   - media-src 누락 → default-src 'self' 폴백 → **영상이 전부 안 보인다**(빌라 클립·릴스·쇼츠)
//   - connect-src에 R2 누락 → presigned PUT 차단 → **영상 업로드 전멸**
// 실측(2026-07-23 프로덕션 report-only 수집)으로 확인한 출처를 여기에 못 박아,
// 나중에 CSP를 손볼 때 조용히 사라지지 않게 한다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const config = readFileSync(
  fileURLToPath(new URL("../next.config.ts", import.meta.url)),
  "utf8"
);

/** CSP 문자열 배열에서 해당 디렉티브 한 줄을 뽑는다. */
function directive(name: string): string {
  const m = config.match(new RegExp(`"${name} ([^"]+)"`));
  return m ? m[1] : "";
}

describe("CSP 디렉티브 — enforce 전환 시 필수 출처", () => {
  it("media-src가 존재한다 (없으면 default-src 폴백으로 영상 전멸)", () => {
    const v = directive("media-src");
    expect(v).not.toBe("");
    expect(v).toContain("'self'");
  });

  it("media-src에 R2 공개 도메인과 blob:이 있다", () => {
    const v = directive("media-src");
    // 재생원: pub-*.r2.dev/villa-clips|youtube-renders|instagram-videos/*.mp4
    expect(v).toContain("https://*.r2.dev");
    // 업로드 전 로컬 미리보기(objectURL을 <video>에 물린다)
    expect(v).toContain("blob:");
  });

  it("connect-src에 R2 S3 엔드포인트가 있다 (presigned PUT 직업로드)", () => {
    expect(directive("connect-src")).toContain("https://*.r2.cloudflarestorage.com");
  });

  it("script-src에 Cloudflare 비콘이 있다 (프록시가 전 페이지에 주입)", () => {
    expect(directive("script-src")).toContain("https://static.cloudflareinsights.com");
  });

  it("img-src에 blob:과 Zalo 사진 CDN 2종이 있다", () => {
    const v = directive("img-src");
    expect(v).toContain("blob:");
    expect(v).toContain("https://*.zadn.vn"); // 아바타
    expect(v).toContain("https://*.zdn.vn"); // 그룹 사진(photo-stal-*)
  });

  it("차단 기조는 유지된다 — default-src·object-src", () => {
    expect(config).toContain(`"default-src 'self'"`);
    expect(config).toContain(`"object-src 'none'"`);
  });

  it("아직 Report-Only다 (enforce 전환은 별도 결정)", () => {
    // 이 단언이 깨졌다면 enforce로 플립한 것이다 —
    // 위 출처들이 실제로 다 반영됐는지 확인한 뒤에만 통과시켜야 한다.
    expect(config).toContain("Content-Security-Policy-Report-Only");
  });
});
