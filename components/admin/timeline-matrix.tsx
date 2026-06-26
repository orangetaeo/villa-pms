// 타임라인 매트릭스 — Stitch b1-dashboard "Timeline Matrix Container" 변환 (T1.5)
// 렌더 전용 서버 컴포넌트. 데이터는 lib/timeline.ts loadTimeline (ADMIN 전용 소비).
// props에는 셀 상태만 — 고객명·금액·예약 id 없음 (계약 T1.5, 마진·재고 비공개 원칙).
// 범례는 b1 모크 그대로 4종 — CHECKED_IN(indigo) 범례 부재는 모크 충실, 확장은 T2.6 판단.
import { getTranslations } from "next-intl/server";
import type { TimelineCellState, TimelineData } from "@/lib/timeline";

// b1 셀 상태 클래스 (index.html 256~316행): confirmed bg-blue-600, checked-in
// bg-indigo-500, hold 45° 빗금+amber dashed, blocked bg-slate-600, 판매불가 red 테두리
const CELL_STATE_CLASS: Record<TimelineCellState, string> = {
  EMPTY: "",
  CONFIRMED: " bg-blue-600 shadow-inner",
  CHECKED_IN: " bg-indigo-500",
  HOLD: " border border-dashed border-amber-500 bg-[repeating-linear-gradient(45deg,#F59E0B22,#F59E0B22_10px,#F59E0B44_10px,#F59E0B44_20px)]",
  BLOCKED: " bg-slate-600",
  NOT_SELLABLE: " border-2 border-red-600",
  // F10 공급자 직접예약 — 확정(파랑)과 구분되는 청록 실선 (운영자 전용 식별)
  SUPPLIER_DIRECT: " bg-teal-500 shadow-inner",
};

const STICKY_COL =
  "sticky left-0 z-10 bg-admin-card border-r border-slate-700/50";

export default async function TimelineMatrix({ data }: { data: TimelineData }) {
  const t = await getTranslations("adminDashboard.timeline");

  return (
    <div className="bg-admin-card rounded-xl border border-slate-700/50 overflow-hidden flex flex-col">
      <div className="p-4 border-b border-slate-700/50 flex justify-between items-center">
        <h3 className="font-bold text-white">{t("title")}</h3>
        <div className="flex gap-2 text-slate-200 text-[10px]">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-blue-600"></span> {t("legendConfirmed")}
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-teal-500"></span> {t("legendSupplierDirect")}
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-amber-500/40 border border-amber-500 border-dashed"></span>{" "}
            {t("legendHold")}
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-slate-600"></span> {t("legendBlocked")}
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded border border-red-600"></span>{" "}
            {t("legendNotSellable")}
          </div>
        </div>
      </div>
      {data.rows.length === 0 ? (
        <p className="p-8 text-sm text-admin-muted text-center">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-900/50 text-[11px] text-slate-500 uppercase tracking-wider">
                <th className={`${STICKY_COL} p-3 text-left min-w-[140px]`}>
                  {t("villaColumn")}
                </th>
                {data.dayLabels.map((label, i) => (
                  <th
                    key={label}
                    className={`p-2 border-r border-slate-800 min-w-[40px] text-center${
                      i === data.todayIndex ? " bg-slate-800/60 text-slate-300" : ""
                    }`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-xs">
              {data.rows.map((row) => (
                <tr
                  key={row.villaId}
                  className="border-b border-slate-800 hover:bg-slate-800/30"
                >
                  <td className={`${STICKY_COL} p-3 font-medium text-slate-300`}>
                    {row.villaName}
                  </td>
                  {row.cells.map((state, i) => (
                    <td
                      key={i}
                      title={`${row.villaName} ${data.dayLabels[i]}`}
                      className={`p-2 border-r border-slate-800 h-10${CELL_STATE_CLASS[state]}`}
                    ></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
