// lib/complex-area.ts — 지역(단지) 마스터 서버 헬퍼 (ADR-0046, T-complex-area-master)
//
// 단일 원천 = ComplexArea. Villa.complex(String)는 마스터 name의 비정규화 캐시로,
// 여기 헬퍼를 경유한 서버 파생 쓰기만 허용한다(클라이언트 자유 문자열 수신 금지).
//   - resolveComplexAreaForVilla: 빌라 create/update 시 complexAreaId → {complexAreaId, complex=master.name}
//   - activeComplexNameSet:       vendors regions 봉인용 활성 마스터 name 집합
//   - slugifyComplexCode:         관리자 CRUD 생성 시 code(라틴 슬러그) 자동 생성
//
// ※ 서버 전용 — prisma 의존. 클라이언트 마법사와 공유하는 lib/villa-schema.ts에는 넣지 않는다.
import type { DbClient } from "@/lib/availability";

export type ComplexAreaResolution =
  | { ok: true; complexAreaId: string | null; complex: string | null }
  | { ok: false }; // 미존재/비활성 → 호출부에서 400 UNKNOWN_COMPLEX

/**
 * 빌라 저장용 지역 파생 — complexAreaId(입력) → { complexAreaId, complex=master.name }.
 *   null/undefined = 해제(둘 다 null). 값 = 활성 마스터 lookup 후 name 캐시 채움.
 *   미존재/비활성 id는 ok:false (호출부에서 400 UNKNOWN_COMPLEX).
 */
export async function resolveComplexAreaForVilla(
  db: DbClient,
  complexAreaId: string | null | undefined,
): Promise<ComplexAreaResolution> {
  if (complexAreaId == null) {
    return { ok: true, complexAreaId: null, complex: null };
  }
  const master = await db.complexArea.findFirst({
    where: { id: complexAreaId, active: true },
    select: { id: true, name: true },
  });
  if (!master) return { ok: false };
  return { ok: true, complexAreaId: master.id, complex: master.name };
}

/** 활성 마스터 name 집합 — ServiceVendorRegion 봉인(UNKNOWN_REGION) 대조용. */
export async function activeComplexNameSet(db: DbClient): Promise<Set<string>> {
  const rows = await db.complexArea.findMany({
    where: { active: true },
    select: { name: true },
  });
  return new Set(rows.map((r) => r.name));
}

/**
 * name → code(라틴 슬러그) 자동 생성. 관리자 CRUD 생성 시 code 미수신이면 사용.
 * 한글 등 비라틴은 제거되므로 결과가 비면 "area" 폴백(호출부가 code 유일성 재확인).
 */
export function slugifyComplexCode(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "area";
}
