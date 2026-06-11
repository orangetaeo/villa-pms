"use client";

// 시즌 요율 편집 (T1.2 — Stitch b10 요율 테이블 변환)
// 원가: 읽기 전용 / 마진 타입·값, 판매가(VND), 판매가(KRW) 편집
// 금액 규칙: VND 자동 제안은 BigInt 정수 연산 — 부동소수점 금지
// T5.5: 5열 클리핑 방지 — overflow-x-auto + 컴팩트 입력 폭
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatThousands, formatVnd } from "@/lib/format";

export interface RateRow {
  season: "LOW" | "HIGH" | "PEAK";
  supplierCostVnd: string; // BigInt 직렬화 (동 단위 숫자 문자열)
  marginType: "PERCENT" | "FIXED_VND";
  marginValue: string;
  salePriceVnd: string;
  salePriceKrw: number;
}

const rateFormSchema = z.object({
  rates: z.array(
    z.object({
      season: z.enum(["LOW", "HIGH", "PEAK"]),
      marginType: z.enum(["PERCENT", "FIXED_VND"]),
      marginValue: z.string().regex(/^\d+$/),
      salePriceVnd: z.string().regex(/^\d+$/),
      salePriceKrw: z.number().int().min(0),
    })
  ),
});

type RateFormValues = z.infer<typeof rateFormSchema>;

const SEASON_BADGE_CLASS: Record<RateRow["season"], string> = {
  LOW: "bg-emerald-500/10 text-emerald-500",
  HIGH: "bg-orange-500/10 text-orange-500",
  PEAK: "bg-red-500/10 text-red-500",
};

/** 숫자 외 문자 제거 (쉼표 입력 허용) */
function toDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** 판매가(VND) 자동 제안 = 원가 + 마진 (BigInt 정수 연산) */
function suggestSaleVnd(
  costVnd: string,
  marginType: RateRow["marginType"],
  marginValue: string
): string {
  const cost = BigInt(costVnd || "0");
  const margin = BigInt(marginValue || "0");
  const hundred = BigInt(100);
  const result =
    marginType === "PERCENT" ? (cost * (hundred + margin)) / hundred : cost + margin;
  return result.toString();
}

/** 판매가(KRW) 환산 제안 — 1,000원 단위 라운딩. 환율 미설정 시 null (수동 입력 유지) */
function suggestKrw(saleVnd: string, fxVndPerKrw: number | null): number | null {
  if (!fxVndPerKrw || fxVndPerKrw <= 0) return null;
  const vnd = Number(saleVnd || "0");
  if (!Number.isFinite(vnd)) return null;
  return Math.round(vnd / fxVndPerKrw / 1000) * 1000;
}

export default function RateEditor({
  villaId,
  rates,
  fxVndPerKrw,
}: {
  villaId: string;
  rates: RateRow[];
  fxVndPerKrw: number | null;
}) {
  const t = useTranslations("adminVillas.detail.rates");
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { isSubmitting, isDirty },
  } = useForm<RateFormValues>({
    resolver: zodResolver(rateFormSchema),
    defaultValues: {
      rates: rates.map((r) => ({
        season: r.season,
        marginType: r.marginType,
        marginValue: r.marginValue,
        salePriceVnd: r.salePriceVnd,
        salePriceKrw: r.salePriceKrw,
      })),
    },
  });

  // 마진 변경 → 판매가(VND)·판매가(KRW) 자동 제안
  const applySuggestion = (index: number) => {
    const row = getValues(`rates.${index}`);
    const saleVnd = suggestSaleVnd(rates[index].supplierCostVnd, row.marginType, row.marginValue);
    setValue(`rates.${index}.salePriceVnd`, saleVnd, { shouldDirty: true });
    const krw = suggestKrw(saleVnd, fxVndPerKrw);
    if (krw !== null) {
      setValue(`rates.${index}.salePriceKrw`, krw, { shouldDirty: true });
    }
  };

  const onSubmit = async (values: RateFormValues) => {
    setMessage(null);
    try {
      const res = await fetch(`/api/villas/${villaId}/rates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates: values.rates }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("saveError") });
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="bg-admin-card rounded-xl border border-slate-800 shadow-xl overflow-hidden"
    >
      <div className="p-6 border-b border-slate-800">
        <h2 className="text-lg font-bold flex items-center gap-2 whitespace-nowrap">
          <span className="material-symbols-outlined text-admin-primary">payments</span>
          {t("title")}
        </h2>
      </div>
      {rates.length === 0 ? (
        <p className="p-6 text-sm text-admin-muted text-center">{t("empty")}</p>
      ) : (
        <>
          <div className="p-0 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/50 text-slate-500 uppercase">
                  <th className="px-3 py-3 font-bold border-b border-slate-800">
                    {t("colSeason")}
                  </th>
                  <th className="px-3 py-3 font-bold border-b border-slate-800 text-right">
                    {t("colCost")}
                  </th>
                  <th className="px-3 py-3 font-bold border-b border-slate-800 text-center">
                    {t("colMargin")}
                  </th>
                  <th className="px-3 py-3 font-bold border-b border-slate-800 text-right">
                    {t("colSaleVnd")}
                  </th>
                  <th className="px-3 py-3 font-bold border-b border-slate-800 text-right">
                    {t("colSaleKrw")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rates.map((rate, index) => (
                  <tr key={rate.season} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-3 py-4">
                      <span
                        className={`px-2 py-0.5 rounded font-bold whitespace-nowrap ${SEASON_BADGE_CLASS[rate.season]}`}
                      >
                        {t(`seasons.${rate.season}`)}
                      </span>
                    </td>
                    {/* 공급자 원가 — 읽기 전용 */}
                    <td className="px-3 py-4 text-right text-slate-500 whitespace-nowrap tabular-nums">
                      {formatVnd(rate.supplierCostVnd)}
                    </td>
                    {/* 마진 타입·값 */}
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-1 justify-center">
                        <Controller
                          control={control}
                          name={`rates.${index}.marginValue`}
                          render={({ field }) => (
                            <input
                              type="text"
                              inputMode="numeric"
                              aria-label={t("colMargin")}
                              className="w-14 h-8 bg-slate-900 border border-slate-700 rounded text-center text-xs text-slate-100 tabular-nums"
                              value={field.value}
                              onChange={(e) => {
                                field.onChange(toDigits(e.target.value));
                              }}
                              onBlur={() => {
                                field.onBlur();
                                applySuggestion(index);
                              }}
                            />
                          )}
                        />
                        <Controller
                          control={control}
                          name={`rates.${index}.marginType`}
                          render={({ field }) => (
                            <select
                              aria-label={t("colMargin")}
                              className="h-8 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-100 px-1 py-0"
                              value={field.value}
                              onChange={(e) => {
                                field.onChange(e.target.value);
                                applySuggestion(index);
                              }}
                            >
                              <option value="PERCENT">{t("percent")}</option>
                              <option value="FIXED_VND">{t("fixed")}</option>
                            </select>
                          )}
                        />
                      </div>
                    </td>
                    {/* 판매가 (VND) */}
                    <td className="px-3 py-4 text-right">
                      <Controller
                        control={control}
                        name={`rates.${index}.salePriceVnd`}
                        render={({ field }) => (
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={t("colSaleVnd")}
                            className="w-28 h-8 bg-slate-900 border border-slate-700 rounded text-right text-xs text-slate-100 tabular-nums"
                            value={field.value ? `${formatThousands(field.value)}₫` : ""}
                            onChange={(e) => {
                              const digits = toDigits(e.target.value);
                              field.onChange(digits);
                              const krw = suggestKrw(digits, fxVndPerKrw);
                              if (krw !== null) {
                                setValue(`rates.${index}.salePriceKrw`, krw, {
                                  shouldDirty: true,
                                });
                              }
                            }}
                          />
                        )}
                      />
                    </td>
                    {/* 판매가 (KRW 환산 참고) — 자동 제안 + 오버라이드 */}
                    <td className="px-3 py-4 text-right whitespace-nowrap">
                      <Controller
                        control={control}
                        name={`rates.${index}.salePriceKrw`}
                        render={({ field }) => (
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={t("colSaleKrw")}
                            className="w-24 h-8 bg-slate-900 border border-slate-700 rounded text-right text-xs font-bold text-slate-100 tabular-nums"
                            value={field.value ? `₩${formatThousands(field.value)}` : "₩0"}
                            onChange={(e) => {
                              const digits = toDigits(e.target.value);
                              field.onChange(digits ? Number.parseInt(digits, 10) : 0);
                            }}
                          />
                        )}
                      />
                      {fxVndPerKrw !== null && (
                        <div className="mt-1">
                          <span className="text-[9px] text-slate-400 bg-slate-800 px-1 rounded whitespace-nowrap">
                            {t("autoSuggest")}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 bg-slate-900/30 border-t border-slate-800 flex items-center justify-end gap-3">
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
              disabled={isSubmitting || !isDirty}
              className="px-6 py-2 bg-admin-primary hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-bold transition-all shadow-lg shadow-blue-900/20 whitespace-nowrap"
            >
              {isSubmitting ? t("saving") : t("save")}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
