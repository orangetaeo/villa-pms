import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// 보안 P1-S8 — 인증 누락 정적 검사(CI 게이트).
//
// 배경: 인증·인가가 라우트마다 수작업(`auth()`+401+capability)이라, 신규 mutation 라우트에서
// 빠뜨리면 무인증/무권한 노출. P1-S8에서 전 mutation 라우트를 lib/api-guard.ts의
// requireAuth/requireCapability로 일원화했다. 이 테스트가 그 불변식을 영구 강제한다:
//   "app/api/**/route.ts의 모든 mutation 핸들러(POST/PUT/PATCH/DELETE)는
//    중앙 가드(requireAuth/requireCapability)를 거치거나, 공개 화이트리스트에 명시돼야 한다."
// 새 무가드 mutation 라우트가 추가되면 이 테스트가 실패한다(공허통과 방지 — 아래 자가검증 참조).

const API_DIR = "app/api";

// 공개·비유저세션 게이트 라우트(가드 헬퍼 대상 아님). 디렉터리 프리픽스로 매칭(POSIX 슬래시).
// - cron: CRON_SECRET 헤더 게이트 / g·p: 게스트·제안 토큰 / auth: 비로그인 비번 재설정
// - *-signup: 공개 등록(IP rate-limit) / csp-report: 위반 리포트 / zalo/ext: webhook HMAC
// - locale: 선택적 auth(쿠키는 항상, DB는 로그인 시만)
const PUBLIC_WHITELIST = [
  "app/api/cron/",
  "app/api/g/",
  "app/api/p/",
  "app/api/auth/",
  "app/api/vendor-signup/",
  "app/api/partner-signup/",
  "app/api/csp-report/",
  "app/api/zalo/ext/",
  "app/api/locale/",
];

/** route.ts 재귀 수집(소스 트리만). 경로는 POSIX 슬래시로 정규화. */
function collectRoutes(dir: string, acc: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name).split("\\").join("/");
    if (ent.isDirectory()) collectRoutes(p, acc);
    else if (ent.isFile() && ent.name === "route.ts") acc.push(p);
  }
  return acc;
}

const MUTATION_EXPORT = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/;
const GUARD_CALL = /\brequire(Auth|Capability)\s*\(/;

function isWhitelisted(file: string): boolean {
  return PUBLIC_WHITELIST.some((prefix) => file.startsWith(prefix));
}

describe("mutation 라우트 인증 누락 정적 검사 (보안 P1-S8)", () => {
  const routes = collectRoutes(API_DIR);

  it("app/api 라우트 파일을 수집한다(스캔 정상 동작 확인)", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("모든 인증 mutation 라우트는 중앙 가드(requireAuth/requireCapability)를 거친다", () => {
    const violations: string[] = [];
    for (const file of routes) {
      const src = readFileSync(file, "utf8");
      if (!MUTATION_EXPORT.test(src)) continue; // mutation 핸들러 없음
      if (isWhitelisted(file)) continue; // 공개 라우트 — 가드 대상 아님
      if (!GUARD_CALL.test(src)) violations.push(file);
    }
    expect(
      violations,
      `다음 mutation 라우트가 중앙 가드(requireAuth/requireCapability)를 안 거친다.\n` +
        `의도된 공개 라우트면 tests/mutation-route-guard.test.ts의 PUBLIC_WHITELIST에 추가하라:\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    ).toEqual([]);
  });

  it("PUBLIC_WHITELIST 항목은 모두 실제 존재한다(stale 화이트리스트 방지)", () => {
    const stale = PUBLIC_WHITELIST.filter(
      (prefix) => !routes.some((r) => r.startsWith(prefix)),
    );
    expect(stale, `존재하지 않는 화이트리스트 프리픽스: ${stale.join(", ")}`).toEqual([]);
  });

  it("[자가검증] 가드 없는 가짜 mutation 라우트 소스는 위반으로 탐지된다(공허통과 방지)", () => {
    const fakeUnguarded = `export async function POST(req: Request) { return Response.json({}); }`;
    const fakeGuarded = `import { requireAuth } from "@/lib/api-guard";\nexport async function POST(req: Request) { const g = await requireAuth(req); if(!g.ok) return g.response; return Response.json({}); }`;
    // 위반 조건 = mutation 핸들러 있음 AND 가드 호출 없음
    expect(MUTATION_EXPORT.test(fakeUnguarded) && !GUARD_CALL.test(fakeUnguarded)).toBe(true);
    expect(MUTATION_EXPORT.test(fakeGuarded) && !GUARD_CALL.test(fakeGuarded)).toBe(false);
  });
});
