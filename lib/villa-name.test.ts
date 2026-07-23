import { describe, expect, it } from "vitest";
import { formatVillaName, publicVillaCode } from "./villa-name";

// ADR-0020 빌라명 병기 헬퍼 — 병기·폴백·중복방지 가드
describe("formatVillaName — 병기 표기", () => {
  it("nameVi 있으면 한국어 (베트남어) 병기", () => {
    expect(formatVillaName({ name: "쏘나씨 V11", nameVi: "Sonasea V11" })).toBe(
      "쏘나씨 V11 (Sonasea V11)"
    );
  });

  it("nameVi 없으면(null/undefined) 한국어명만 — 폴백", () => {
    expect(formatVillaName({ name: "쏘나씨 V11", nameVi: null })).toBe("쏘나씨 V11");
    expect(formatVillaName({ name: "쏘나씨 V11" })).toBe("쏘나씨 V11");
  });

  it("nameVi가 공백뿐이면 폴백", () => {
    expect(formatVillaName({ name: "Marina C5", nameVi: "   " })).toBe("Marina C5");
  });

  it("nameVi가 name과 같으면 중복 병기 안 함", () => {
    expect(formatVillaName({ name: "Marina C5", nameVi: "Marina C5" })).toBe("Marina C5");
  });

  it("nameVi 앞뒤 공백은 트림 후 병기", () => {
    expect(formatVillaName({ name: "썬셋 사나토 A3", nameVi: "  Sunset Sanato A3  " })).toBe(
      "썬셋 사나토 A3 (Sunset Sanato A3)"
    );
  });
});

// 제안 링크 익명 코드명 — 실명·위치를 드러내지 않는 결정적 식별자 (2026-07-24)
describe("publicVillaCode — 제안 링크 익명 코드", () => {
  it("실명(name)이 코드에 들어가지 않는다", () => {
    const code = publicVillaCode("cmrx7ymsk0001ukz8z0syhak1");
    expect(code).not.toMatch(/villa m1/i);
    expect(code).toMatch(/^Villa Go #[A-Z0-9]{4}$/);
  });

  it("같은 id는 항상 같은 코드(결정적)", () => {
    const id = "cmrx7ymsk0001ukz8z0syhak1";
    expect(publicVillaCode(id)).toBe(publicVillaCode(id));
    expect(publicVillaCode(id)).toBe("Villa Go #HAK1");
  });

  it("id가 다르면 대체로 다른 코드", () => {
    expect(publicVillaCode("aaaa1111")).not.toBe(publicVillaCode("bbbb2222"));
  });

  it("영숫자가 4자 미만이어도 안전(폴백)", () => {
    expect(publicVillaCode("--")).toBe("Villa Go #0000");
  });
});
