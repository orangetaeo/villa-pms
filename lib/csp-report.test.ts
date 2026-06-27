import { describe, it, expect } from "vitest";
import { extractCspViolation } from "./csp-report";

describe("extractCspViolation (보안 P1-S5)", () => {
  it("포맷 A(csp-report)에서 디렉티브·호스트·경로 추출, 쿼리 제외", () => {
    const v = extractCspViolation({
      "csp-report": {
        "violated-directive": "script-src",
        "blocked-uri": "https://evil.example.com/x.js?token=SECRET",
        "document-uri": "https://app.test/p/abc?token=SECRET",
      },
    });
    expect(v).toEqual({ directive: "script-src", blockedHost: "evil.example.com", documentPath: "/p/[token]" });
    // 쿼리(토큰)·경로 토큰 미포함 확인
    expect(JSON.stringify(v)).not.toContain("SECRET");
    expect(JSON.stringify(v)).not.toContain("abc");
  });

  it("포맷 B(reports+json 배열)에서 추출", () => {
    const v = extractCspViolation([
      { type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "https://cdn.bad/x.png", documentURL: "https://app.test/g/tok" } },
    ]);
    expect(v).toEqual({ directive: "img-src", blockedHost: "cdn.bad", documentPath: "/g/[token]" });
  });

  it("/p·/g 토큰 세그먼트를 마스킹한다(베어러 토큰 미저장)", () => {
    const v1 = extractCspViolation({
      "csp-report": { "violated-directive": "img-src", "blocked-uri": "https://cdn.bad/x.png", "document-uri": "https://app.test/p/SECRET_TOKEN_abc123" },
    });
    expect(v1?.documentPath).toBe("/p/[token]");
    expect(JSON.stringify(v1)).not.toContain("SECRET_TOKEN");

    // 하위 경로는 보존
    const v2 = extractCspViolation({
      "csp-report": { "violated-directive": "script-src", "blocked-uri": "inline", "document-uri": "https://app.test/g/GUEST_TOK_xyz/orders" },
    });
    expect(v2?.documentPath).toBe("/g/[token]/orders");
    expect(JSON.stringify(v2)).not.toContain("GUEST_TOK");

    // 일반 경로는 무변경
    const v3 = extractCspViolation({
      "csp-report": { "violated-directive": "img-src", "blocked-uri": "https://x.y/z", "document-uri": "https://app.test/dashboard/stats" },
    });
    expect(v3?.documentPath).toBe("/dashboard/stats");
  });

  it("inline/eval 키워드 호스트는 그대로 보존", () => {
    const v = extractCspViolation({ "csp-report": { "violated-directive": "script-src", "blocked-uri": "inline" } });
    expect(v?.blockedHost).toBe("inline");
  });

  it("파싱 불가/빈 입력은 null", () => {
    expect(extractCspViolation(null)).toBeNull();
    expect(extractCspViolation("string")).toBeNull();
    expect(extractCspViolation({})).toBeNull();
  });
});
