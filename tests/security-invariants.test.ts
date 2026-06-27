// 보안 회귀 테스트 스위트 (보안 P1-S7) — 정적 분석으로 핵심 불변식을 CI에서 고정한다.
// 신규 코드가 보안 속성을 깨면 여기서 실패한다. (leak-checklist 교훈의 코드화)
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function walk(dir: string, filter: (f: string) => boolean): string[] {
  let out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out = out.concat(walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

/** 경로를 / 구분으로 정규화. */
const norm = (p: string) => p.replace(/\\/g, "/");

describe("불변식 1: 미게이트 mutation 라우트 없음 (보안 P0-6/P1-S9)", () => {
  // 의도적으로 공개(비인증)인 mutation 라우트 — rate-limit·코드/HMAC 등 자체 방어가 있다.
  // 신규 mutation 라우트는 인증·토큰·cron·ext-secret 게이트를 갖거나, 명시적으로 여기에 추가해야 한다.
  const PUBLIC_ALLOWLIST = new Set([
    "app/api/auth/forgot-password/route.ts",
    "app/api/auth/reset-password/route.ts",
    "app/api/csp-report/route.ts",
    "app/api/partner-signup/route.ts",
    "app/api/vendor-signup/route.ts",
  ]);

  const MUTATION =
    /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)|export\s+const\s+(POST|PUT|PATCH|DELETE)\s*=/;
  // P1-S8: 중앙 가드 헬퍼(requireAuth/requireCapability)도 게이트로 인정(전면 치환으로 raw auth() 제거됨).
  const GATE = /auth\(\)|requireAuth\(|requireCapability\(|getServerSession|CRON_SECRET|isExtSecretValid|x-zalo-ext-secret|verifyZaloWebhook|HMAC/i;

  it("모든 mutation 라우트는 게이트되거나 공개 허용목록에 있다", () => {
    const files = walk(join(ROOT, "app", "api"), (f) => f.endsWith("route.ts"));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!MUTATION.test(src)) continue;
      const rel = norm(f).slice(norm(ROOT).length + 1);
      const tokenRoute = rel.includes("[token]"); // /p·/g 공개 토큰 라우트(토큰이 게이트)
      if (GATE.test(src) || tokenRoute || PUBLIC_ALLOWLIST.has(rel)) continue;
      offenders.push(rel);
    }
    expect(offenders, `미게이트 mutation 라우트 발견 — 게이트 추가 또는 허용목록 등재 필요:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("토큰 공개 라우트(/p·/g)는 CSRF(assertSameOrigin) 또는 rate-limit 방어가 있다", () => {
    const files = walk(join(ROOT, "app", "api"), (f) => f.endsWith("route.ts") && norm(f).includes("[token]"));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!MUTATION.test(src)) continue;
      if (/assertSameOrigin|guestRateLimit|checkRateLimit/.test(src)) continue;
      offenders.push(norm(f).slice(norm(ROOT).length + 1));
    }
    expect(offenders, `토큰 mutation 라우트에 CSRF/rate-limit 방어 누락:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("불변식 2: 권한상승 차단 — 부여 가능 역할에 OWNER/ADMIN 없음 (보안 P1-S1)", () => {
  for (const rel of ["app/api/users/route.ts", "app/api/users/[id]/route.ts"]) {
    it(`${rel}의 ASSIGNABLE_ROLES는 OWNER·ADMIN을 제외한다`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      const m = src.match(/ASSIGNABLE_ROLES\s*=\s*\[([^\]]*)\]/);
      expect(m, "ASSIGNABLE_ROLES 정의를 찾지 못함").toBeTruthy();
      const body = m![1];
      expect(body).not.toMatch(/"OWNER"|'OWNER'/);
      expect(body).not.toMatch(/"ADMIN"|'ADMIN'/);
    });
  }
});

describe("불변식 3: 오픈 리다이렉트 없음 — 리다이렉트 목적지에 사용자 입력 미사용 (보안 §2-11)", () => {
  it("redirect 목적지를 searchParams/callbackUrl로 구성하지 않는다", () => {
    const files = walk(join(ROOT, "app"), (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"));
    const offenders: string[] = [];
    // redirect(...) 또는 redirectTo: 가 searchParams/callbackUrl을 직접 참조하는 패턴
    const BAD = /(redirect\s*\(|redirectTo\s*:)[^;\n]*(searchParams|callbackUrl)/;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (BAD.test(src)) offenders.push(norm(f).slice(norm(ROOT).length + 1));
    }
    expect(offenders, `오픈 리다이렉트 가능 패턴 발견:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("불변식 4: 시크릿·해시·비번을 console에 로깅하지 않음 (보안 P1-S6)", () => {
  it("console.* 인자에 시크릿/해시/평문비번 변수가 없다", () => {
    const files = walk(join(ROOT, "lib"), (f) => /\.ts$/.test(f) && !f.endsWith(".test.ts")).concat(
      walk(join(ROOT, "app"), (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts") && !f.endsWith(".test.ts")),
    );
    // console.* 호출 인자에 시크릿/해시/평문비번이 직접 들어가는 패턴(라인 주석 제거 후 검사)
    const BAD =
      /console\.\w+\([^;]*(process\.env\.(ZALO_CREDS_KEY|NEXTAUTH_SECRET|CRON_SECRET|GEMINI_API_KEY|DATABASE_URL)|passwordHash|\.credentials\b|tempPassword|newPassword|credsString)/;
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8")
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, "")) // 라인 주석 제거(오탐 방지)
        .join("\n");
      if (BAD.test(src)) offenders.push(norm(f).slice(norm(ROOT).length + 1));
    }
    expect(offenders, `시크릿/해시/비번 console 로깅 발견:\n${offenders.join("\n")}`).toEqual([]);
  });
});
