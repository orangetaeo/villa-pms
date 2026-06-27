import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// 라이트 포털(공급자·파트너·벤더)은 목록 화면에서 공용 PaginationBar(useTranslations("pagination"))를 쓴다.
// 각 포털 레이아웃은 누수 차단을 위해 "필요한 네임스페이스만" 클라이언트로 직렬화하는데(화이트리스트/객체),
// 여기에 pagination이 빠지면 페이지네이션 라벨이 raw 키("pagination.summary"·"pagination.perPage")로 깨진다.
//   - 실제 사고(H1, 2026-06-27 역할 워크스루): partner·vendor 레이아웃에 pagination 누락 → ko+vi 모두 깨짐.
// (admin)/layout.tsx의 admin-i18n-whitelist.test.ts와 같은 클래스의 라이트 포털판 — 재발 영구 차단.
// [[admin-client-namespace-whitelist]]

const LIGHT_PORTAL_LAYOUTS = [
  "app/(supplier)/layout.tsx",
  "app/partner/layout.tsx",
  "app/vendor/layout.tsx",
];

describe("라이트 포털 i18n — pagination 네임스페이스 직렬화", () => {
  it.each(LIGHT_PORTAL_LAYOUTS)(
    "%s 레이아웃이 pagination 네임스페이스를 클라이언트로 직렬화한다",
    (layout) => {
      const src = readFileSync(layout, "utf8");
      // 배열 화이트리스트("pagination") 또는 객체 키(pagination:) 둘 다 허용.
      const serialized = /"pagination"/.test(src) || /\bpagination\s*:/.test(src);
      expect(serialized, `${layout}에 pagination 직렬화가 없어 PaginationBar 라벨이 raw 키로 깨짐`).toBe(
        true
      );
    }
  );
});
