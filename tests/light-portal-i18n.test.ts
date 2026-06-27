import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// 라이트 포털(공급자·파트너·벤더) i18n 화이트리스트 완성도 — (admin)/layout.tsx admin-i18n-whitelist.test.ts의 라이트 포털판.
//
// 배경: 각 포털 레이아웃은 누수 차단을 위해 "필요한 네임스페이스만" 클라이언트로 직렬화한다.
// 클라("use client") 컴포넌트가 useTranslations("X")를 쓰는데 X가 화이트리스트에 없으면 라벨이
// raw 키("X.key")로 깨진다(메시지엔 존재해도). 이 클래스가 반복 새어나갔다:
//   - partner·vendor: pagination 누락(2026-06-27 역할 워크스루, H1)
//   - supplier: photoManage·photoLightbox 누락(2026-06-27 추가 발굴)
// 이 테스트가 같은 클래스의 재발을 영구 차단한다. [[admin-client-namespace-whitelist]]

/** .tsx 재귀 수집 (소스 트리만). */
function collectTsx(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) collectTsx(p, acc);
    else if (ent.isFile() && ent.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

/** "use client" 컴포넌트가 쓰는 useTranslations("X")의 최상위 네임스페이스 → 첫 사용 파일. */
function usedClientNamespaces(dirs: string[]): Map<string, string> {
  const used = new Map<string, string>();
  for (const dir of dirs) {
    for (const file of collectTsx(dir)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes('"use client"')) continue;
      for (const m of src.matchAll(/useTranslations\(\s*"([^"]+)"\s*\)/g)) {
        const top = m[1].split(".")[0];
        if (!used.has(top)) used.set(top, file);
      }
    }
  }
  return used;
}

/** 레이아웃이 클라이언트로 직렬화하는 네임스페이스 집합. 배열 화이트리스트 또는 clientMessages 객체 키. */
function serializedNamespaces(layout: string, arrayName: string | null): Set<string> {
  const src = readFileSync(layout, "utf8");
  if (arrayName) {
    const block = src.match(new RegExp(`${arrayName} = \\[([\\s\\S]*?)\\] as const`));
    if (!block) throw new Error(`${arrayName} 배열을 ${layout}에서 찾지 못함`);
    return new Set((block[1].match(/"([^"]+)"/g) ?? []).map((s) => s.replace(/"/g, "")));
  }
  // partner: clientMessages 객체 리터럴의 키
  const block = src.match(/clientMessages[^=]*=\s*\{([\s\S]*?)\};/);
  if (!block) throw new Error(`clientMessages 객체를 ${layout}에서 찾지 못함`);
  return new Set((block[1].match(/(\w+)\s*:/g) ?? []).map((s) => s.replace(/\s*:/, "")));
}

const PORTALS = [
  {
    name: "supplier",
    dirs: ["app/(supplier)", "components/supplier"],
    layout: "app/(supplier)/layout.tsx",
    arrayName: "SUPPLIER_CLIENT_NAMESPACES",
  },
  {
    name: "vendor",
    dirs: ["app/vendor", "components/vendor"],
    layout: "app/vendor/layout.tsx",
    arrayName: "VENDOR_CLIENT_NAMESPACES",
  },
  {
    name: "partner",
    dirs: ["app/partner", "components/partner"],
    layout: "app/partner/layout.tsx",
    arrayName: null, // clientMessages 객체 리터럴
  },
] as const;

describe("라이트 포털 i18n 화이트리스트 완성도", () => {
  it.each(PORTALS)(
    "[$name] 클라 컴포넌트가 쓰는 모든 네임스페이스가 레이아웃에 직렬화돼 있다",
    (portal) => {
      const used = usedClientNamespaces([...portal.dirs]);
      const serialized = serializedNamespaces(portal.layout, portal.arrayName);
      const missing = [...used.entries()].filter(([ns]) => !serialized.has(ns));
      expect(
        missing,
        `[${portal.name}] 화이트리스트 누락(라벨 깨짐): ${missing
          .map(([ns, f]) => `${ns} ← ${f}`)
          .join(", ")}`
      ).toEqual([]);
    }
  );

  it.each(PORTALS)(
    "[$name] 공용 PaginationBar용 pagination 네임스페이스가 직렬화돼 있다",
    (portal) => {
      // PaginationBar(공유 컴포넌트)는 모든 포털 목록에서 useTranslations("pagination")을 쓴다.
      const serialized = serializedNamespaces(portal.layout, portal.arrayName);
      expect(serialized.has("pagination"), `[${portal.name}] pagination 누락`).toBe(true);
    }
  );

  it("스캔이 실제로 동작한다(공급자 네임스페이스 다수 발견)", () => {
    expect(usedClientNamespaces(["app/(supplier)", "components/supplier"]).size).toBeGreaterThan(6);
  });
});
