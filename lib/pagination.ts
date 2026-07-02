// 리스트 페이지 공통 페이지네이션 — 페이지 번호 + 페이지당 개수(10/20/30/50/100).
// 서버(RSC)는 parsePageParams로 skip/take 산출, UI는 components/pagination-bar.tsx 사용.

export const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;

/** searchParams의 page·pageSize를 검증해 {page, pageSize, skip, take} 반환.
 *  page<1·비정상 → 1, pageSize는 허용값(10/20/30/50/100) 외엔 기본 10. */
export function parsePageParams(params: { page?: string; pageSize?: string }): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const rawSize = Number.parseInt(params.pageSize ?? "", 10);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(rawSize)
    ? rawSize
    : DEFAULT_PAGE_SIZE;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
