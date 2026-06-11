import { Prisma } from "@prisma/client";

// JSON 직렬화 유틸 — BigInt(VND 동 단위)는 JSON.stringify가 throw하므로 문자열로 변환
// 금액 규칙(money-pattern): VND = BigInt, 응답에서는 항상 string
export function serializeBigInt<T>(input: T): unknown {
  if (typeof input === "bigint") return input.toString();
  if (input === null || input === undefined) return input;
  if (input instanceof Date) return input.toISOString();
  // Prisma Decimal(환율 fxVndPerKrw 등) — 일반 객체로 순회하면 내부 구조 {s,e,d}로
  // 망가짐 (T2.1 QA D-1). 문자열로 변환
  if (Prisma.Decimal.isDecimal(input)) return input.toString();
  if (Array.isArray(input)) return input.map((item) => serializeBigInt(item));
  if (typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        key,
        serializeBigInt(value),
      ])
    );
  }
  return input;
}
