import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 버그 클래스 영구 차단:
 *   admin 클라이언트 컴포넌트가 useTranslations("NS")를 쓰는데
 *   app/(admin)/layout.tsx의 ADMIN_CLIENT_NAMESPACES에 NS가 없으면
 *   NextIntlClientProvider에 메시지가 안 실려 화면이 raw 키("revenue.title")로 깨진다.
 *   (실제 사고: /revenue·/settings/vendors 2건 — admin-client-namespace-whitelist)
 *
 * 이 테스트는 (admin) 트리의 모든 useTranslations 최상위 네임스페이스를 수집해
 * 화이트리스트에 전부 포함되는지 검증한다. 새 admin 클라 컴포넌트가
 * 네임스페이스를 추가하고 layout.tsx에 등록을 빠뜨리면 빌드 전 여기서 잡힌다.
 */

const ROOT = join(__dirname, "..");
const ADMIN_DIR = join(ROOT, "app", "(admin)");
const LAYOUT = join(ADMIN_DIR, "layout.tsx");

// 서버 컴포넌트(getTranslations)는 layout 화이트리스트와 무관 → 클라 훅만 본다.
const NS_RE = /useTranslations\(\s*["'`]([a-zA-Z][a-zA-Z0-9]*)/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function loadWhitelist(): Set<string> {
  const src = readFileSync(LAYOUT, "utf8");
  const start = src.indexOf("ADMIN_CLIENT_NAMESPACES");
  const arrStart = src.indexOf("[", start);
  const arrEnd = src.indexOf("]", arrStart);
  const body = src.slice(arrStart + 1, arrEnd);
  const set = new Set<string>();
  for (const m of body.matchAll(/["'`]([a-zA-Z][a-zA-Z0-9]*)["'`]/g)) set.add(m[1]);
  return set;
}

describe("admin 클라이언트 i18n 네임스페이스 화이트리스트", () => {
  const whitelist = loadWhitelist();

  it("화이트리스트를 정상적으로 파싱한다", () => {
    expect(whitelist.size).toBeGreaterThan(10);
    expect(whitelist.has("revenue")).toBe(true);
    expect(whitelist.has("adminVendors")).toBe(true);
  });

  it("모든 admin 클라 컴포넌트의 useTranslations 네임스페이스가 화이트리스트에 있다", () => {
    const used = new Map<string, string>(); // ns -> 첫 발견 파일
    for (const file of walk(ADMIN_DIR)) {
      if (file === LAYOUT) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(NS_RE)) {
        if (!used.has(m[1])) used.set(m[1], file.slice(ROOT.length + 1));
      }
    }
    const missing = [...used.entries()]
      .filter(([ns]) => !whitelist.has(ns))
      .map(([ns, file]) => `${ns}  (${file})`);
    expect(missing, `화이트리스트 누락 네임스페이스:\n${missing.join("\n")}`).toEqual([]);
  });
});
