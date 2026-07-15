// lib/snapshot-restore.ts — 스냅샷 복원 시 BigInt 필드 역변환(P2-1).
//
// 스냅샷 직렬화(lib/db-snapshot.serializeSnapshot)는 BigInt를 `"123n"`/`"-5n"` 문자열로 저장한다.
// 복원 시 전역 문자열 패턴으로 되돌리면 String 컬럼에 우연히 "123n" 값이 있을 때 오변환된다.
// 따라서 dmmf가 **BigInt 스칼라로 선언한 필드에만** 역변환을 적용한다(필드 인지 방식).
import { Prisma } from "@prisma/client";

/** `"123n"`/`"-5n"` 스냅샷 문자열 매칭 패턴. */
const BIGINT_STR = /^-?\d+n$/;

/**
 * 모델별 BigInt 스칼라 필드명 집합(dmmf 파생). BigInt[] 스칼라 리스트 필드도 포함(kind=scalar 유지).
 */
export const BIGINT_FIELDS_BY_MODEL: Map<string, Set<string>> = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name,
    new Set(m.fields.filter((f) => f.type === "BigInt" && f.kind === "scalar").map((f) => f.name)),
  ])
);

/** 단일 값을 BigInt로 역변환(스칼라·리스트 대응). 패턴 불일치 문자열·기타 타입은 그대로. */
export function toBigIntValue(value: unknown): unknown {
  if (typeof value === "string" && BIGINT_STR.test(value)) return BigInt(value.slice(0, -1));
  if (Array.isArray(value)) return value.map(toBigIntValue); // BigInt[] 스칼라 리스트
  return value;
}

/**
 * 한 모델의 행 배열에서 BigInt 필드만 골라 역변환(in-place). BigInt 필드가 없으면 무동작.
 * String 등 다른 컬럼은 값이 "123n"처럼 보여도 건드리지 않는다.
 */
export function reviveRowsBigInt(modelName: string, rows: unknown[]): void {
  const bigIntFields = BIGINT_FIELDS_BY_MODEL.get(modelName);
  if (!bigIntFields || bigIntFields.size === 0) return;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    for (const field of bigIntFields) {
      if (field in rec) rec[field] = toBigIntValue(rec[field]);
    }
  }
}

/** dump 전체(모델→행[])에 대해 BigInt 필드 역변환(in-place). 반환값은 입력과 동일 참조. */
export function reviveDumpBigInt(dump: Record<string, unknown[]>): Record<string, unknown[]> {
  for (const [modelName, rows] of Object.entries(dump)) {
    if (Array.isArray(rows)) reviveRowsBigInt(modelName, rows);
  }
  return dump;
}
