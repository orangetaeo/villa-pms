"use client";

// 인스타그램 콘텐츠 큐(클라이언트) — GET /api/instagram/posts 소비, 리스트 렌더 + 일괄 승인 + 페이지네이션.
//   ★ 목록은 접힘 리스트(행당 요약 1줄). 펼침 상태(openIds)는 큐가 소유 → "전체 펼치기/접기" 지원.
//     재조회·페이지 이동 시 사라진 id는 정리(스테일 방지).
//   status/page 는 RSC(searchParams)에서 prop 으로 주입 → 변경 시 재조회(useEffect).
//   목록은 서버 페이지네이션 10 그대로 사용(클라 slice 금지). 액션 성공/409 시 재조회.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import PaginationBar from "@/components/pagination-bar";
import type { SerializedIgPost } from "@/lib/instagram/serialize";
import { canDeleteMarketingStatus } from "@/lib/marketing/deletable";
import InstagramPostCard from "./instagram-post-card";

type Toast = { msg: string; kind: "ok" | "err" };

export default function InstagramQueue({
  status,
  page,
}: {
  status: string | null;
  page: number;
}) {
  const t = useTranslations("adminInstagram");
  const [posts, setPosts] = useState<SerializedIgPost[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [openIds, setOpenIds] = useState<string[]>([]);
  // 하드 삭제 선택(체크박스) — 발행 중·발행 완료는 애초에 선택되지 않는다.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const toastTimer = useRef<number | null>(null);

  const toggleOpen = useCallback((id: string) => {
    setOpenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const notify = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      qs.set("page", String(page));
      const res = await fetch(`/api/instagram/posts?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as {
        posts: SerializedIgPost[];
        pageSize: number;
        total: number;
      };
      setPosts(data.posts);
      setTotal(data.total);
      setPageSize(data.pageSize ?? 10);
      // 목록에서 사라진 항목의 펼침·선택 상태 정리(스테일 선택으로 엉뚱한 항목이 지워지는 것 방지)
      const ids = new Set(data.posts.map((p) => p.id));
      setOpenIds((prev) => prev.filter((id) => ids.has(id)));
      setSelectedIds((prev) => prev.filter((id) => ids.has(id)));
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

  const pendingPosts = posts.filter((p) => p.status === "PENDING_APPROVAL");

  const bulkApprove = async () => {
    if (!pendingPosts.length || bulk) return;
    if (!window.confirm(t("bulk.confirm", { n: pendingPosts.length }))) return;
    let ok = 0;
    let fail = 0;
    setBulk({ done: 0, total: pendingPosts.length });
    for (let i = 0; i < pendingPosts.length; i++) {
      try {
        const res = await fetch(`/api/instagram/posts/${pendingPosts[i].id}/approve`, {
          method: "POST",
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
      setBulk({ done: i + 1, total: pendingPosts.length });
    }
    setBulk(null);
    notify(fail ? t("bulk.result", { ok, fail }) : t("bulk.resultOk", { ok }), fail ? "err" : "ok");
    await load();
  };

  const allOpen = posts.length > 0 && openIds.length === posts.length;

  // ── 하드 삭제(체크박스) ──
  const deletablePosts = posts.filter((p) => canDeleteMarketingStatus(p.status));
  const allSelected = deletablePosts.length > 0 && selectedIds.length === deletablePosts.length;

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };

  const deleteSelected = async () => {
    if (!selectedIds.length || deleting) return;
    if (!window.confirm(t("delete.confirm", { n: selectedIds.length }))) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/instagram/posts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (!res.ok) {
        notify(t("toast.error"), "err");
        return;
      }
      const data = (await res.json()) as { deleted: number; blocked: { id: string }[] };
      setSelectedIds([]);
      notify(
        data.blocked.length > 0
          ? t("delete.resultBlocked", { n: data.deleted, blocked: data.blocked.length })
          : t("delete.result", { n: data.deleted }),
        data.blocked.length > 0 ? "err" : "ok"
      );
      await load();
    } catch {
      notify(t("toast.error"), "err");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 툴바 — 전체 펼치기/접기 + (승인 대기 탭) 일괄 승인 */}
      {posts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOpenIds(allOpen ? [] : posts.map((p) => p.id))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-800"
            >
              <span className="material-symbols-outlined text-[16px]">
                {allOpen ? "unfold_less" : "unfold_more"}
              </span>
              {allOpen ? t("list.collapseAll") : t("list.expandAll")}
            </button>

            {/* 삭제 대상 전체 선택 — 발행 중·발행 완료는 제외하고 센다 */}
            {deletablePosts.length > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 transition-colors hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelectedIds(allSelected ? [] : deletablePosts.map((p) => p.id))}
                  className="h-4 w-4 accent-red-500"
                />
                {t("select.all", { n: deletablePosts.length })}
              </label>
            )}

            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={deleteSelected}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-red-500 active:scale-[0.98] disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                {deleting ? t("delete.deleting") : t("delete.button", { n: selectedIds.length })}
              </button>
            )}
          </div>

          {status === "PENDING_APPROVAL" && pendingPosts.length > 0 && (
            <button
              type="button"
              onClick={bulkApprove}
              disabled={!!bulk}
              className="inline-flex items-center gap-2 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">done_all</span>
              {bulk
                ? t("bulk.approving", { done: bulk.done, total: bulk.total })
                : t("bulk.approveAll", { n: pendingPosts.length })}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[76px] animate-pulse rounded-xl border border-slate-800/50 bg-admin-card"
            />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-slate-800/50 bg-admin-card px-6 py-16 text-center text-sm text-slate-500">
          {t("empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {posts.map((p) => (
            <InstagramPostCard
              key={p.id}
              post={p}
              open={openIds.includes(p.id)}
              onToggle={() => toggleOpen(p.id)}
              onChanged={load}
              onConflict={onConflict}
              notify={notify}
              selected={selectedIds.includes(p.id)}
              onSelect={(checked) => toggleSelect(p.id, checked)}
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
            (toast.kind === "ok"
              ? "bg-admin-primary text-white"
              : "bg-red-600 text-white")
          }
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
