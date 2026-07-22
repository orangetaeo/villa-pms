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

  it("img-src에 지도 미리보기 호스트가 있다 (채팅 링크 unfurl의 og:image)", () => {
    // 실측 60건 전부 /messages. 빠지면 지도 링크 미리보기 이미지가 깨진다.
    expect(directive("img-src")).toContain("https://maps.google.com");
  });

  it("'unsafe-eval'을 넣지 않는다", () => {
    // eval 위반 628건은 고유 IP 2개·2026-07-21 이후 0건 = 브라우저 확장 노이즈였다.
    // 확장을 살리자고 'unsafe-eval'을 허용하면 CSP의 핵심 방어를 스스로 버리는 셈이다.
    expect(directive("script-src")).not.toContain("unsafe-eval");
  });

  it("차단 기조는 유지된다 — default-src·object-src", () => {
    expect(config).toContain(`"default-src 'self'"`);
    expect(config).toContain(`"object-src 'none'"`);
  });

  it("enforce로 전환돼 있다 (2026-07-23) — 위반이 실제로 차단된다", () => {
    // Report-Only로 되돌렸다면 이 단언이 깨진다. 되돌리는 건 장애 대응으로서 정당하지만,
    // **의도적 원복인지** 실수인지 구분되게 테스트도 함께 수정할 것.
    expect(config).toMatch(/key: "Content-Security-Policy"/);
    expect(config).not.toMatch(/key: "Content-Security-Policy-Report-Only"/);
  });

  it("enforce 상태에서도 report-uri를 유지한다 (차단 사실을 계속 수집)", () => {
    // enforce로 바꾸면서 report-uri를 빼면 이후 위반이 **조용히** 차단된다 — 관측 불가가 된다.
    expect(config).toContain("report-uri /api/csp-report");
  });
});
