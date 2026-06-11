// JSON 직렬화 유틸 — BigInt(VND 동 단위)는 JSON.stringify가 throw하므로 문자열로 변환
// 금액 규칙(money-pattern): VND = BigInt, 응답에서는 항상 string
export function serializeBigInt<T>(input: T): unknown {
  if (typeof input === "bigint") return input.toString();
  if (input === null || input === undefined) return input;
  if (input instanceof Date) return input.toISOString();
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
