// lib/db-snapshot.ts — 전체 DB 논리 스냅샷 공용 모듈 (T-db-backup-automation)
//
// 배경: 서버 PostgreSQL 18 vs 로컬 17 버전 불일치로 pg_dump가 실패(0바이트)한다.
//   스키마는 git의 prisma/schema.prisma에 있으므로 **데이터만** dmmf 전 모델 findMany로 확보한다.
//   원본 로직 출처: prisma/export-full-snapshot.ts (2026-07-09 수동 스냅샷). 이 모듈로 추출해
//   CLI 스크립트(export-full-snapshot)와 cron 라우트(/api/cron/db-backup)가 공유한다.
//
// BigInt 직렬화: VND 등 BigInt 컬럼은 JSON이 표현하지 못하므로 `"123n"` 문자열로 저장한다
//   (복원 시 scripts/restore-from-snapshot.ts가 `/^-?\d+n$/` 매칭으로 역변환). 기존 방식 유지.
import { Prisma, type PrismaClient } from "@prisma/client";

export interface SnapshotResult {
  /** { [모델명]: 전 행[] } — 각 값은 findMany 원본(스칼라 + FK 스칼라만, 관계 미포함). */
  dump: Record<string, unknown[]>;
  /** dmmf 모델 총수(findMany 불가 모델 포함 — 기존 CLI 요약과 동일 집계). */
  modelCount: number;
  /** 전 모델 합계 행 수. */
  rowCount: number;
}

/**
 * dmmf의 전 모델을 순회하며 각 모델의 전 행을 findMany로 수집.
 * 반환 dump는 아직 직렬화 전(BigInt는 bigint 그대로) — serializeSnapshot으로 문자열화한다.
 *
 * ⚠ 규모: 현재 실DB ≈23MB(gzip 전). 전 행을 메모리에 적재하므로 수십 MB까지는 안전하나,
 *   수백 MB 이상으로 커지면 모델별 스트리밍/커서 페치로 전환 필요(현 규모에선 불필요).
 */
export async function snapshotAllModels(prisma: PrismaClient): Promise<SnapshotResult> {
  const models = Prisma.dmmf.datamodel.models;
  const dump: Record<string, unknown[]> = {};
  let rowCount = 0;
  for (const m of models) {
    // 모델명 → 클라이언트 프로퍼티(첫 글자 소문자). 예: "Villa" → prisma.villa
    const prop = m.name[0].toLowerCase() + m.name.slice(1);
    const client = (prisma as unknown as Record<string, { findMany?: () => Promise<unknown[]> }>)[prop];
    if (!client?.findMany) continue;
    const rows = await client.findMany();
    dump[m.name] = rows;
    rowCount += rows.length;
  }
  return { dump, modelCount: models.length, rowCount };
}

/**
 * dump를 JSON 문자열로 직렬화. BigInt는 `` `${v}n` `` 문자열로 치환(복원 시 역변환).
 * 들여쓰기 없음(0) — 백업 파일 크기 최소화.
 */
export function serializeSnapshot(dump: Record<string, unknown[]>): string {
  return JSON.stringify(dump, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 0);
}

/**
 * 보존 초과분 키 선별(순수 함수 — 경계 로직 유닛 테스트 대상). cron 라우트가 사용.
 * 키 이름 내림차순 정렬(`daily/villa-pms-YYYY-MM-DD.json.gz`는 사전순=시간순) 후 최근 keep개 초과분 반환.
 * 원본 배열 불변(복제 후 정렬).
 * @returns 삭제 대상 키 배열(최신 keep개는 보존).
 *
 * ⚠ Next.js 라우트 파일은 핸들러·config 외 export를 금지하므로 이 순수 함수는 여기(lib)에 둔다.
 */
export function selectKeysToPrune(keys: string[], keep: number): string[] {
  if (keep < 0) return [];
  return [...keys].sort().reverse().slice(keep);
}
