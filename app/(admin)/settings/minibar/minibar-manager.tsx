"use client";

// 미니바 회사표준 품목 CRUD 매니저 (#2b) — 인라인 추가·수정·삭제·표시 토글.
//   /api/admin/minibar (POST) + /api/admin/minibar/[id] (PATCH·DELETE). 저장 후 router.refresh().
//   단가 = 우리 판매가(VND). 빌라별 아님 — 전 빌라 공통 1세트.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatThousands } from "@/lib/format";

export interface MinibarRow {
  id: string;
  nameKo: string;
  nameVi: string;
  unitPriceVnd: string; // VND 동 단위 문자열
  sortOrder: number;
  active: boolean;
}

interface Draft {
  nameKo: string;
  nameVi: string;
  unitPriceVnd: string;
}

const EMPTY_DRAFT: Draft = { nameKo: "", nameVi: "", unitPriceVnd: "" };

export default function MinibarManager({ initialItems }: { initialItems: MinibarRow[] }) {
  const t = useTranslations("adminMinibar");
  const router = useRouter();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const draftValid = (d: Draft) => d.nameKo.trim().length > 0 && /^\d{1,15}$/.test(d.unitPriceVnd);

  const refresh = () => router.refresh();
  const fail = () => setMessage({ ok: false, text: t("error") });

  async function handleAdd() {
    if (!draftValid(addDraft)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/minibar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameKo: addDraft.nameKo.trim(),
          nameVi: addDraft.nameVi.trim() || undefined,
          unitPriceVnd: addDraft.unitPriceVnd,
          sortOrder: initialItems.length,
        }),
      });
      if (!res.ok) throw new Error();
      setAddDraft(EMPTY_DRAFT);
      setMessage({ ok: true, text: t("saved") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(id: string) {
    if (!draftValid(draft)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/minibar/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameKo: draft.nameKo.trim(),
          nameVi: draft.nameVi.trim() || null,
          unitPriceVnd: draft.unitPriceVnd,
        }),
      });
      if (!res.ok) throw new Error();
      setEditingId(null);
      setMessage({ ok: true, text: t("saved") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(item: MinibarRow) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/minibar/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active }),
      });
      if (!res.ok) throw new Error();
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t("deleteConfirm"))) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/minibar/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setMessage({ ok: true, text: t("deleted") });
      refresh();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: MinibarRow) {
    setEditingId(item.id);
    setDraft({ nameKo: item.nameKo, nameVi: item.nameVi, unitPriceVnd: item.unitPriceVnd });
    setMessage(null);
  }

  return (
    <section className="bg-admin-card rounded-xl border border-slate-800 shadow-lg flex flex-col">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">liquor</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("listTitle")}
          </h2>
        </div>
        {message && (
          <span
            role="status"
            className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}
          >
            {message.text}
          </span>
        )}
      </div>

      <div className="p-4 md:p-6 space-y-3">
        {initialItems.length === 0 && (
          <p className="text-sm text-slate-500 py-6 text-center">{t("empty")}</p>
        )}

        {initialItems.map((item) =>
          editingId === item.id ? (
            <EditRow
              key={item.id}
              draft={draft}
              setDraft={setDraft}
              valid={draftValid(draft)}
              busy={busy}
              onSave={() => handleSaveEdit(item.id)}
              onCancel={() => setEditingId(null)}
              t={t}
            />
          ) : (
            <div
              key={item.id}
              className={`flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3.5 ${
                item.active ? "" : "opacity-50"
              }`}
            >
              <span className="material-symbols-outlined text-slate-500 text-lg">liquor</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-100 truncate">
                  {item.nameKo}
                  {item.nameVi && <span className="ml-2 text-xs text-slate-500">{item.nameVi}</span>}
                </p>
                <p className="text-xs text-admin-primary font-semibold tabular-nums">
                  {formatThousands(item.unitPriceVnd)}₫
                </p>
              </div>
              {/* 표시 토글 */}
              <button
                type="button"
                role="switch"
                aria-checked={item.active}
                aria-label={t("activeLabel")}
                disabled={busy}
                onClick={() => handleToggle(item)}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                  item.active ? "bg-admin-primary" : "bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    item.active ? "translate-x-5" : ""
                  }`}
                />
              </button>
              <button
                type="button"
                onClick={() => startEdit(item)}
                aria-label={t("edit")}
                disabled={busy}
                className="text-slate-500 hover:text-admin-primary transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-lg">edit</span>
              </button>
              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                aria-label={t("delete")}
                disabled={busy}
                className="text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-lg">delete</span>
              </button>
            </div>
          )
        )}

        {/* 새 품목 추가 */}
        <div className="rounded-lg border-2 border-dashed border-slate-700 p-3.5 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">{t("addTitle")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={addDraft.nameKo}
              onChange={(e) => setAddDraft((d) => ({ ...d, nameKo: e.target.value }))}
              placeholder={t("nameKoPlaceholder")}
              aria-label={t("nameKoLabel")}
              maxLength={60}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-admin-primary focus:outline-none"
            />
            <input
              type="text"
              value={addDraft.nameVi}
              onChange={(e) => setAddDraft((d) => ({ ...d, nameVi: e.target.value }))}
              placeholder={t("nameViPlaceholder")}
              aria-label={t("nameViLabel")}
              maxLength={60}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-admin-primary focus:outline-none"
            />
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={addDraft.unitPriceVnd ? formatThousands(addDraft.unitPriceVnd) : ""}
                onChange={(e) =>
                  setAddDraft((d) => ({ ...d, unitPriceVnd: e.target.value.replace(/\D/g, "") }))
                }
                placeholder={t("pricePlaceholder")}
                aria-label={t("priceLabel")}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-admin-primary font-semibold tabular-nums focus:border-admin-primary focus:outline-none"
              />
              <span className="text-sm text-admin-primary font-semibold">₫</span>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleAdd}
              disabled={busy || !draftValid(addDraft)}
              className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-bold text-sm flex items-center gap-1.5 whitespace-nowrap transition-all"
            >
              <span className="material-symbols-outlined text-base">add</span>
              {t("addButton")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 인라인 수정 행 — 이름(ko/vi)·단가 편집 + 저장·취소. */
function EditRow({
  draft,
  setDraft,
  valid,
  busy,
  onSave,
  onCancel,
  t,
}: {
  draft: Draft;
  setDraft: (updater: (d: Draft) => Draft) => void;
  valid: boolean;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="rounded-lg border border-admin-primary/40 bg-blue-600/[0.06] p-3.5 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="text"
          value={draft.nameKo}
          onChange={(e) => setDraft((d) => ({ ...d, nameKo: e.target.value }))}
          placeholder={t("nameKoPlaceholder")}
          aria-label={t("nameKoLabel")}
          maxLength={60}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-admin-primary focus:outline-none"
        />
        <input
          type="text"
          value={draft.nameVi}
          onChange={(e) => setDraft((d) => ({ ...d, nameVi: e.target.value }))}
          placeholder={t("nameViPlaceholder")}
          aria-label={t("nameViLabel")}
          maxLength={60}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-admin-primary focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="numeric"
            value={draft.unitPriceVnd ? formatThousands(draft.unitPriceVnd) : ""}
            onChange={(e) =>
              setDraft((d) => ({ ...d, unitPriceVnd: e.target.value.replace(/\D/g, "") }))
            }
            placeholder={t("pricePlaceholder")}
            aria-label={t("priceLabel")}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-admin-primary font-semibold tabular-nums focus:border-admin-primary focus:outline-none"
          />
          <span className="text-sm text-admin-primary font-semibold">₫</span>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white disabled:opacity-50 whitespace-nowrap"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !valid}
          className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-bold text-sm flex items-center gap-1.5 whitespace-nowrap transition-all"
        >
          <span className="material-symbols-outlined text-base">save</span>
          {t("save")}
        </button>
      </div>
    </div>
  );
}
