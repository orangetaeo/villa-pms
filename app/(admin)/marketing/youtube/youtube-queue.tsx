"use client";

// 유튜브 쇼츠 큐(클라이언트) — GET /api/youtube/shorts 소비, 카드 렌더 + 일괄 승인 + 페이지네이션.
//   status/page 는 RSC(searchParams)에서 prop 으로 주입 → 변경 시 재조회(useEffect).
//   목록은 서버 페이지네이션 10 그대로 사용(클라 slice 금지). 액션 성공/409 시 재조회.
//   oauth: OAuth 리다이렉트 복귀 시 ?connected=1 / ?error=코드 → 토스트 1회.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import PaginationBar from "@/components/pagination-bar";
import type { SerializedYtShort } from "@/lib/youtube/serialize";
import YoutubeShortCard from "./youtube-short-card";

type Toast = { msg: string; kind: "ok" | "err" };

export default function YoutubeQueue({
  status,
  page,
  oauth,
}: {
  status: string | null;
  page: number;
  oauth: { kind: "ok" | "err"; code?: string } | null;
}) {
  const t = useTranslations("adminYoutube");
  const [shorts, setShorts] = useState<SerializedYtShort[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const notify = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // OAuth 복귀 토스트 — 최초 1회만.
  const oauthShown = useRef(false);
  useEffect(() => {
    if (!oauth || oauthShown.current) return;
    oauthShown.current = true;
    if (oauth.kind === "ok") notify(t("oauth.connected"), "ok");
    else notify(t("oauth.error", { code: oauth.code ?? "" }), "err");
  }, [oauth, notify, t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      qs.set("page", String(page));
      const res = await fetch(`/api/youtube/shorts?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as {
        shorts: SerializedYtShort[];
        pageSize: number;
        total: number;
      };
      setShorts(data.shorts);
      setTotal(data.total);
      setPageSize(data.pageSize ?? 10);
    } catch {
      notify(t("toast.loadError"), "err");
    } finally {
      setLoading(false);
    }
  }, [status, page, notify, t]);

  useEffect(() => {
    load();
  }, [load]);

  // 409(상태 변경) — 안내 후 재조회
  const onConflict = useCallback(() => {
    notify(t("toast.stateChanged"), "err");
    load();
  }, [notify, t, load]);

  const pendingShorts = shorts.filter((s) => s.status === "PENDING_APPROVAL");

  const bulkApprove = async () => {
    if (!pendingShorts.length || bulk) return;
    if (!window.confirm(t("bulk.confirm", { n: pendingShorts.length }))) return;
    let ok = 0;
    let fail = 0;
    setBulk({ done: 0, total: pendingShorts.length });
    for (let i = 0; i < pendingShorts.length; i++) {
      try {
        const res = await fetch(`/api/youtube/shorts/${pendingShorts[i].id}/approve`, {
          method: "POST",
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
      setBulk({ done: i + 1, total: pendingShorts.length });
    }
    setBulk(null);
    notify(fail ? t("bulk.result", { ok, fail }) : t("bulk.resultOk", { ok }), fail ? "err" : "ok");
    await load();
  };

  return (
    <div className="space-y-4">
      {/* 일괄 승인 — 승인 대기 탭에서만 노출 */}
      {status === "PENDING_APPROVAL" && pendingShorts.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={bulkApprove}
            disabled={!!bulk}
            className="inline-flex items-center gap-2 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">done_all</span>
            {bulk
              ? t("bulk.approving", { done: bulk.done, total: bulk.total })
              : t("bulk.approveAll", { n: pendingShorts.length })}
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-64 animate-pulse rounded-xl border border-slate-800/50 bg-admin-card"
            />
          ))}
        </div>
      ) : shorts.length === 0 ? (
        <div className="rounded-xl border border-slate-800/50 bg-admin-card px-6 py-16 text-center text-sm text-slate-500">
          {t("empty")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {shorts.map((s) => (
            <YoutubeShortCard
              key={s.id}
              short={s}
              onChanged={load}
              onConflict={onConflict}
              notify={notify}
            />
          ))}
        </div>
      )}

      <PaginationBar total={total} page={page} pageSize={pageSize} />

      {/* 토스트 */}
      {toast && (
        <div
          role="status"
          className={
            "fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-lg " +
            (toast.kind === "ok" ? "bg-admin-primary text-white" : "bg-red-600 text-white")
          }
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
