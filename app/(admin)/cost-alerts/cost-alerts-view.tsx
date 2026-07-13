"use client";

// 견적 중 원가 변경 경보 뷰 (b15) — 제안별 카드 + 변경 전/후 원가 비교 + 마진 영향
// - 마진 단일 소스: 서버 loadCostAlerts가 산출한 old/newMarginPct만 표시(클라 재계산 금지)
// - "판매가 조정" = 제안 수정 화면으로 이동 / "유지" = 알림 확인 처리(목록에서 제거)
// - 반응형: ≥768px 표 / <768px 카드 스택
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import PaginationBar from "@/components/pagination-bar";
import ListSearch from "@/components/list-search";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatThousands } from "@/lib/format";

type Season = "LOW" | "SHOULDER" | "HIGH" | "PEAK";

interface CostAlertRow {
  notificationId: string;
  villaId: string;
  villaName: string;
  season: Season;
  oldCostVnd: string;
  newCostVnd: string | null;
  deltaVnd: string;
  salePriceVnd: string | null;
  oldMarginPct: string | null;
  newMarginPct: string | null;
  recommend: "adjust" | "keep";
}

interface CostAlertGroup {
  proposalId: string;
  proposalToken: string;
  clientName: string;
  saleCurrency: "KRW" | "VND";
  detectedAt: string;
  notificationIds: string[];
  rows: CostAlertRow[];
}

/** ISO 타임스탬프 → "YYYY.MM.DD HH:mm" (Asia/Ho_Chi_Minh, 점 표기) */
const dtFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  // hourCycle h23: 클라 컴포넌트라 SSR↔하이드레이션 시각이 자정 "24"/"00"로 갈리면 React #418 → "00" 고정
  hourCycle: "h23",
});
function dotDateTime(iso: string): string {
  const parts = dtFmt.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 델타 칩 — 부호 + 천단위 (양수=빨강 상승, 음수=초록 하락) */
function deltaChip(deltaVnd: string) {
  const neg = deltaVnd.startsWith("-");
  const abs = neg ? deltaVnd.slice(1) : deltaVnd;
  if (abs === "0") return null;
  return (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded mt-1 inline-flex items-center gap-0.5 ${
        neg ? "text-emerald-400 bg-emerald-400/10" : "text-red-400 bg-red-400/10"
      }`}
    >
      {neg ? "▼ −" : "▲ +"}
      {formatThousands(abs)}₫
    </span>
  );
}

export default function CostAlertsView({ groups }: { groups: CostAlertGroup[] }) {
  const t = useTranslations("adminCostAlerts");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = groups.filter((g) => !dismissed.has(g.proposalId));

  // 검색 — 고객명·제안 토큰·그룹 내 행 빌라명(어느 행이든 매치 시 그룹 노출).
  // (조기 반환보다 위에 선언 — hooks 규칙. 페이지네이션 slice 이전에 적용)
  const [search, setSearch] = useState("");
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter(
      (g) =>
        (g.clientName ?? "").toLowerCase().includes(q) ||
        (g.proposalToken ?? "").toLowerCase().includes(q) ||
        g.rows.some((r) => (r.villaName ?? "").toLowerCase().includes(q))
    );
  }, [visible, search]);

  // 클라 페이지네이션 — groups·검색어 바뀌면 1페이지로. (조기 반환보다 위에 선언 — hooks 규칙)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => setPage(1), [groups, search]);
  const pagedGroups = useMemo(
    () => searched.slice((page - 1) * pageSize, page * pageSize),
    [searched, page, pageSize]
  );

  const dismiss = async (g: CostAlertGroup) => {
    setBusy(g.proposalId);
    setError(null);
    try {
      const res = await fetch("/api/cost-alerts/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationIds: g.notificationIds }),
      });
      if (!res.ok) {
        setError(t("dismissError"));
        return;
      }
      setDismissed((s) => new Set(s).add(g.proposalId));
    } catch {
      setError(t("dismissError"));
    } finally {
      setBusy(null);
    }
  };

  if (visible.length === 0) {
    return (
      <div className="bg-admin-card rounded-xl border border-slate-800 p-12 text-center">
        <span className="material-symbols-outlined text-emerald-500 text-4xl mb-2">task_alt</span>
        <p className="text-sm text-slate-400">{t("empty")}</p>
      </div>
    );
  }

  const seasonLabel = (s: Season) => t(`seasons.${s}`);

  const marginCell = (r: CostAlertRow) => {
    if (r.oldMarginPct == null) return <span className="text-slate-600 text-xs">—</span>;
    if (r.newMarginPct == null) {
      // 삭제 — 새 마진 없음
      return <span className="text-slate-500 text-xs">{r.oldMarginPct}%</span>;
    }
    const dropped = parseFloat(r.newMarginPct) < parseFloat(r.oldMarginPct);
    return (
      <div className="flex items-center justify-end gap-2 tabular-nums">
        <span className="text-slate-500 text-xs">{r.oldMarginPct}%</span>
        <span className="material-symbols-outlined text-[16px] text-slate-600">arrow_forward</span>
        <span className={dropped ? "text-orange-400 font-bold" : "text-emerald-400 font-bold"}>
          {r.newMarginPct}%
        </span>
      </div>
    );
  };

  const newCostCell = (r: CostAlertRow) =>
    r.newCostVnd == null ? (
      <span className="text-red-400 font-bold text-xs">{t("deleted")}</span>
    ) : (
      <div className="flex flex-col items-end">
        <span className="text-white font-black tabular-nums">{formatThousands(r.newCostVnd)}₫</span>
        {deltaChip(r.deltaVnd)}
      </div>
    );

  const actionBadge = (r: CostAlertRow) =>
    r.recommend === "adjust" ? (
      <span className="bg-red-500/10 text-red-400 border border-red-500/20 px-2.5 py-1 rounded-md text-[11px] font-bold whitespace-nowrap">
        {t("actionAdjust")}
      </span>
    ) : (
      <span className="bg-slate-500/10 text-slate-400 border border-slate-500/20 px-2.5 py-1 rounded-md text-[11px] font-bold">
        {t("actionKeep")}
      </span>
    );

  return (
    <div className="space-y-6">
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          {error}
        </p>
      )}

      <ListSearch
        placeholder={t("searchPlaceholder")}
        value={search}
        onChange={setSearch}
        className="max-w-xs"
      />

      {pagedGroups.map((g) => (
        <section
          key={g.proposalId}
          className="bg-admin-card rounded-xl border border-slate-800 overflow-hidden shadow-sm"
        >
          {/* 경보 헤더 */}
          <div className="bg-amber-500/[0.07] border-b border-amber-500/20 px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-amber-500">warning</span>
              </div>
              <div className="[word-break:keep-all]">
                <h3 className="text-amber-500 font-bold text-sm">{t("bannerTitle")}</h3>
                <p className="text-amber-200/70 text-xs mt-0.5">
                  {t("proposalLabel")} P-{g.proposalId.slice(-4).toUpperCase()} · {t("client")}:{" "}
                  {g.clientName} · {t("detectedAt")} {dotDateTime(g.detectedAt)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Link
                href={`/proposals/new?from=${g.proposalId}`}
                className="bg-admin-primary text-white text-xs font-bold px-4 py-2 rounded shadow-lg shadow-blue-500/10 hover:bg-admin-primary-dark transition-colors whitespace-nowrap"
              >
                {t("review")}
              </Link>
              <button
                type="button"
                disabled={busy === g.proposalId}
                onClick={() => void dismiss(g)}
                className="text-slate-400 hover:text-white text-xs font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {t("dismiss")}
              </button>
            </div>
          </div>

          {/* 데스크톱(≥768px): 비교 표 */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead className="bg-slate-900/40 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3 border-b border-slate-800">{t("colSeason")}</th>
                  <th className="px-6 py-3 border-b border-slate-800 text-right">{t("colOldCost")}</th>
                  <th className="px-6 py-3 border-b border-slate-800 text-right">{t("colNewCost")}</th>
                  <th className="px-6 py-3 border-b border-slate-800 text-right">{t("colSalePrice")}</th>
                  <th className="px-6 py-3 border-b border-slate-800 text-right">{t("colMargin")}</th>
                  <th className="px-6 py-3 border-b border-slate-800 text-center">{t("colAction")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {g.rows.map((r) => (
                  <tr
                    key={r.notificationId}
                    className={`hover:bg-slate-800/40 transition-colors ${
                      r.recommend === "adjust" ? "bg-amber-500/[0.03]" : ""
                    }`}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-1.5 h-6 rounded-full ${
                            r.recommend === "adjust" ? "bg-red-500" : "bg-slate-700"
                          }`}
                        />
                        <div>
                          <div className="text-white font-bold text-sm">
                            {r.villaName} · {seasonLabel(r.season)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-slate-500 line-through">
                      {formatThousands(r.oldCostVnd)}₫
                    </td>
                    <td className="px-6 py-4 text-right">{newCostCell(r)}</td>
                    <td className="px-6 py-4 text-right tabular-nums text-slate-300 font-medium">
                      {r.salePriceVnd != null ? `${formatThousands(r.salePriceVnd)}₫` : "—"}
                    </td>
                    <td className="px-6 py-4 text-right">{marginCell(r)}</td>
                    <td className="px-6 py-4 text-center">{actionBadge(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 모바일(<768px): 카드 스택 */}
          <div className="md:hidden flex flex-col divide-y divide-slate-800">
            {g.rows.map((r) => (
              <div key={r.notificationId} className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white font-bold text-sm">
                    {r.villaName} · {seasonLabel(r.season)}
                  </span>
                  {actionBadge(r)}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <span className="text-slate-500">{t("colOldCost")}</span>
                  <span className="text-right text-slate-500 line-through tabular-nums">
                    {formatThousands(r.oldCostVnd)}₫
                  </span>
                  <span className="text-slate-500">{t("colNewCost")}</span>
                  <span className="text-right">{newCostCell(r)}</span>
                  <span className="text-slate-500">{t("colSalePrice")}</span>
                  <span className="text-right text-slate-300 tabular-nums">
                    {r.salePriceVnd != null ? `${formatThousands(r.salePriceVnd)}₫` : "—"}
                  </span>
                  <span className="text-slate-500">{t("colMargin")}</span>
                  <span className="text-right">{marginCell(r)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* 하단 안내 — 마진 비공개 원칙 */}
          <div className="px-6 py-3 bg-slate-900/20 border-t border-slate-800 flex items-start gap-2">
            <span className="material-symbols-outlined text-slate-500 text-sm shrink-0">info</span>
            <p className="text-slate-500 text-[11px] font-medium [word-break:keep-all] leading-relaxed">
              {t("marginNote")} {t("privacyNote")}
            </p>
          </div>
        </section>
      ))}

      <PaginationBar
        total={searched.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
      />
    </div>
  );
}
