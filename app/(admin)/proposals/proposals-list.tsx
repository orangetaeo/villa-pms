"use client";

// 제안 목록 (T2.1 — Stitch b12-proposals-list 변환)
// - 상태 탭은 서버가 준 effectiveStatus 기준 (클라 재계산 금지 — lib/proposal 단일 소스)
// - 카운트다운은 분 단위 갱신 ("23시간 남음" / "45분 남음", 주황 배지)
// - 금액 열은 행별 채널 통화 혼재 표기 (VND 쉼표 ₫ / KRW 쉼표 원) — 우측 정렬·tabular-nums
// - <768px 카드 전환은 ResponsiveTable 재사용 (T6.7 — 수정 금지 컴포넌트)
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import ResponsiveTable, { type ResponsiveColumn } from "@/components/admin/responsive-table";
import { formatThousands, formatVnd } from "@/lib/format";

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
  const [proposals, setProposals] = useState<ProposalRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");
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

  const counts = useMemo(() => {
    const rows = proposals ?? [];
    const byStatus = (s: ProposalStatus) =>
      rows.filter((p) => p.effectiveStatus === s).length;
    return {
      all: rows.length,
      active: byStatus("ACTIVE"),
      used: byStatus("USED"),
      expired: byStatus("EXPIRED"),
      revoked: byStatus("REVOKED"),
    } satisfies Record<TabKey, number>;
  }, [proposals]);

  const filtered = useMemo(() => {
    const rows = proposals ?? [];
    if (tab === "all") return rows;
    return rows.filter((p) => p.effectiveStatus === TAB_STATUS[tab]);
  }, [proposals, tab]);

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
    },
    {
      key: "status",
      header: t("columns.status"),
      cell: statusBadge,
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
          className="flex items-center gap-2 px-4 py-2 bg-admin-primary text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-900/20 hover:bg-admin-primary-dark transition-all whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          {t("create")}
        </Link>
      </div>

      {/* 상태 탭 — effectiveStatus 기준 카운트 (b12) */}
      <div className="flex items-center gap-6 border-b border-admin-card mb-6 overflow-x-auto">
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
        <ResponsiveTable
          columns={columns}
          rows={filtered}
          rowKey={(p) => p.id}
          emptyMessage={t("empty")}
          rowClassName={(p) => (p.effectiveStatus === "EXPIRED" ? "opacity-60" : undefined)}
          cardHeader={(p) => (
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 gap-2">
              <span className="font-bold text-white text-sm truncate">{p.clientName}</span>
              {statusBadge(p)}
            </div>
          )}
        />
      )}
    </div>
  );
}
