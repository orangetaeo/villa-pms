"use client";

// 운영자 Zalo 알림 그룹방 설정 (ADR-0039) — 운영자 업무 알림을 그룹방 1건으로 모아 받기.
// 그룹 선택·저장 시 그룹 라우팅 활성, 해제(미설정) 시 운영자 개별 DM 발송으로 복귀.
// 그룹 목록 = 시스템봇 소유자(테오)의 GROUP 대화. 시스템봇 미연결이면 목록이 비어 안내 표시.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

export type ZaloNotifyGroupOption = { id: string; name: string | null };

export type ZaloNotifyGroupInitial = {
  selectedGroupId: string | null;
  groups: ZaloNotifyGroupOption[];
  botConnected: boolean;
};

export default function ZaloNotifyGroupForm({ initial }: { initial: ZaloNotifyGroupInitial }) {
  const t = useTranslations("adminSettings.zaloNotifyGroupCard");
  const router = useRouter();
  const [selected, setSelected] = useState<string>(initial.selectedGroupId ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = (initial.selectedGroupId ?? "") !== selected;
  // 저장된 그룹 id가 현재 목록에 없으면(대화 사라짐 등) 안내 — 값은 유지하되 경고.
  const selectedMissing =
    !!initial.selectedGroupId && !initial.groups.some((g) => g.id === initial.selectedGroupId);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/zalo-notify-group", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupThreadId: selected === "" ? null : selected }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("error") });
    } finally {
      setSaving(false);
    }
  };

  const selectClass =
    "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary disabled:opacity-50";

  return (
    <section className="bg-admin-card rounded-xl border border-slate-800 shadow-lg flex flex-col">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">groups</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("title")}
          </h2>
        </div>
      </div>

      <div className="p-8 space-y-6">
        <p className="text-sm text-slate-500">{t("description")}</p>

        {!initial.botConnected && (
          <p className="text-xs text-amber-400 bg-amber-950/30 border border-amber-900/50 rounded-lg px-4 py-3">
            {t("botDisconnected")}
          </p>
        )}

        <div className="space-y-2">
          <label
            htmlFor="zalo-notify-group"
            className="block text-xs font-bold text-slate-400 uppercase tracking-wider"
          >
            {t("selectLabel")}
          </label>
          <select
            id="zalo-notify-group"
            className={selectClass}
            value={selected}
            disabled={saving}
            onChange={(e) => setSelected(e.target.value)}
          >
            {/* 미설정 = 개별 DM 발송(폴백) */}
            <option value="">{t("optionNone")}</option>
            {/* 저장된 그룹이 목록에 없으면 그 값을 유지하기 위한 항목 */}
            {selectedMissing && initial.selectedGroupId && (
              <option value={initial.selectedGroupId}>{t("optionMissing")}</option>
            )}
            {initial.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name ?? g.id}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500">
            {selected === "" ? t("hintNone") : t("hintGroup")}
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
          {message && (
            <span
              role="status"
              className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}
            >
              {message.text}
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-lg font-bold text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-lg">save</span>
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </section>
  );
}
