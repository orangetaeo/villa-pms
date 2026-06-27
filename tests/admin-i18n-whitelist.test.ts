import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// (admin) 클라이언트 컴포넌트가 useTranslations("X")로 쓰는 최상위 네임스페이스가
// 모두 (admin)/layout.tsx ADMIN_CLIENT_NAMESPACES에 화이트리스트돼 있는지 검증.
//
// 배경: pickMessages는 화이트리스트한 네임스페이스만 클라이언트로 직렬화한다(누수 차단).
// 새 admin 클라 컴포넌트가 네임스페이스를 추가하고 화이트리스트를 빠뜨리면 라벨이 raw 키로
// 깨지는데(메시지엔 존재해도), 이를 자동으로 잡는 완성도 테스트가 그간 없어 두 번 새어나갔다:
//   - PR #74: /revenue(revenue NS) 누락 → 머지 후 줄곧 깨짐(PR #79 수정)
//   - /settings/vendors(adminVendors NS) 누락 → 깨짐(이 PR 수정)
// 이 테스트가 같은 클래스의 재발을 영구 차단한다. [[admin-client-namespace-whitelist]]

const ADMIN_DIR = "app/(admin)";
const LAYOUT = "app/(admin)/layout.tsx";

/** .tsx 파일 재귀 수집(node_modules·.next 무관 — 소스 트리만). */
function collectTsx(dir: string, acc: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) collectTsx(p, acc);
    else if (ent.isFile() && ent.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

/** 화이트리스트 배열에서 네임스페이스 문자열 집합 추출. */
function whitelistedNamespaces(): Set<string> {
  const src = readFileSync(LAYOUT, "utf8");
  const block = src.match(/ADMIN_CLIENT_NAMESPACES = \[([\s\S]*?)\] as const/);
  if (!block) throw new Error("ADMIN_CLIENT_NAMESPACES 배열을 찾지 못함");
  const names = block[1].match(/"([^"]+)"/g) ?? [];
  return new Set(names.map((s) => s.replace(/"/g, "")));
}

/** "use client" 컴포넌트가 쓰는 useTranslations("X")의 최상위 네임스페이스(X.split(".")[0]) 수집. */
function usedClientNamespaces(): Map<string, string> {
  const used = new Map<string, string>(); // ns -> 첫 사용 파일(에러 메시지용)
  for (const file of collectTsx(ADMIN_DIR)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes('"use client"')) continue;
    for (const m of src.matchAll(/useTranslations\(\s*"([^"]+)"\s*\)/g)) {
      const top = m[1].split(".")[0];
      if (!used.has(top)) used.set(top, file);
    }
  }
  return used;
}

describe("(admin) i18n 화이트리스트 완성도", () => {
  it("admin 클라 컴포넌트가 쓰는 모든 네임스페이스가 ADMIN_CLIENT_NAMESPACES에 있다", () => {
    const whitelist = whitelistedNamespaces();
    const used = usedClientNamespaces();

    const missing = [...used.entries()].filter(([ns]) => !whitelist.has(ns));
    // 누락 시 그 화면 라벨이 raw 키로 깨짐 — 어떤 NS를 어느 파일이 쓰는지 함께 출력.
    expect(
      missing,
      `화이트리스트 누락(라벨 깨짐): ${missing.map(([ns, f]) => `${ns} ← ${f}`).join(", ")}`
    ).toEqual([]);
  });

  it("스캔이 실제로 동작한다(최소 다수 네임스페이스 발견)", () => {
    // 회귀 안전장치: 스캔이 0건이면(경로/패턴 깨짐) 위 테스트가 거짓 통과하므로 가드.
    expect(usedClientNamespaces().size).toBeGreaterThan(10);
  });
});
