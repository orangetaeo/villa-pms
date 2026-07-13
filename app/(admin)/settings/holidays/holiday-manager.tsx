"use client";

// 공휴일 관리 (ADR-0042) — 다크 ADMIN. 연도 전환 + 날짜·라벨 추가 + 목록·삭제.
// 날짜 입력은 components/date-field.tsx DateField 필수(iOS 빈 date 공백 함정).
// 추가/삭제는 /api/admin/holidays fetch → 목록 재조회(GET). 중복 날짜=409 → 토스트.
// season-manager와 동일 카드·폼 패턴. 목록은 연도 필터라 소량 — 전체 표시(페이지네이션 없음).
import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DateField } from "@/components/date-field";

export interface HolidayRow {
  id: string;
  date: string; // "YYYY-MM-DD"
  label: string;
}

const holidayFormSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().trim().min(1).max(100),
});
type HolidayFormValues = z.infer<typeof holidayFormSchema>;

const inputClass =
  "h-10 w-full bg-slate-900 border border-slate-700 rounded-lg px-3 text-sm text-slate-100 [color-scheme:dark]";

/** "YYYY-MM-DD" → "YYYY.MM.DD" (DESIGN.md 점 표기) */
function toDotDate(dateStr: string): string {
  return dateStr.replace(/-/g, ".");
}

// 연도 선택 후보 — 올해 기준 ±1 (전년 이월 확인·내년 사전 등록)
function yearOptions(base: number): number[] {
  return [base - 1, base, base + 1, base + 2];
}

export default function HolidayManager({
  initialYear,
  initialRows,
}: {
  initialYear: number;
  initialRows: HolidayRow[];
}) {
  const t = useTranslations("adminSettings.holidays");
  const locale = useLocale();

  const [year, setYear] = useState(initialYear);
  const [rows, setRows] = useState<HolidayRow[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(
    null
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<HolidayFormValues>({
    resolver: zodResolver(holidayFormSchema),
    defaultValues: { date: "", label: "" },
  });
  const dateValue = watch("date");

  // 네이티브 date 입력칸 어디를 눌러도 달력이 열리도록
  const openDatePicker = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      e.currentTarget.showPicker?.();
    } catch {
      // showPicker 미지원·비활성 컨텍스트는 무시
    }
  };

  async function loadYear(nextYear: number) {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/holidays?year=${nextYear}`);
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data: { holidays: HolidayRow[] } = await res.json();
      setRows(data.holidays);
    } catch {
      setMessage({ tone: "error", text: t("loadError") });
    } finally {
      setLoading(false);
    }
  }

  function onChangeYear(nextYear: number) {
    setYear(nextYear);
    void loadYear(nextYear);
  }

  const onSubmit = async (values: HolidayFormValues) => {
    setMessage(null);
    try {
      const res = await fetch("/api/admin/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: values.date, label: values.label.trim() }),
      });
      if (res.status === 409) {
        setMessage({ tone: "warn", text: t("duplicate") });
        return;
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      reset({ date: "", label: "" });
      setMessage({ tone: "ok", text: t("saved") });
      // 추가한 날짜의 연도가 현재 보기 연도면 목록 갱신, 다르면 그 연도로 이동
      const addedYear = Number(values.date.slice(0, 4));
      if (addedYear === year) await loadYear(year);
      else onChangeYear(addedYear);
    } catch {
      setMessage({ tone: "error", text: t("error") });
    }
  };

  const onDelete = async (row: HolidayRow) => {
    if (!window.confirm(t("deleteConfirm", { date: toDotDate(row.date), label: row.label }))) return;
    setMessage(null);
    setDeletingId(row.id);
    try {
      const res = await fetch(`/api/admin/holidays/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setMessage({ tone: "ok", text: t("deleted") });
    } catch {
      setMessage({ tone: "error", text: t("error") });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="bg-admin-card rounded-xl border border-slate-800 shadow-lg overflow-hidden">
      {/* 카드 헤더 — 연도 선택 */}
      <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap gap-3 justify-between items-center bg-slate-800/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">event</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("cardTitle")}
          </h2>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <span className="whitespace-nowrap">{t("yearLabel")}</span>
          <select
            value={year}
            onChange={(e) => onChangeYear(Number(e.target.value))}
            aria-label={t("yearLabel")}
            className="h-9 bg-slate-900 border border-slate-700 rounded-lg px-3 text-sm text-slate-100 tabular-nums"
          >
            {yearOptions(initialYear).map((y) => (
              <option key={y} value={y}>
                {t("yearValue", { year: y })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 추가 폼 */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="border-b border-slate-800 bg-slate-900/30 p-6 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,10rem)_1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">{t("form.date")}</span>
            <DateField
              lang={locale}
              value={dateValue}
              onChange={(e) => setValue("date", e.target.value, { shouldValidate: true })}
              onClick={openDatePicker}
              placeholder={t("form.datePlaceholder")}
              className={`${inputClass} cursor-pointer`}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">{t("form.label")}</span>
            <input
              type="text"
              placeholder={t("form.labelPlaceholder")}
              {...register("label")}
              className={`${inputClass} placeholder:text-slate-600`}
            />
          </label>
          <button
            type="submit"
            disabled={isSubmitting}
            className="h-10 bg-admin-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 rounded-lg font-bold text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            {isSubmitting ? t("form.saving") : t("add")}
          </button>
        </div>
        {(errors.date || errors.label) && (
          <p role="alert" className="text-xs text-red-400">
            {t("form.invalid")}
          </p>
        )}
      </form>

      {/* 목록 */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left border-collapse">
          <thead>
            <tr className="bg-slate-900/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-800">
              <th className="px-6 py-4">{t("colDate")}</th>
              <th className="px-6 py-4">{t("colLabel")}</th>
              <th className="px-6 py-4 text-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-6 py-10 text-center text-sm text-admin-muted">
                  {t("loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-10 text-center text-sm text-admin-muted">
                  {t("empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-800/40 transition-colors group">
                  <td className="px-6 py-4 font-mono text-sm text-slate-300 whitespace-nowrap tabular-nums">
                    {toDotDate(row.date)}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-200 font-medium">{row.label}</td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      aria-label={t("delete")}
                      disabled={deletingId === row.id}
                      onClick={() => onDelete(row)}
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

      {/* 결과 메시지 */}
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
