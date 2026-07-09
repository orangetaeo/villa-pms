"use client";

// 기간별 요금 편집기 (ADR-0014 구현 3/3) — 다크 ADMIN. 기본요금 1 + 웃돈 기간 N.
// 각 행: season·원가·마진·판매가(VND/KRW). 마진 변경 시 판매가 자동제안(rate-editor 로직 재사용).
// PATCH /api/villas/[id]/rate-periods (전체 교체). 겹침·날짜 오류는 서버 400 → 메시지.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatThousands } from "@/lib/format";
import CollapsibleCard from "@/components/admin/collapsible-card";
import { DateField } from "@/components/date-field";

type Season = "LOW" | "HIGH" | "PEAK";
type MarginType = "PERCENT" | "FIXED_VND";

interface RateFields {
  season: Season;
  supplierCostVnd: string; // 동 단위 숫자 문자열
  marginType: MarginType;
  marginValue: string;
  salePriceVnd: string; // Net(도매/여행사·랜드사) 판매가
  salePriceKrw: number;
  // ADR-0031 소비자 직판가 — Net 대비 추가마진. 빈값=Net 폴백(저장 시 null)
  consumerMarginType: MarginType;
  consumerMarginValue: string;
  consumerSalePriceVnd: string;
  consumerSalePriceKrw: number;
  label: string;
}
interface PeriodRow extends RateFields {
  id: string; // 로컬 키
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

export interface RatePeriodInitial {
  base: RateFields | null;
  periods: (RateFields & { startDate: string; endDate: string })[];
}

const SEASONS: Season[] = ["LOW", "HIGH", "PEAK"];
const SEASON_BADGE: Record<Season, string> = {
  LOW: "bg-emerald-500/10 text-emerald-500",
  HIGH: "bg-orange-500/10 text-orange-500",
  PEAK: "bg-red-500/10 text-red-500",
};

const toDigits = (v: string) => v.replace(/\D/g, "");

/** 판매가(VND) 자동 제안 = 원가 + 마진 (BigInt 정수 연산). Net·소비자가 공용(기준값만 다름) */
function suggestMarkupVnd(baseVnd: string, marginType: MarginType, marginValue: string): string {
  const base = BigInt(baseVnd || "0");
  const margin = BigInt(marginValue || "0");
  return (marginType === "PERCENT" ? (base * (100n + margin)) / 100n : base + margin).toString();
}
/** 판매가(KRW) 환산 제안 — 1,000원 라운딩. 환율 없으면 null */
function suggestKrw(saleVnd: string, fx: number | null): number | null {
  if (!fx || fx <= 0) return null;
  const vnd = Number(saleVnd || "0");
  if (!Number.isFinite(vnd)) return null;
  return Math.round(vnd / fx / 1000) * 1000;
}

let counter = 0;
const localId = () => `rp${Date.now()}_${counter++}`;

const emptyFields = (season: Season): RateFields => ({
  season,
  supplierCostVnd: "",
  marginType: "PERCENT",
  marginValue: "20",
  salePriceVnd: "",
  salePriceKrw: 0,
  consumerMarginType: "PERCENT",
  consumerMarginValue: "0", // 기본 0 = Net과 동일(소비자 마크업 미설정)
  consumerSalePriceVnd: "",
  consumerSalePriceKrw: 0,
  label: "",
});

export default function RatePeriodEditor({
  villaId,
  fxVndPerKrw,
  initial,
}: {
  villaId: string;
  fxVndPerKrw: number | null;
  initial: RatePeriodInitial;
}) {
  const t = useTranslations("adminVillas.detail.ratePeriods");
  const tr = useTranslations("adminVillas.detail.rates");
  const router = useRouter();

  const [base, setBase] = useState<RateFields>(initial.base ?? emptyFields("LOW"));
  const [periods, setPeriods] = useState<PeriodRow[]>(
    initial.periods.map((p) => ({ ...p, id: localId() }))
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 마진/원가 변경 시 판매가 자동제안 (한 행 패치 헬퍼가 적용).
  // ADR-0031: Net(원가+마진) 재산출 → 소비자가(Net+소비자마진)도 연쇄 재산출.
  function withSuggestion(f: RateFields): RateFields {
    const saleVnd = suggestMarkupVnd(f.supplierCostVnd, f.marginType, f.marginValue);
    const krw = suggestKrw(saleVnd, fxVndPerKrw);
    const consumerVnd = suggestMarkupVnd(saleVnd, f.consumerMarginType, f.consumerMarginValue);
    const consumerKrw = suggestKrw(consumerVnd, fxVndPerKrw);
    return {
      ...f,
      salePriceVnd: saleVnd,
      salePriceKrw: krw ?? f.salePriceKrw,
      consumerSalePriceVnd: consumerVnd,
      consumerSalePriceKrw: consumerKrw ?? f.consumerSalePriceKrw,
    };
  }

  function patchBase(patch: Partial<RateFields>, resuggest = false) {
    setBase((prev) => {
      const next = { ...prev, ...patch };
      return resuggest ? withSuggestion(next) : next;
    });
  }
  function patchPeriod(id: string, patch: Partial<PeriodRow>, resuggest = false) {
    setPeriods((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        return resuggest ? { ...next, ...withSuggestion(next) } : next;
      })
    );
  }
  function addPeriod() {
    setPeriods((prev) => [
      ...prev,
      { ...emptyFields("PEAK"), id: localId(), startDate: "", endDate: "" },
    ]);
  }
  function removePeriod(id: string) {
    setPeriods((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    // 사전 검증 — 기간은 시작·종료일 필수 (없으면 서버 400 → 혼란스러운 안내 방지)
    for (const p of periods) {
      if (!p.startDate || !p.endDate) {
        setMessage({ ok: false, text: t("invalid") });
        setSaving(false);
        return;
      }
    }
    const packFields = (f: RateFields) => ({
      season: f.season,
      supplierCostVnd: f.supplierCostVnd || "0",
      marginType: f.marginType,
      marginValue: f.marginValue || "0",
      salePriceVnd: f.salePriceVnd || "0",
      salePriceKrw: f.salePriceKrw || 0,
      // ADR-0031 소비자 직판가 — 빈값/0은 null(Net 폴백). 값이 있으면 문자열/정수 전달.
      consumerMarginType: f.consumerMarginType,
      consumerMarginValue: f.consumerMarginValue || "0",
      consumerSalePriceVnd: f.consumerSalePriceVnd || null,
      consumerSalePriceKrw: f.consumerSalePriceKrw || null,
      label: f.label.trim() || null,
    });
    const body = {
      base: packFields(base),
      periods: periods.map((p) => ({ ...packFields(p), startDate: p.startDate, endDate: p.endDate })),
    };
    try {
      const res = await fetch(`/api/villas/${villaId}/rate-periods`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // 겹침·날짜 오류 등 검증 실패 구분
        setMessage({ ok: false, text: res.status === 400 ? t("invalid") : tr("saveError") });
        return;
      }
      setMessage({ ok: true, text: tr("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: tr("saveError") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleCard
      title={t("title")}
      icon="date_range"
      action={
        <>
          {message && (
            <span role="status" className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}>
              {message.text}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-admin-primary hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold whitespace-nowrap flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-sm">save</span>
            {saving ? tr("saving") : tr("save")}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* 기본요금 (비수기 기준·폴백) */}
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-emerald-500 text-base">home</span>
            <span className="text-sm font-bold text-slate-200">{t("baseTitle")}</span>
            <span className="text-[11px] text-slate-500">{t("baseHint")}</span>
          </div>
          <RateFieldsRow
            fields={base}
            fxVndPerKrw={fxVndPerKrw}
            onPatch={patchBase}
            tr={tr}
          />
        </div>

        {/* 웃돈 기간 N개 */}
        <div className="space-y-3">
          {periods.map((p, i) => (
            <div key={p.id} className="rounded-lg bg-slate-900/40 border border-slate-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-blue-600/15 text-admin-primary text-xs font-black flex items-center justify-center tabular-nums">
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={p.label}
                    onChange={(e) => patchPeriod(p.id, { label: e.target.value })}
                    placeholder={t("labelPlaceholder")}
                    maxLength={60}
                    aria-label={t("periodLabel")}
                    className="bg-transparent border-0 border-b border-slate-700 focus:border-blue-500 focus:ring-0 text-sm font-bold text-slate-100 px-1 py-0.5 w-40 placeholder:text-slate-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removePeriod(p.id)}
                  className="text-slate-500 hover:text-red-400 flex items-center gap-1 text-[11px] whitespace-nowrap"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                  {t("removePeriod")}
                </button>
              </div>
              {/* 날짜 범위 */}
              <div className="flex items-center gap-2 mb-3">
                <DateField
                  value={p.startDate}
                  onChange={(e) => patchPeriod(p.id, { startDate: e.target.value })}
                  aria-label={t("startDate")}
                  placeholder={t("datePlaceholder")}
                  wrapperClassName=""
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 h-9 text-xs text-slate-200 tabular-nums focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-slate-500 text-xs">~</span>
                <DateField
                  value={p.endDate}
                  onChange={(e) => patchPeriod(p.id, { endDate: e.target.value })}
                  aria-label={t("endDate")}
                  placeholder={t("datePlaceholder")}
                  wrapperClassName=""
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 h-9 text-xs text-slate-200 tabular-nums focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-[10px] text-slate-500">{t("halfOpenHint")}</span>
              </div>
              <RateFieldsRow
                fields={p}
                fxVndPerKrw={fxVndPerKrw}
                onPatch={(patch, resuggest) => patchPeriod(p.id, patch, resuggest)}
                tr={tr}
              />
            </div>
          ))}

          <button
            type="button"
            onClick={addPeriod}
            className="w-full rounded-lg border-2 border-dashed border-slate-700 hover:border-blue-500/50 hover:bg-slate-800/30 text-slate-400 hover:text-admin-primary py-3 text-sm font-bold flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-base">add</span>
            {t("addPeriod")}
          </button>
        </div>
      </div>
    </CollapsibleCard>
  );
}

/** season·원가·마진·판매가(VND/KRW) 한 묶음 — 기본요금/기간 공용 */
function RateFieldsRow({
  fields,
  fxVndPerKrw,
  onPatch,
  tr,
}: {
  fields: RateFields;
  fxVndPerKrw: number | null;
  onPatch: (patch: Partial<RateFields>, resuggest?: boolean) => void;
  tr: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="space-y-3">
    {/* 2줄 배치 — 윗줄(입력): 시즌·원가·마진 / 아랫줄(결과): Net 판매가 VND·KRW.
        6개를 한 줄에 넣으면 금액이 잘려 3열 그리드로 자연 줄바꿈(3+2). */}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {/* season */}
      <Field label={tr("colSeason")}>
        <select
          value={fields.season}
          onChange={(e) => onPatch({ season: e.target.value as Season })}
          aria-label={tr("colSeason")}
          className={`w-full h-10 rounded border border-slate-700 px-3 text-xs font-bold ${SEASON_BADGE[fields.season]}`}
        >
          {SEASONS.map((s) => (
            <option key={s} value={s} className="bg-slate-900 text-slate-100">
              {tr(`seasons.${s}`)}
            </option>
          ))}
        </select>
      </Field>
      {/* 원가 */}
      <Field label={tr("colCost")}>
        <NumInput
          value={fields.supplierCostVnd}
          onChange={(d) => onPatch({ supplierCostVnd: d }, true)}
          suffix="₫"
          ariaLabel={tr("colCost")}
        />
      </Field>
      {/* 마진 */}
      <Field label={tr("colMargin")}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={fields.marginType === "FIXED_VND" ? (fields.marginValue ? formatThousands(fields.marginValue) : "") : fields.marginValue}
            onChange={(e) => onPatch({ marginValue: toDigits(e.target.value) }, true)}
            aria-label={tr("colMargin")}
            className="flex-1 min-w-0 h-10 bg-slate-900 border border-slate-700 rounded px-2 text-right text-xs text-slate-100 tabular-nums"
          />
          <select
            value={fields.marginType}
            onChange={(e) => onPatch({ marginType: e.target.value as MarginType }, true)}
            aria-label={tr("colMargin")}
            className="h-10 w-[4.25rem] shrink-0 bg-slate-900 border border-slate-700 rounded px-1.5 text-[11px] text-slate-100"
          >
            <option value="PERCENT">{tr("percent")}</option>
            <option value="FIXED_VND">{tr("fixed")}</option>
          </select>
        </div>
      </Field>
      {/* Net 판매가 VND (도매/여행사·랜드사) */}
      <Field label={tr("colSaleVnd")}>
        <NumInput
          value={fields.salePriceVnd}
          onChange={(d) => {
            const krw = suggestKrw(d, fxVndPerKrw);
            // Net 직접 변경 시 소비자가도 연쇄 재산출(Net + 소비자마진)
            const consumerVnd = suggestMarkupVnd(d, fields.consumerMarginType, fields.consumerMarginValue);
            const consumerKrw = suggestKrw(consumerVnd, fxVndPerKrw);
            onPatch({
              salePriceVnd: d,
              ...(krw !== null ? { salePriceKrw: krw } : {}),
              consumerSalePriceVnd: consumerVnd,
              ...(consumerKrw !== null ? { consumerSalePriceKrw: consumerKrw } : {}),
            });
          }}
          suffix="₫"
          ariaLabel={tr("colSaleVnd")}
        />
      </Field>
      {/* Net 판매가 KRW */}
      <Field label={tr("colSaleKrw")}>
        <input
          type="text"
          inputMode="numeric"
          value={fields.salePriceKrw ? `₩${formatThousands(String(fields.salePriceKrw))}` : "₩0"}
          onChange={(e) => {
            const d = toDigits(e.target.value);
            onPatch({ salePriceKrw: d ? Number.parseInt(d, 10) : 0 });
          }}
          aria-label={tr("colSaleKrw")}
          className="w-full h-10 bg-slate-900 border border-slate-700 rounded px-3 text-right text-xs font-bold text-slate-100 tabular-nums"
        />
      </Field>
    </div>

    {/* ADR-0031 — 소비자 직판가(직접 소비자 채널). Net 대비 추가마진, 비우면 Net 폴백. */}
    <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/[0.04] p-3">
      <p className="text-[10px] font-bold text-indigo-300 mb-2 uppercase tracking-wider">
        {tr("consumerSection")}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 소비자 추가마진 (Net 대비) */}
        <Field label={tr("colConsumerMargin")}>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={fields.consumerMarginType === "FIXED_VND" ? (fields.consumerMarginValue ? formatThousands(fields.consumerMarginValue) : "") : fields.consumerMarginValue}
              onChange={(e) => onPatch({ consumerMarginValue: toDigits(e.target.value) }, true)}
              aria-label={tr("colConsumerMargin")}
              className="flex-1 min-w-0 h-10 bg-slate-900 border border-slate-700 rounded px-2 text-right text-xs text-slate-100 tabular-nums"
            />
            <select
              value={fields.consumerMarginType}
              onChange={(e) => onPatch({ consumerMarginType: e.target.value as MarginType }, true)}
              aria-label={tr("colConsumerMargin")}
              className="h-10 w-[4.25rem] shrink-0 bg-slate-900 border border-slate-700 rounded px-1.5 text-[11px] text-slate-100"
            >
              <option value="PERCENT">{tr("percent")}</option>
              <option value="FIXED_VND">{tr("fixed")}</option>
            </select>
          </div>
        </Field>
        {/* 소비자가 VND */}
        <Field label={tr("colConsumerVnd")}>
          <NumInput
            value={fields.consumerSalePriceVnd}
            onChange={(d) => {
              const krw = suggestKrw(d, fxVndPerKrw);
              onPatch({ consumerSalePriceVnd: d, ...(krw !== null ? { consumerSalePriceKrw: krw } : {}) });
            }}
            suffix="₫"
            ariaLabel={tr("colConsumerVnd")}
          />
        </Field>
        {/* 소비자가 KRW */}
        <Field label={tr("colConsumerKrw")}>
          <input
            type="text"
            inputMode="numeric"
            value={fields.consumerSalePriceKrw ? `₩${formatThousands(String(fields.consumerSalePriceKrw))}` : "₩0"}
            onChange={(e) => {
              const d = toDigits(e.target.value);
              onPatch({ consumerSalePriceKrw: d ? Number.parseInt(d, 10) : 0 });
            }}
            aria-label={tr("colConsumerKrw")}
            className="w-full h-10 bg-slate-900 border border-slate-700 rounded px-3 text-right text-xs font-bold text-slate-100 tabular-nums"
          />
        </Field>
      </div>
      <p className="text-[10px] text-slate-500 mt-2">{tr("consumerHint")}</p>
    </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider whitespace-nowrap">
        {label}
      </label>
      {children}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  suffix,
  ariaLabel,
}: {
  value: string;
  onChange: (digits: string) => void;
  suffix: string;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center bg-slate-900 border border-slate-700 rounded h-10 px-3 focus-within:ring-1 focus-within:ring-blue-500">
      <input
        type="text"
        inputMode="numeric"
        value={value ? formatThousands(value) : ""}
        onChange={(e) => onChange(toDigits(e.target.value))}
        aria-label={ariaLabel}
        className="flex-1 w-full bg-transparent border-0 focus:ring-0 text-right text-xs text-slate-100 tabular-nums p-0 min-w-0"
      />
      <span className="text-[11px] text-slate-500 ml-0.5">{suffix}</span>
    </div>
  );
}
