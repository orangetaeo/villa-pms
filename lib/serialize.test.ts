import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { serializeBigInt } from "./serialize";

describe("serializeBigInt — 응답 직렬화 (money-pattern)", () => {
  it("BigInt → 문자열", () => {
    expect(serializeBigInt(8_500_000n)).toBe("8500000");
  });

  it("Prisma.Decimal(환율) → 문자열 — 내부 구조 {s,e,d} 노출 금지 (T2.1 QA D-1)", () => {
    const fx = new Prisma.Decimal("1845.5");
    expect(serializeBigInt(fx)).toBe("1845.5");
    expect(serializeBigInt({ fxVndPerKrw: new Prisma.Decimal("17.5000") })).toEqual({
      fxVndPerKrw: "17.5",
    });
    // JSON 왕복에서도 평문 문자열이어야 함
    expect(JSON.stringify(serializeBigInt({ fx }))).toBe('{"fx":"1845.5"}');
  });

  it("Date → ISO 문자열, null/undefined 통과", () => {
    expect(serializeBigInt(new Date("2026-07-01T00:00:00.000Z"))).toBe("2026-07-01T00:00:00.000Z");
    expect(serializeBigInt(null)).toBeNull();
    expect(serializeBigInt(undefined)).toBeUndefined();
  });

  it("중첩 객체·배열 재귀 변환", () => {
    expect(
      serializeBigInt({
        booking: { totalSaleVnd: 6_000_000n, fxVndPerKrw: new Prisma.Decimal("17.5") },
        items: [{ totalVnd: 4_000_000n }, null],
        name: "쏘나씨 V12",
        nights: 3,
      })
    ).toEqual({
      booking: { totalSaleVnd: "6000000", fxVndPerKrw: "17.5" },
      items: [{ totalVnd: "4000000" }, null],
      name: "쏘나씨 V12",
      nights: 3,
    });
  });
});
