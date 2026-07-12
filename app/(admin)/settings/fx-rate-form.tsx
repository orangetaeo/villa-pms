"use client";

// 환율 설정 — 판매가 환산 기준 환율 (T1.7 → 후속확장3 USD·자동환율)
// 유효 환율 단일 해석: FX_MODE(MANUAL 기본 | AUTO).
//   MANUAL → 아래 수동값(FX_VND_PER_KRW / FX_VND_PER_USD) 사용.
//   AUTO   → 무료 환율 API 일일 시세 사용, 실패 시 수동값 폴백.
// 저장은 기존 /api/settings 배치 PUT(entries) — 한 트랜잭션·한 감사로그. 신규 키 검증은 BE 화이트리스트.
// 파서 호환: /^\d+(\.\d{1,4})?$/ 양수 (lib/pricing·validators와 동일).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatThousands } from "@/lib/format";

type FxMode = "MANUAL" | "AUTO";

const RATE_RE = /^\d+(\.\d{1,4})?$/;

const fxFormSchema = z.object({
  // KRW 수동 환율 — 판매가 자동 제안의 기준(항상 필요)
  rateKrw: z
    .string()
    .trim()
    .regex(RATE_RE)
    .refine((v) => Number(v) > 0),
  // USD 수동 환율 — 선택(비우면 미설정 유지). 채우면 양수 소수만.
  rateUsd: z
    .string()
    .trim()
    .refine((v) => v === "" || (RATE_RE.test(v) && Number(v) > 0)),
});

type FxFormValues = z.infer<typeof fxFormSchema>;

// GET /api/settings/fx-rates 응답 (BE 계약 고정)
interface FxRatesResponse {
  vndPerKrw: string | null;
  vndPerUsd: string | null;
  fetchedAt: string | null;
}

export default function FxRateForm({
  initialKrw,
  initialUsd,
  mode: initialMode,
  krwUpdatedAtText,
  usdUpdatedAtText,
}: {
  initialKrw: string | null;
  initialUsd: string | null;
  mode: FxMode;
  krwUpdatedAtText: string | null;
  usdUpdatedAtText: string | null;
}) {
  const t = useTranslations("adminSettings.fx");
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 모드는 폼 외 로컬 상태 — 저장 버튼으로 배치 저장(더티 판정에 합산)
  const [mode, setMode] = useState<FxMode>(initialMode);

  // "현재 시세 불러오기" 상태
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [rates, setRates] = useState<FxRatesResponse | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<FxFormValues>({
    resolver: zodResolver(fxFormSchema),
    defaultValues: { rateKrw: initialKrw ?? "", rateUsd: initialUsd ?? "" },
  });

  // 모드 변경만으로도 저장 가능하도록 더티 합산
  const dirty = isDirty || mode !== initialMode;

  const loadRates = async () => {
    setFetching(true);
    setFetchError(false);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/fx-rates");
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = (await res.json()) as FxRatesResponse;
      // 둘 다 null = 외부 장애 + 캐시 없음 → 실패로 표시(200이지만 표시할 시세 없음)
      if (!data.vndPerKrw && !data.vndPerUsd) {
        setFetchError(true);
        setRates(null);
        return;
      }
      setRates(data);
    } catch {
      setFetchError(true);
      setRates(null);
    } finally {
      setFetching(false);
    }
  };

  // 조회 시세를 입력칸에 채움 (운영자가 수정 후 저장 가능)
  const applyRates = () => {
    if (!rates) return;
    if (rates.vndPerKrw)
      setValue("rateKrw", rates.vndPerKrw, { shouldDirty: true, shouldValidate: true });
    if (rates.vndPerUsd)
      setValue("rateUsd", rates.vndPerUsd, { shouldDirty: true, shouldValidate: true });
  };

  const onSubmit = async (values: FxFormValues) => {
    setMessage(null);
    // 배치 저장 — FX_MODE는 항상, 수동 환율은 값이 있을 때만(비-clearable 키 400 회피)
    const entries: { key: string; value: string }[] = [{ key: "FX_MODE", value: mode }];
    if (values.rateKrw.trim())
      entries.push({ key: "FX_VND_PER_KRW", value: values.rateKrw.trim() });
    if (values.rateUsd.trim())
      entries.push({ key: "FX_VND_PER_USD", value: values.rateUsd.trim() });
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("error") });
    }
  };

  const modeBtn = (active: boolean) =>
    active
      ? "flex-1 px-3 py-2 rounded-lg border border-admin-primary bg-admin-primary/10 text-admin-primary font-bold text-sm"
      : "flex-1 px-3 py-2 rounded-lg border border-slate-700 text-slate-400 font-medium text-sm hover:border-slate-600 hover:bg-slate-800/30 transition-colors";

  return (
    <section className="bg-admin-card rounded-xl border border-slate-800 shadow-lg flex flex-col">
      {/* 카드 헤더 (b8 스타일) */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">currency_exchange</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("title")}
          </h2>
        </div>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-8">
        {/* 모드 토글 (수동/자동) */}
        <div className="flex flex-col gap-3 bg-slate-900/50 border border-slate-700 rounded-lg p-4">
          <div className="space-y-1">
            <p className="text-sm font-bold text-slate-200">{t("mode.title")}</p>
            <p className="text-xs text-slate-400">
              {mode === "AUTO" ? t("mode.autoDesc") : t("mode.manualDesc")}
            </p>
          </div>
          <div className="flex gap-2 max-w-xs">
            <button
              type="button"
              aria-pressed={mode === "MANUAL"}
              onClick={() => setMode("MANUAL")}
              className={modeBtn(mode === "MANUAL")}
            >
              {t("mode.manual")}
            </button>
            <button
              type="button"
              aria-pressed={mode === "AUTO"}
              onClick={() => setMode("AUTO")}
              className={modeBtn(mode === "AUTO")}
            >
              {t("mode.auto")}
            </button>
          </div>
          {mode === "AUTO" && (
            <p className="text-xs text-amber-400/90 flex items-start gap-1.5">
              <span className="material-symbols-outlined text-[15px] leading-none mt-px">info</span>
              {t("mode.fallbackHint")}
            </p>
          )}
        </div>

        {/* 현재 시세 불러오기 */}
        <div className="flex flex-col gap-3 bg-slate-900/40 border border-slate-800 rounded-lg p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-bold text-slate-200">{t("fetch.title")}</p>
              <p className="text-xs text-slate-400">{t("fetch.description")}</p>
            </div>
            <button
              type="button"
              onClick={loadRates}
              disabled={fetching}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              <span
                className={`material-symbols-outlined text-[16px] ${fetching ? "animate-spin" : ""}`}
              >
                {fetching ? "progress_activity" : "cloud_download"}
              </span>
              {fetching ? t("fetch.loading") : t("fetch.button")}
            </button>
          </div>

          {fetchError && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[15px]">error</span>
              {t("fetch.error")}
            </p>
          )}

          {rates && !fetchError && (
            <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
              <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                <div>
                  <span className="block text-[11px] text-slate-500">{t("prefix")}</span>
                  <p className="text-sm font-bold text-white tabular-nums">
                    {rates.vndPerKrw
                      ? `${formatThousands(rates.vndPerKrw)} ${t("suffix")}`
                      : t("fetch.unavailable")}
                  </p>
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500">{t("prefixUsd")}</span>
                  <p className="text-sm font-bold text-white tabular-nums">
                    {rates.vndPerUsd
                      ? `${formatThousands(rates.vndPerUsd)} ${t("suffix")}`
                      : t("fetch.unavailable")}
                  </p>
                </div>
                {rates.fetchedAt && (
                  <div className="ml-auto self-end">
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {t("fetch.fetchedAt", { time: rates.fetchedAt })}
                    </span>
                  </div>
                )}
              </div>
              {(rates.vndPerKrw || rates.vndPerUsd) && (
                <button
                  type="button"
                  onClick={applyRates}
                  className="self-start inline-flex items-center gap-1.5 rounded-lg border border-admin-primary px-3 py-1.5 text-xs font-bold text-admin-primary hover:bg-admin-primary/10"
                >
                  <span className="material-symbols-outlined text-[15px]">input</span>
                  {t("fetch.apply")}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 수동 환율 입력 (KRW + USD) */}
        <div className="flex flex-col gap-6">
          {/* KRW */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <label htmlFor="fx-rate-krw" className="block text-sm font-bold text-slate-200">
                {t("label")}
              </label>
              <p className="text-sm text-slate-400">{t("description")}</p>
              <p className="text-xs text-slate-500 pt-1 whitespace-nowrap tabular-nums">
                {krwUpdatedAtText ? t("lastUpdated", { time: krwUpdatedAtText }) : t("notSet")}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2 bg-slate-900 rounded-lg p-1 pl-4 border border-slate-700">
                <span className="text-sm font-medium text-slate-400 whitespace-nowrap">
                  {t("prefix")}
                </span>
                <input
                  id="fx-rate-krw"
                  type="text"
                  inputMode="decimal"
                  placeholder={t("placeholder")}
                  {...register("rateKrw")}
                  className="w-28 h-10 bg-transparent border-none text-right text-xl font-bold text-white tabular-nums placeholder:text-slate-600 placeholder:text-sm placeholder:font-normal focus:ring-0"
                />
                <span className="text-xs text-slate-500 font-medium pr-3 whitespace-nowrap">
                  {t("suffix")}
                </span>
              </div>
              {errors.rateKrw && (
                <p role="alert" className="text-xs text-red-400">
                  {t("invalid")}
                </p>
              )}
            </div>
          </div>

          {/* USD */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <label htmlFor="fx-rate-usd" className="block text-sm font-bold text-slate-200">
                {t("labelUsd")}
              </label>
              <p className="text-sm text-slate-400">{t("descriptionUsd")}</p>
              <p className="text-xs text-slate-500 pt-1 whitespace-nowrap tabular-nums">
                {usdUpdatedAtText ? t("lastUpdated", { time: usdUpdatedAtText }) : t("notSet")}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2 bg-slate-900 rounded-lg p-1 pl-4 border border-slate-700">
                <span className="text-sm font-medium text-slate-400 whitespace-nowrap">
                  {t("prefixUsd")}
                </span>
                <input
                  id="fx-rate-usd"
                  type="text"
                  inputMode="decimal"
                  placeholder={t("placeholderUsd")}
                  {...register("rateUsd")}
                  className="w-28 h-10 bg-transparent border-none text-right text-xl font-bold text-white tabular-nums placeholder:text-slate-600 placeholder:text-sm placeholder:font-normal focus:ring-0"
                />
                <span className="text-xs text-slate-500 font-medium pr-3 whitespace-nowrap">
                  {t("suffix")}
                </span>
              </div>
              {errors.rateUsd && (
                <p role="alert" className="text-xs text-red-400">
                  {t("invalid")}
                </p>
              )}
            </div>
          </div>

          {mode === "AUTO" && (
            <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
              <span className="material-symbols-outlined text-[14px] leading-none mt-px">
                info
              </span>
              {t("mode.inputFallbackHint")}
            </p>
          )}
        </div>

        {/* 구분선 + 저장 (b8 카드 패턴) */}
        <div className="h-px bg-slate-800 w-full" />
        <div className="flex justify-end items-center gap-3">
          {message && (
            <span
              role="status"
              className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}
            >
              {message.text}
            </span>
          )}
          <button
            type="submit"
            disabled={isSubmitting || !dirty}
            className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-lg font-bold text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-lg">save</span>
            {isSubmitting ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </section>
  );
}
