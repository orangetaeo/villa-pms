"use client";

// 시즌 달력 관리 (T1.7 — Stitch b8 시즌 달력 카드 변환)
// 목록은 RSC props, 추가/수정/삭제는 /api/seasons fetch → router.refresh()
// 겹침(overlaps)은 차단이 아닌 경고 — PEAK > HIGH > LOW 우선 규칙 안내만 표시
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

export interface SeasonRow {
  id: string;
  season: "LOW" | "HIGH" | "PEAK";
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  label: string | null;
}

const seasonFormSchema = z
  .object({
    season: z.enum(["LOW", "HIGH", "PEAK"]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: z.string().trim().max(100).optional(),
  })
  // "YYYY-MM-DD"는 사전순 = 시간순 — 문자열 비교로 start < end 검증
  .refine((d) => d.startDate < d.endDate, { path: ["endDate"], message: "INVALID_RANGE" });

type SeasonFormValues = z.infer<typeof seasonFormSchema>;

// 시즌 뱃지 색 (b8: LOW=green / HIGH=orange / PEAK=red)
const SEASON_BADGE_CLASS: Record<SeasonRow["season"], string> = {
  LOW: "bg-green-900/30 text-green-400 border border-green-800/50",
  HIGH: "bg-orange-900/30 text-orange-400 border border-orange-800/50",
  PEAK: "bg-red-900/30 text-red-400 border border-red-800/50",
};

const SEASON_OPTIONS: SeasonRow["season"][] = ["LOW", "HIGH", "PEAK"];

/** "YYYY-MM-DD" → "YYYY.MM.DD" (DESIGN.md 점 표기) */
function toDotDate(dateStr: string): string {
  return dateStr.replace(/-/g, ".");
}

const EMPTY_FORM: SeasonFormValues = { season: "LOW", startDate: "", endDate: "", label: "" };

const inputClass =
  "h-10 w-full bg-slate-900 border border-slate-700 rounded-lg px-3 text-sm text-slate-100 [color-scheme:dark]";

export default function SeasonManager({ periods }: { periods: SeasonRow[] }) {
  const t = useTranslations("adminSettings.seasons");
  const locale = useLocale();

  // 네이티브 date 입력칸 어디를 눌러도 달력이 열리도록
  const openDatePicker = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      e.currentTarget.showPicker?.();
    } catch {
      // showPicker 미지원·비활성 컨텍스트는 무시
    }
  };
  const router = useRouter();
  // null = 폼 닫힘, "new" = 추가, 그 외 = 수정 대상 id
  const [editing, setEditing] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(
    null
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<SeasonFormValues>({
    resolver: zodResolver(seasonFormSchema),
    defaultValues: EMPTY_FORM,
  });

  const openCreate = () => {
    reset(EMPTY_FORM);
    setMessage(null);
    setEditing("new");
  };

  const openEdit = (row: SeasonRow) => {
    reset({
      season: row.season,
      startDate: row.startDate,
      endDate: row.endDate,
      label: row.label ?? "",
    });
    setMessage(null);
    setEditing(row.id);
  };

  const closeForm = () => {
    setEditing(null);
    reset(EMPTY_FORM);
  };

  const onSubmit = async (values: SeasonFormValues) => {
    setMessage(null);
    try {
      const isCreate = editing === "new";
      const res = await fetch(isCreate ? "/api/seasons" : `/api/seasons/${editing}`, {
        method: isCreate ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season: values.season,
          startDate: values.startDate,
          endDate: values.endDate,
          // 빈 라벨은 보내지 않음 (API: min(1) optional)
          ...(values.label?.trim() ? { label: values.label.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data: { overlaps?: string[] } = await res.json();
      // 겹침은 경고만 (차단 아님) — pricing 우선 규칙 안내
      setMessage(
        data.overlaps && data.overlaps.length > 0
          ? { tone: "warn", text: t("overlapWarning") }
          : { tone: "ok", text: t("saved") }
      );
      closeForm();
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: t("error") });
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm(t("deleteConfirm"))) return;
    setMessage(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/seasons/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ tone: "ok", text: t("deleted") });
      if (editing === id) closeForm();
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: t("error") });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="bg-admin-card rounded-xl border border-slate-800 shadow-lg overflow-hidden">
      {/* 카드 헤더 (b8) */}
      <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">event_note</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("title")}
          </h2>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="text-admin-primary hover:text-blue-400 text-sm font-semibold flex items-center gap-1 transition-colors whitespace-nowrap"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          {t("add")}
        </button>
      </div>

      {/* 기간 목록 테이블 (b8) */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left border-collapse">
          <thead>
            <tr className="bg-slate-900/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-800">
              <th className="px-6 py-4">{t("colSeason")}</th>
              <th className="px-6 py-4 text-center">{t("colStart")}</th>
              <th className="px-6 py-4 text-center">{t("colEnd")}</th>
              <th className="px-6 py-4">{t("colLabel")}</th>
              <th className="px-6 py-4 text-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {periods.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-sm text-admin-muted">
                  {t("empty")}
                </td>
              </tr>
            ) : (
              periods.map((row) => (
                <tr key={row.id} className="hover:bg-slate-800/40 transition-colors group">
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-1 rounded text-xs font-bold whitespace-nowrap ${SEASON_BADGE_CLASS[row.season]}`}
                    >
                      {t(`names.${row.season}`)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center font-mono text-sm text-slate-300 whitespace-nowrap tabular-nums">
                    {toDotDate(row.startDate)}
                  </td>
                  <td className="px-6 py-4 text-center font-mono text-sm text-slate-300 whitespace-nowrap tabular-nums">
                    {toDotDate(row.endDate)}
                  </td>
                  <td
                    className={`px-6 py-4 text-sm ${row.label ? "text-slate-200 font-medium" : "text-slate-500"}`}
                  >
                    {row.label ?? "-"}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      aria-label={t("edit")}
                      onClick={() => openEdit(row)}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-all"
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </button>
                    <button
                      type="button"
                      aria-label={t("delete")}
                      disabled={deletingId === row.id}
                      onClick={() => onDelete(row.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded transition-all disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-lg">delete</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 추가/수정 폼 — "기간 추가" 또는 행 수정 클릭 시 표시 */}
      {editing !== null && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="border-t border-slate-800 bg-slate-900/30 p-6 space-y-4"
        >
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
            {editing === "new" ? t("add") : t("edit")}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("form.season")}
              </span>
              <select {...register("season")} className={inputClass}>
                {SEASON_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`names.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("form.startDate")}
              </span>
              <input
                type="date"
                lang={locale}
                onClick={openDatePicker}
                {...register("startDate")}
                className={`${inputClass} cursor-pointer`}
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("form.endDate")}
              </span>
              <input
                type="date"
                lang={locale}
                onClick={openDatePicker}
                {...register("endDate")}
                className={`${inputClass} cursor-pointer`}
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">
                {t("form.label")}
              </span>
              <input
                type="text"
                placeholder={t("form.labelPlaceholder")}
                {...register("label")}
                className={`${inputClass} placeholder:text-slate-600`}
              />
            </label>
          </div>
          {(errors.startDate || errors.endDate) && (
            <p role="alert" className="text-xs text-red-400">
              {errors.endDate?.message === "INVALID_RANGE"
                ? t("form.invalidRange")
                : t("form.invalidDate")}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeForm}
              className="px-5 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              {t("form.cancel")}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-bold text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-lg">save</span>
              {isSubmitting ? t("form.saving") : t("form.save")}
            </button>
          </div>
        </form>
      )}

      {/* 결과 메시지 (저장/겹침 경고/오류) */}
      {message && (
        <p
          role="status"
          className={`px-6 py-3 border-t border-slate-800 text-xs font-medium ${
            message.tone === "ok"
              ? "text-emerald-500"
              : message.tone === "warn"
                ? "text-amber-400"
                : "text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
