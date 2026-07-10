"use client";

// 제안 목록 (T2.1 — Stitch b12-proposals-list 변환)
// - 상태 탭은 서버가 준 effectiveStatus 기준 (클라 재계산 금지 — lib/proposal 단일 소스)
// - 카운트다운은 분 단위 갱신 ("23시간 남음" / "45분 남음", 주황 배지)
// - 금액 열은 행별 채널 통화 혼재 표기 (VND 쉼표 ₫ / KRW 쉼표 원) — 우측 정렬·tabular-nums
// - <768px 카드 전환은 ResponsiveTable 재사용 (T6.7 — 수정 금지 컴포넌트)
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import ResponsiveTable, { type ResponsiveColumn } from "@/components/admin/responsive-table";
import PaginationBar from "@/components/pagination-bar";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { formatThousands, formatVnd } from "@/lib/format";
import { quickRangeWhere } from "@/lib/date-vn";
import QuickDateFilter from "@/components/admin/quick-date-filter";
import { DateField } from "@/components/date-field";

type ProposalStatus = "ACTIVE" | "USED" | "EXPIRED" | "REVOKED";
type Channel = "TRAVEL_AGENCY" | "LAND_AGENCY" | "DIRECT";

interface ProposalItemRow {
  id: string;
  villaId: string;
  checkIn: string; // ISO (serializeBigInt가 Date→ISO 문자열)
  checkOut: string;
  totalKrw: number | null;
  totalVnd: string | null; // BigInt 직렬화 — 문자열
  bookingId: string | null;
  villa: { name: string };
}

interface ProposalRow {
  id: string;
  token: string;
  clientName: string;
  channel: Channel;
  saleCurrency: "KRW" | "VND";
  status: ProposalStatus;
  effectiveStatus: ProposalStatus; // 시각 기준 서버 판정값 — 탭 분류는 이 값만 사용
  expiresAt: string;
  createdAt: string;
  items: ProposalItemRow[];
}

type TabKey = "all" | "active" | "used" | "expired" | "revoked";
const TAB_STATUS: Record<Exclude<TabKey, "all">, ProposalStatus> = {
  active: "ACTIVE",
  used: "USED",
  expired: "EXPIRED",
  revoked: "REVOKED",
};
const TABS: TabKey[] = ["all", "active", "used", "expired", "revoked"];

// 상태 배지 (b12: 활성=blue, 사용됨=green, 만료=slate, 회수=red outline)
const STATUS_BADGE_CLASS: Record<ProposalStatus, string> = {
  ACTIVE: "bg-blue-500/10 text-blue-400",
  USED: "bg-green-500/10 text-green-500",
  EXPIRED: "bg-slate-700/50 text-admin-muted",
  REVOKED: "border border-red-500/50 text-red-500",
};

// 채널 배지 (b12: 여행사=indigo, 랜드사=emerald, 직접=blue)
const CHANNEL_BADGE_CLASS: Record<Channel, string> = {
  TRAVEL_AGENCY: "bg-indigo-500/10 text-indigo-400",
  LAND_AGENCY: "bg-emerald-500/10 text-emerald-400",
  DIRECT: "bg-blue-500/10 text-blue-400",
};

/** ISO 날짜 → "YYYY.MM.DD" (점 표기 규칙) — @db.Date(UTC 자정) 전용 */
function dotDate(iso: string): string {
  return iso.slice(0, 10).replaceAll("-", ".");
}

/** 타임스탬프 → Asia/Ho_Chi_Minh 기준 "YYYY.MM.DD" — createdAt 등 시각 포함 값용 (QA D-3: UTC slice 금지) */
const vnDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
function dotDateVn(iso: string): string {
  return vnDateFmt.format(new Date(iso)).replaceAll("-", ".");
}

/** ISO 날짜 → "MM.DD" */
function shortDate(iso: string): string {
  return iso.slice(5, 10).replace("-", ".");
}

/** 항목들의 숙박 범위 — "2026.07.15 ~ 07.18" (b12 표기) */
function stayRangeLabel(items: ProposalItemRow[]): string {
  if (items.length === 0) return "-";
  const checkIn = items.reduce((min, i) => (i.checkIn < min ? i.checkIn : min), items[0].checkIn);
  const checkOut = items.reduce((max, i) => (i.checkOut > max ? i.checkOut : max), items[0].checkOut);
  return `${dotDate(checkIn)} ~ ${shortDate(checkOut)}`;
}

/** 행 금액 — 채널 통화로 합산 표기 (VND=BigInt 문자열 합, KRW=정수 합) */
function amountLabel(p: ProposalRow): string {
  if (p.saleCurrency === "VND") {
    const total = p.items.reduce((sum, i) => sum + BigInt(i.totalVnd ?? "0"), 0n);
    return formatVnd(total);
  }
  const total = p.items.reduce((sum, i) => sum + (i.totalKrw ?? 0), 0);
  return `${formatThousands(total)}원`;
}

export default function ProposalsList() {
  const t = useTranslations("adminProposals.list");
  const searchParams = useSearchParams();
  const range = searchParams.get("range") ?? undefined;
  const [proposals, setProposals] = useState<ProposalRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");
  // 검색어 — 고객/여행사명 + 포함 빌라명 대상 (in-memory 즉시 필터).
  const [query, setQuery] = useState("");
  // 채널 필터 — "ALL"=전체. 상태=탭, 검색=텍스트가 담당하고 채널은 별도 드롭다운.
  const [channel, setChannel] = useState<Channel | "ALL">("ALL");
  // 날짜 범위 — 기준(숙박 기간/생성일) 단일 선택 + 단일 from~to. "YYYY-MM-DD" 또는 "".
  const [dateMode, setDateMode] = useState<"stay" | "created">("stay");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // 분 단위 카운트다운 틱 (계약: 분 단위 갱신이면 충분)
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/proposals");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { proposals: ProposalRow[] };
      setProposals(data.proposals);
    } catch {
      setLoadError(true);
      setProposals([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // 빠른 날짜 필터 — createdAt(제안 생성 시각) 기준. URL ?range=가 진실원천.
  // quickRangeWhere(timestamp)는 VN 자정 경계의 실제 UTC {gte, lt} 반환 (inspections RSC와 동일 규칙)
  const dateScoped = useMemo(() => {
    const rows = proposals ?? [];
    const where = quickRangeWhere(range, "timestamp");
    if (!where) return rows;
    return rows.filter((p) => {
      const created = new Date(p.createdAt).getTime();
      return created >= where.gte.getTime() && created < where.lt.getTime();
    });
  }, [proposals, range]);

  // 통합 필터 — 채널 + 생성일 커스텀 범위 + 숙박 기간 범위 + 텍스트 검색을 dateScoped(빠른 프리셋) 위에 AND 결합.
  // 탭 카운트 이전에 적용 → 탭 배지 숫자도 모든 필터 결과를 반영.
  const searchScoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dateScoped.filter((p) => {
      // 채널
      if (channel !== "ALL" && p.channel !== channel) return false;
      // 날짜 범위 — 기준(생성일/숙박 기간)에 따라 한 가지만 적용
      if (dateFrom || dateTo) {
        if (dateMode === "created") {
          const created = vnDateFmt.format(new Date(p.createdAt)); // "YYYY-MM-DD"
          if (dateFrom && created < dateFrom) return false;
          if (dateTo && created > dateTo) return false;
        } else {
          // 숙박 기간 — 항목 중 하나라도 [dateFrom, dateTo]와 겹치면 통과
          const overlaps = p.items.some((i) => {
            const ci = i.checkIn.slice(0, 10);
            const co = i.checkOut.slice(0, 10);
            if (dateFrom && co <= dateFrom) return false; // 체크아웃이 범위 시작 이전 → 겹침 없음
            if (dateTo && ci > dateTo) return false; // 체크인이 범위 종료 이후 → 겹침 없음
            return true;
          });
          if (!overlaps) return false;
        }
      }
      // 텍스트 검색 (고객/여행사명 또는 포함 빌라명 부분일치)
      if (q) {
        const hit =
          p.clientName.toLowerCase().includes(q) ||
          p.items.some((i) => i.villa.name.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [dateScoped, query, channel, dateMode, dateFrom, dateTo]);

  const counts = useMemo(() => {
    const byStatus = (s: ProposalStatus) =>
      searchScoped.filter((p) => p.effectiveStatus === s).length;
    return {
      all: searchScoped.length,
      active: byStatus("ACTIVE"),
      used: byStatus("USED"),
      expired: byStatus("EXPIRED"),
      revoked: byStatus("REVOKED"),
    } satisfies Record<TabKey, number>;
  }, [searchScoped]);

  const filtered = useMemo(() => {
    if (tab === "all") return searchScoped;
    return searchScoped.filter((p) => p.effectiveStatus === TAB_STATUS[tab]);
  }, [searchScoped, tab]);

  // 클라 페이지네이션 — 탭/날짜 필터 바뀌면 1페이지로. (전체 로드 후 메모리 슬라이스)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => setPage(1), [tab, range, query, channel, dateMode, dateFrom, dateTo]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize]
  );

  /** 공개 링크 클립보드 복사 + "복사됨" 피드백 */
  const copyLink = async (p: ProposalRow) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${p.token}`);
      setCopiedId(p.id);
      setTimeout(() => setCopiedId((cur) => (cur === p.id ? null : cur)), 2000);
    } catch {
      setMessage({ tone: "error", text: t("copyError") });
    }
  };

  /** 회수 — PATCH {action:"revoke"} → 성공 시 재조회 */
  const revoke = async (p: ProposalRow) => {
    if (!window.confirm(t("revokeConfirm"))) return;
    setBusyId(p.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/proposals/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      if (!res.ok) {
        setMessage({ tone: "error", text: t("revokeError") });
        // 409(이미 만료/사용됨 등)면 목록이 낡은 것 — 최신 상태로 재조회
        if (res.status === 409) void load();
        return;
      }
      setMessage({ tone: "ok", text: t("revoked") });
      void load();
    } catch {
      setMessage({ tone: "error", text: t("revokeError") });
    } finally {
      setBusyId(null);
    }
  };

  /** 만료까지 셀 — ACTIVE는 주황 카운트다운, EXPIRED는 "만료됨", 그 외 "-" */
  const expiryCell = (p: ProposalRow) => {
    if (p.effectiveStatus === "ACTIVE") {
      const remainMs = new Date(p.expiresAt).getTime() - nowMs;
      // 서버 effectiveStatus 스냅샷 이후 만료 시각이 지난 경우 — 재조회 전까지 "만료됨" 표기 (QA D-2)
      if (remainMs <= 0) {
        return <span className="text-[11px] text-slate-600 font-medium">{t("countdown.expired")}</span>;
      }
      const hours = Math.floor(remainMs / 3_600_000);
      const minutes = Math.max(1, Math.floor(remainMs / 60_000));
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-500/10 text-orange-400 text-[10px] font-bold rounded tabular-nums">
          <span className="material-symbols-outlined text-[12px]">schedule</span>
          {hours >= 1 ? t("countdown.hours", { hours }) : t("countdown.minutes", { minutes })}
        </span>
      );
    }
    if (p.effectiveStatus === "EXPIRED") {
      return <span className="text-[11px] text-slate-600 font-medium">{t("countdown.expired")}</span>;
    }
    return <span className="text-[11px] text-slate-600 font-medium">-</span>;
  };

  /** 관리 셀 — 활성: 링크 복사 + 회수 / 그 외: 링크 복사만 */
  const actionsCell = (p: ProposalRow) => (
    <div className="flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={() => void copyLink(p)}
        title={t("copyLink")}
        aria-label={t("copyLink")}
        className="flex items-center gap-1 p-1.5 text-admin-muted hover:text-white hover:bg-slate-700 rounded transition-all"
      >
        <span className="material-symbols-outlined text-[18px]">
          {copiedId === p.id ? "check" : "content_copy"}
        </span>
        {copiedId === p.id && (
          <span className="text-[10px] font-bold text-emerald-400">{t("copied")}</span>
        )}
      </button>
      {p.effectiveStatus === "ACTIVE" && (
        <button
          type="button"
          disabled={busyId === p.id}
          onClick={() => void revoke(p)}
          className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
        >
          {t("revoke")}
        </button>
      )}
    </div>
  );

  const statusBadge = (p: ProposalRow) => (
    <span
      className={`px-2 py-0.5 text-[10px] font-bold rounded ${STATUS_BADGE_CLASS[p.effectiveStatus]}`}
    >
      {t(`status.${p.effectiveStatus}`)}
    </span>
  );

  const columns: ResponsiveColumn<ProposalRow>[] = [
    {
      key: "client",
      header: t("columns.client"),
      cell: (p) => (
        <span className="font-medium text-white text-sm whitespace-nowrap">{p.clientName}</span>
      ),
      hideOnCard: true, // 모바일 카드는 cardHeader로 표시
    },
    {
      key: "villas",
      header: t("columns.villas"),
      cell: (p) => (
        <div className="flex flex-wrap gap-1.5 justify-end md:justify-start">
          {p.items.map((item) => (
            <span
              key={item.id}
              className="px-2 py-0.5 bg-slate-800 text-admin-muted text-[10px] rounded border border-slate-700"
            >
              {item.villa.name}
            </span>
          ))}
        </div>
      ),
      hideOnCard: true, // 모바일은 cardSummary로 표시
    },
    {
      key: "dates",
      header: t("columns.dates"),
      cell: (p) => (
        <span
          className={`text-sm tabular-nums ${
            p.effectiveStatus === "EXPIRED" ? "text-slate-500 line-through" : "text-slate-300"
          }`}
        >
          {stayRangeLabel(p.items)}
        </span>
      ),
      hideOnCard: true, // 모바일은 cardSummary로 표시
    },
    {
      key: "channel",
      header: t("columns.channel"),
      cell: (p) => (
        <span
          className={`px-2 py-0.5 text-[10px] font-bold rounded ${CHANNEL_BADGE_CLASS[p.channel]}`}
        >
          {t(`channels.${p.channel}`)}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: t("columns.createdAt"),
      cell: (p) => (
        <span className="text-sm text-slate-500 tabular-nums">{dotDateVn(p.createdAt)}</span>
      ),
    },
    {
      key: "expiry",
      header: t("columns.expiry"),
      cell: expiryCell,
    },
    {
      key: "amount",
      header: t("columns.amount"),
      headerClassName: "text-right",
      className: "text-right",
      cell: (p) => (
        <span
          className={`text-sm tabular-nums ${
            p.effectiveStatus === "EXPIRED" ? "text-slate-500" : "text-slate-300"
          }`}
        >
          {amountLabel(p)}
        </span>
      ),
      hideOnCard: true, // 모바일은 cardSummary로 표시
    },
    {
      key: "status",
      header: t("columns.status"),
      cell: statusBadge,
      hideOnCard: true, // 모바일은 cardSummary로 표시
    },
    {
      key: "actions",
      header: t("columns.actions"),
      headerClassName: "text-right",
      cell: actionsCell,
    },
  ];

  return (
    <div>
      {/* 페이지 헤더 + "+ 제안 만들기" (b12) */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <h1 className="text-2xl font-bold text-white">{t("title")}</h1>
        <Link
          href="/proposals/new"
          // 코치마크 앵커 — 즉시 렌더(목록 행은 클라 fetch 비동기라 앵커 금지, vendorBoard 교훈)
          data-tour="proposal-create"
          className="flex items-center gap-2 px-4 py-2 bg-admin-primary text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-900/20 hover:bg-admin-primary-dark transition-all whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          {t("create")}
        </Link>
      </div>

      {/* 필터 — 1행: 검색 + 채널 + 생성일 빠른 프리셋 / 2행: 숙박 기간·생성일 커스텀 범위 */}
      <div data-tour="proposal-filters" className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* 텍스트 검색 — 고객/여행사명·빌라명 */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
              search
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full sm:w-72 bg-admin-card border border-admin-border text-sm text-slate-300 rounded-lg pl-9 pr-9 py-2 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                title={t("searchClear")}
                aria-label={t("searchClear")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            )}
          </div>
          {/* 채널 드롭다운 */}
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel | "ALL")}
            aria-label={t("channelFilterLabel")}
            className="bg-admin-card border border-admin-border text-sm text-slate-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary transition-all"
          >
            <option value="ALL">{t("channelFilterAll")}</option>
            <option value="TRAVEL_AGENCY">{t("channels.TRAVEL_AGENCY")}</option>
            <option value="LAND_AGENCY">{t("channels.LAND_AGENCY")}</option>
            <option value="DIRECT">{t("channels.DIRECT")}</option>
          </select>
        </div>
        {/* 날짜 범위 — 숙박 기간(체크인~체크아웃 겹침) + 생성일 커스텀 */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            {/* 날짜 기준 — 숙박 기간 / 생성일 단일 선택 */}
            <select
              value={dateMode}
              onChange={(e) => setDateMode(e.target.value as "stay" | "created")}
              aria-label={t("dateBasisLabel")}
              className="bg-admin-card border border-admin-border text-xs font-semibold text-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary"
            >
              <option value="stay">{t("stayRangeLabel")}</option>
              <option value="created">{t("createdRangeLabel")}</option>
            </select>
            <DateField
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label={`${t(dateMode === "stay" ? "stayRangeLabel" : "createdRangeLabel")} ${t("dateFrom")}`}
              placeholder={t("datePlaceholder")}
              wrapperClassName=""
              className="bg-admin-card border border-admin-border text-sm text-slate-300 rounded-lg px-2.5 py-1.5 [color-scheme:dark] focus:ring-1 focus:ring-admin-primary focus:border-admin-primary"
            />
            <span className="text-admin-muted text-xs">~</span>
            <DateField
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label={`${t(dateMode === "stay" ? "stayRangeLabel" : "createdRangeLabel")} ${t("dateTo")}`}
              placeholder={t("datePlaceholder")}
              wrapperClassName=""
              className="bg-admin-card border border-admin-border text-sm text-slate-300 rounded-lg px-2.5 py-1.5 [color-scheme:dark] focus:ring-1 focus:ring-admin-primary focus:border-admin-primary"
            />
          </div>
          {(dateFrom || dateTo || channel !== "ALL" || query) && (
            <button
              type="button"
              onClick={() => {
                setDateMode("stay");
                setDateFrom("");
                setDateTo("");
                setChannel("ALL");
                setQuery("");
              }}
              className="flex items-center gap-1 text-xs font-semibold text-admin-muted hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined text-sm">filter_alt_off</span>
              {t("clearFilters")}
            </button>
          )}
        </div>
        {/* 빠른 날짜 프리셋 — 생성일(createdAt) 기준, 날짜 범위 행 아래 배치 */}
        <QuickDateFilter
          presets={[
            "all",
            "today",
            "yesterday",
            "thisWeek",
            "lastWeek",
            "thisMonth",
            "lastMonth",
          ]}
        />
      </div>

      {/* 상태 탭 — effectiveStatus 기준 카운트 (b12) */}
      <div
        data-tour="proposal-tabs"
        className="flex items-center gap-6 border-b border-admin-card mb-6 overflow-x-auto"
      >
        {TABS.map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                active
                  ? "pb-3 border-b-2 border-admin-primary text-admin-primary text-sm font-semibold flex items-center gap-2"
                  : "pb-3 border-b-2 border-transparent text-admin-muted hover:text-white transition-colors text-sm font-medium flex items-center gap-2"
              }
            >
              {t(`tabs.${key}`)}
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  active ? "bg-admin-primary/10 text-admin-primary" : "bg-slate-800 text-admin-muted"
                }`}
              >
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* 결과 메시지 (회수 성공/실패) */}
      {message && (
        <p
          role="status"
          className={`mb-4 text-xs font-medium ${
            message.tone === "ok" ? "text-emerald-500" : "text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* 목록 — 로딩/에러/테이블 */}
      {proposals === null ? (
        <div className="bg-admin-card rounded-xl border border-slate-800 p-12 flex flex-col items-center gap-3 text-sm text-admin-muted">
          <span
            className="w-6 h-6 border-2 border-slate-600 border-t-admin-primary rounded-full animate-spin"
            aria-hidden
          />
          {t("loading")}
        </div>
      ) : loadError ? (
        <div className="bg-admin-card rounded-xl border border-slate-800 p-12 flex flex-col items-center gap-4 text-sm text-admin-muted">
          {t("loadError")}
          <button
            type="button"
            onClick={() => {
              setProposals(null);
              void load();
            }}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg transition-colors"
          >
            {t("retry")}
          </button>
        </div>
      ) : (
        <>
        <ResponsiveTable
          columns={columns}
          rows={paged}
          rowKey={(p) => p.id}
          emptyMessage={
            query.trim()
              ? t("searchEmpty", { query: query.trim() })
              : channel !== "ALL" || dateFrom || dateTo
                ? t("filterEmpty")
                : t("empty")
          }
          rowClassName={(p) => (p.effectiveStatus === "EXPIRED" ? "opacity-60" : undefined)}
          cardSummary={(p) => (
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-white text-sm truncate">{p.clientName}</span>
                {statusBadge(p)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.items.map((item) => (
                  <span
                    key={item.id}
                    className="px-2 py-0.5 bg-slate-800 text-admin-muted text-[10px] rounded border border-slate-700"
                  >
                    {item.villa.name}
                  </span>
                ))}
              </div>
              <span
                className={`text-xs tabular-nums ${
                  p.effectiveStatus === "EXPIRED" ? "text-slate-500 line-through" : "text-slate-300"
                }`}
              >
                {stayRangeLabel(p.items)}
                {amountLabel(p) ? ` · ${amountLabel(p)}` : ""}
              </span>
            </div>
          )}
        />
        <PaginationBar
          total={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
        </>
      )}
    </div>
  );
}
