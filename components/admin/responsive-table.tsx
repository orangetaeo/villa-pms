// 운영자(ADMIN) 공통 반응형 테이블 (T6.7 패턴, T1.2에서 추출)
// ≥768px: 테이블 / <768px: 라벨-값 카드 스택으로 전환
// 서버·클라이언트 컴포넌트 양쪽에서 직접 렌더 가능 (훅 미사용 — RSC에서 cell 함수 전달 OK)
// 스타일 토큰: Stitch b10 요율 테이블 기준 (bg-admin-card, slate-800 보더)

import type { ReactNode } from "react";

export interface ResponsiveColumn<T> {
  /** 열 식별자 */
  key: string;
  /** 헤더 라벨 (모바일 카드의 행 라벨로도 사용) */
  header: ReactNode;
  /** 셀 렌더러 */
  cell: (row: T) => ReactNode;
  /** 데스크톱 td 추가 클래스 (정렬 등) */
  className?: string;
  /** 데스크톱 th 추가 클래스 */
  headerClassName?: string;
  /** 모바일 카드에서 숨김 (사진 등 카드 헤더로 따로 빼는 열) */
  hideOnCard?: boolean;
}

interface ResponsiveTableProps<T> {
  columns: ResponsiveColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** 모바일 카드 상단 커스텀 영역 (사진·제목 등) — 비접이식 카드에서 사용 */
  cardHeader?: (row: T) => ReactNode;
  /**
   * 모바일 카드 접힘 요약(2줄). 제공 시 카드가 아코디언(<details>)으로 전환:
   * 접힘=이 요약만, 탭하면 hideOnCard가 아닌 나머지 컬럼이 펼쳐짐.
   * (훅 미사용 — 네이티브 <details>로 RSC 호환 유지, 모바일 빈 공간/세로길이 해결)
   */
  cardSummary?: (row: T) => ReactNode;
  /** 아코디언 펼침 본문 하단 액션(예: "상세 보기" 버튼) — cardSummary와 함께 사용 */
  cardFooter?: (row: T) => ReactNode;
  emptyMessage?: ReactNode;
  /** 행 추가 클래스 (비활성 행 배경 등 — 데스크톱 tr·모바일 카드 공통, T1.8 b13) */
  rowClassName?: (row: T) => string | undefined;
}

export default function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  cardHeader,
  cardSummary,
  cardFooter,
  emptyMessage,
  rowClassName,
}: ResponsiveTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="bg-admin-card rounded-xl border border-slate-800 p-10 text-center text-sm text-admin-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <>
      {/* 데스크톱: 테이블 */}
      <div className="hidden md:block bg-admin-card rounded-xl border border-slate-800 overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-900/50 text-slate-500 uppercase">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 font-bold border-b border-slate-800 ${col.headerClassName ?? ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={`hover:bg-slate-800/30 transition-colors ${rowClassName?.(row) ?? ""}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-4 ${col.className ?? ""}`}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 모바일(<768px): 카드 스택 */}
      <div className="md:hidden flex flex-col gap-3">
        {rows.map((row) => {
          const cardRows = columns.filter((col) => !col.hideOnCard);

          // 아코디언 모드 — cardSummary 제공 시 접힘/펼침 (네이티브 <details>, JS 불필요)
          if (cardSummary) {
            return (
              <details
                key={rowKey(row)}
                className={`group bg-admin-card rounded-xl border border-slate-800 overflow-hidden ${rowClassName?.(row) ?? ""}`}
              >
                <summary className="list-none cursor-pointer select-none p-4 flex items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0 flex-1">{cardSummary(row)}</div>
                  <span
                    className="material-symbols-outlined shrink-0 text-slate-500 text-xl transition-transform group-open:rotate-180"
                    aria-hidden
                  >
                    expand_more
                  </span>
                </summary>
                {(cardRows.length > 0 || cardFooter) && (
                  <div className="px-4 pb-4 pt-3 flex flex-col gap-2 border-t border-slate-800/60">
                    {cardRows.map((col) => (
                      <div key={col.key} className="flex items-start justify-between gap-3 text-sm">
                        <span className="text-[11px] font-bold text-slate-500 uppercase shrink-0 pt-0.5">
                          {col.header}
                        </span>
                        <span className="text-slate-200 text-right min-w-0">{col.cell(row)}</span>
                      </div>
                    ))}
                    {cardFooter?.(row)}
                  </div>
                )}
              </details>
            );
          }

          // 기존 비접이식 카드 (cardHeader 전용 소비처 호환)
          return (
            <div
              key={rowKey(row)}
              className={`bg-admin-card rounded-xl border border-slate-800 p-4 flex flex-col gap-2 ${rowClassName?.(row) ?? ""}`}
            >
              {cardHeader?.(row)}
              {cardRows.map((col) => (
                <div key={col.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-[11px] font-bold text-slate-500 uppercase shrink-0">
                    {col.header}
                  </span>
                  <span className="text-slate-200 text-right min-w-0">{col.cell(row)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
