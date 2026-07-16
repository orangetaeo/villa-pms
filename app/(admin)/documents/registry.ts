// 사업 계약서 문서 뷰어 화이트리스트 (ADMIN 전용, 재무 등급).
//
// ★ 보안: slug → 파일명은 이 하드코딩 맵으로만 해석한다. 사용자 입력(?doc=)을
//   파일 경로에 절대 이어붙이지 않는다(path traversal 봉쇄). 여기 없는 slug는 notFound().
//   파일은 repo 내부 docs/business/contracts/ 아래로 고정된다.
//
// 제목·설명은 i18n 키(adminDocuments.docs.<slug>.name/.desc)로 렌더한다 —
// 마크다운 첫 줄 파싱 없이 이 정적 목록이 표시 순서·메타의 단일 원천.

/** 계약서 파일이 위치한 repo 상대 디렉터리 (process.cwd() 기준) */
export const CONTRACTS_DIR = ["docs", "business", "contracts"] as const;

export interface DocEntry {
  /** URL ?doc= 값 (화이트리스트 키) */
  slug: string;
  /** 실제 파일명 — 이 목록 밖 값은 접근 불가 */
  file: string;
  /** 목록 카드 아이콘 (Material Symbols) */
  icon: string;
}

export const DOC_REGISTRY: readonly DocEntry[] = [
  { slug: "framework", file: "00-contract-framework.md", icon: "account_tree" },
  { slug: "villa", file: "01-villa-supply-agreement.md", icon: "villa" },
  { slug: "partner", file: "02-partner-agency-agreement.md", icon: "handshake" },
  { slug: "vendor", file: "03-service-vendor-agreement.md", icon: "room_service" },
] as const;

/** 화이트리스트에서만 해석 — 없으면 undefined (호출부에서 notFound) */
export function resolveDoc(slug: string | undefined): DocEntry | undefined {
  if (!slug) return undefined;
  return DOC_REGISTRY.find((d) => d.slug === slug);
}
