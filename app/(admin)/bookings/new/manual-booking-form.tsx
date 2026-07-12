"use client";

// 관리자 수동 예약 생성 폼 (T-admin-manual-booking — 운영자 다크 ko)
// 전화·Zalo로 직접 받은 예약을 운영자가 직접 기록하는 정식 경로. POST /api/bookings.
// - 빌라: ACTIVE + isSellable 만 (검수 게이트 — RSC에서 필터해 넘김). 재고 비공개 원칙 하 셀렉트.
// - 날짜: components/date-field.tsx DateField 필수 (iOS raw date input 공백 함정 회피).
// - 채널→통화 기본값: DIRECT=KRW, 여행사·랜드사=VND (오버라이드 허용 — KRW/VND/USD 버튼).
// - 파트너: 여행사·랜드사에서 GET /api/partners/options?type= 재사용 + agencyName 자유 텍스트 폴백.
// - 상태: 가예약(HOLD, 만료시각 필수·기본 +24h) / 확정(CONFIRMED).
// - 409 에러코드(SOLD_OUT/NOT_SELLABLE/OVER_CAPACITY/여신)별 한국어 메시지.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatThousands } from "@/lib/format";
import { DateField } from "@/components/date-field";

type Channel = "DIRECT" | "TRAVEL_AGENCY" | "LAND_AGENCY";
type Currency = "KRW" | "VND" | "USD";
type Status = "HOLD" | "CONFIRMED";

const CHANNELS: Channel[] = ["DIRECT", "TRAVEL_AGENCY", "LAND_AGENCY"];
const CURRENCIES: Currency[] = ["KRW", "VND", "USD"];
const CURRENCY_SYMBOL: Record<Currency, string> = { KRW: "₩", VND: "₫", USD: "$" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface VillaOption {
  id: string;
  name: string;
  complex: string | null;
  maxGuests: number;
}

interface PartnerOption {
  id: string;
  name: string;
  nameVi: string | null;
  type: Channel;
  status: string;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round(
    (new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) /
      DAY_MS
  );
}

/** now+hours 를 datetime-local 입력값 형식(YYYY-MM-DDTHH:mm, 로컬시간)으로 */
function localDateTimeValue(base: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}T${p(base.getHours())}:${p(base.getMinutes())}`;
}

export default function ManualBookingForm({
  villas,
  prefill,
}: {
  villas: VillaOption[];
  prefill: { villaId?: string; checkIn?: string; checkOut?: string };
}) {
  const t = useTranslations("adminBookings");
  const locale = useLocale();
  const router = useRouter();

  // 네이티브 date 입력 어디를 눌러도 달력 열기
  const openDatePicker = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      e.currentTarget.showPicker?.();
    } catch {
      /* 미지원 컨텍스트 무시 */
    }
  };

  const formSchema = useMemo(
    () =>
      z
        .object({
          villaId: z.string().min(1, t("create.villaRequired")),
          checkIn: z.string().regex(DATE_RE, t("create.selectDates")),
          checkOut: z.string().regex(DATE_RE, t("create.selectDates")),
          guestName: z.string().trim().min(1, t("create.guestNameRequired")),
          guestCount: z.coerce.number().int().min(1, t("create.guestCountRequired")),
          guestPhone: z.string().trim().optional(),
          agencyName: z.string().trim().optional(),
          totalSale: z.string().regex(/^\d+$/, t("create.priceRequired")).refine((v) => BigInt(v) > 0n, {
            message: t("create.priceRequired"),
          }),
        })
        .refine(
          (v) => !DATE_RE.test(v.checkIn) || !DATE_RE.test(v.checkOut) || v.checkIn < v.checkOut,
          { message: t("create.dateOrderError"), path: ["checkOut"] }
        ),
    [t]
  );
  type FormValues = z.infer<typeof formSchema>;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      villaId: prefill.villaId ?? "",
      checkIn: prefill.checkIn ?? "",
      checkOut: prefill.checkOut ?? "",
      guestName: "",
      guestCount: 2,
      guestPhone: "",
      agencyName: "",
      totalSale: "",
    },
  });

  // RHF 외 상태 (버튼형 토글)
  const [channel, setChannel] = useState<Channel>("DIRECT");
  const [currency, setCurrency] = useState<Currency>("KRW");
  const [status, setStatus] = useState<Status>("CONFIRMED");
  const [partnerId, setPartnerId] = useState<string>("");
  const [holdExpiresAt, setHoldExpiresAt] = useState<string>(() =>
    localDateTimeValue(new Date(Date.now() + 24 * 3600_000))
  );
  const [breakfast, setBreakfast] = useState(false);

  const villaId = watch("villaId");
  const checkIn = watch("checkIn");
  const checkOut = watch("checkOut");
  const guestCount = watch("guestCount");
  const totalSale = watch("totalSale");

  const selectedVilla = useMemo(() => villas.find((v) => v.id === villaId) ?? null, [villas, villaId]);
  const datesValid = DATE_RE.test(checkIn) && DATE_RE.test(checkOut) && checkIn < checkOut;
  const nights = datesValid ? nightsBetween(checkIn, checkOut) : 0;
  const overCapacity =
    !!selectedVilla && Number(guestCount) > 0 && Number(guestCount) > selectedVilla.maxGuests;

  // 채널 변경 → 통화 기본값 조정 (사용자 오버라이드 허용, USD면 유지)
  useEffect(() => {
    setPartnerId("");
    setValue("agencyName", "");
    setCurrency((cur) => (cur === "USD" ? "USD" : channel === "DIRECT" ? "KRW" : "VND"));
  }, [channel, setValue]);

  // 파트너 옵션 (여행사·랜드사)
  const [partnerOptions, setPartnerOptions] = useState<PartnerOption[]>([]);
  useEffect(() => {
    if (channel === "DIRECT") {
      setPartnerOptions([]);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/partners/options?type=${channel}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setPartnerOptions([]);
          return;
        }
        const data = (await res.json()) as { partners: PartnerOption[] };
        setPartnerOptions(data.partners.filter((p) => p.status !== "BLOCKED"));
      } catch {
        setPartnerOptions([]);
      }
    })();
    return () => controller.abort();
  }, [channel]);

  // 파트너 선택 시 agencyName 자동 채움(폴백 텍스트는 미선택 시 자유 입력)
  const onPartnerSelect = (value: string) => {
    setPartnerId(value);
    const p = partnerOptions.find((o) => o.id === value);
    if (p) setValue("agencyName", p.name);
  };

  const [errorCode, setErrorCode] = useState<string | null>(null);

  const onSubmit = async (values: FormValues) => {
    setErrorCode(null);
    if (overCapacity) {
      setErrorCode("OVER_CAPACITY");
      return;
    }
    if (status === "HOLD" && !holdExpiresAt) {
      setErrorCode("HOLD_EXPIRES_REQUIRED");
      return;
    }
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          villaId: values.villaId,
          checkIn: values.checkIn,
          checkOut: values.checkOut,
          guestName: values.guestName,
          guestCount: Number(values.guestCount),
          ...(values.guestPhone ? { guestPhone: values.guestPhone } : {}),
          channel,
          ...(channel !== "DIRECT" && partnerId ? { partnerId } : {}),
          ...(channel !== "DIRECT" && values.agencyName ? { agencyName: values.agencyName } : {}),
          saleCurrency: currency,
          totalSale: values.totalSale,
          breakfastIncluded: breakfast,
          status,
          ...(status === "HOLD" ? { holdExpiresAt: new Date(holdExpiresAt).toISOString() } : {}),
        }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as { booking: { id: string } };
        router.push(`/bookings/${data.booking.id}`);
        return;
      }
      if (res.status === 409 || res.status === 400 || res.status === 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorCode(data.error ?? (res.status === 400 ? "VALIDATION" : "GENERIC"));
        return;
      }
      setErrorCode("GENERIC");
    } catch {
      setErrorCode("GENERIC");
    }
  };

  // 409/400/404 에러코드 → 한국어 메시지.
  //   전용 문구 코드는 KNOWN_CODES, 파트너 여신 차단은 CREDIT, 그 외 미지정 코드는 GENERIC 폴백.
  const KNOWN_CODES = new Set([
    "SOLD_OUT",
    "NOT_SELLABLE",
    "OVER_CAPACITY",
    "RATE_NOT_SET",
    "VILLA_NOT_FOUND",
    "HOLD_EXPIRES_REQUIRED",
    "VALIDATION",
  ]);
  const errorMessage = !errorCode
    ? null
    : KNOWN_CODES.has(errorCode)
      ? t(`create.errors.${errorCode}` as "create.errors.SOLD_OUT")
      : errorCode === "PARTNER_CREDIT_BLOCKED"
        ? t("create.errors.CREDIT", { code: errorCode })
        : t("create.errors.GENERIC");

  const sectionLabel = "text-xs font-bold text-slate-500 uppercase tracking-wider block mb-3";
  const inputCls =
    "w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:border-admin-primary focus:outline-none placeholder:text-slate-600";
  const cardCls = "bg-admin-card rounded-2xl border border-slate-800 p-6";

  const toggleBtn = (active: boolean) =>
    active
      ? "px-3 py-2.5 rounded-xl border border-admin-primary bg-admin-primary/10 text-admin-primary font-bold text-sm"
      : "px-3 py-2.5 rounded-xl border border-slate-700 text-slate-400 font-medium text-sm hover:border-slate-600 hover:bg-slate-800/30 transition-colors";

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Link href="/bookings" className="hover:text-slate-300">
          {t("list.title")}
        </Link>
        <span className="material-symbols-outlined text-base">chevron_right</span>
        <span className="text-slate-300">{t("create.title")}</span>
      </div>
      <h1 className="text-2xl font-bold text-white mb-6">{t("create.title")}</h1>

      {villas.length === 0 ? (
        <div className="bg-admin-card border border-slate-800 rounded-2xl p-12 text-center text-sm text-slate-400">
          {t("create.noVillas")}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start [&_input]:scroll-mb-24 [&_select]:scroll-mb-24"
        >
          {/* ── 좌: 빌라·일정·게스트 ── */}
          <div className="flex flex-col gap-6">
            {/* 빌라 */}
            <section className={cardCls}>
              <span className={sectionLabel}>{t("create.villaSection")}</span>
              <label htmlFor="mb-villa" className="sr-only">
                {t("create.villaLabel")}
              </label>
              <select
                id="mb-villa"
                className={`${inputCls} [color-scheme:dark] cursor-pointer`}
                {...register("villaId")}
              >
                <option value="" disabled>
                  {t("create.villaPlaceholder")}
                </option>
                {villas.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.complex ? `[${v.complex}] ` : ""}
                    {v.name} · {t("create.maxGuests", { n: v.maxGuests })}
                  </option>
                ))}
              </select>
              {errors.villaId && (
                <p role="alert" className="text-xs text-red-400 mt-1.5">
                  {errors.villaId.message}
                </p>
              )}
            </section>

            {/* 일정 */}
            <section className={cardCls}>
              <span className={sectionLabel}>{t("create.datesSection")}</span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="mb-check-in"
                    className="flex items-center gap-1.5 mb-2 text-xs text-slate-400"
                  >
                    <span className="material-symbols-outlined text-admin-primary text-base">
                      calendar_month
                    </span>
                    {t("create.checkIn")}
                  </label>
                  <DateField
                    id="mb-check-in"
                    lang={locale}
                    onClick={openDatePicker}
                    placeholder={t("create.datePlaceholder")}
                    {...register("checkIn")}
                    className={`${inputCls} font-bold tabular-nums [color-scheme:dark] cursor-pointer`}
                  />
                </div>
                <div>
                  <label
                    htmlFor="mb-check-out"
                    className="flex items-center gap-1.5 mb-2 text-xs text-slate-400"
                  >
                    <span className="material-symbols-outlined text-admin-primary text-base">
                      event_available
                    </span>
                    {t("create.checkOut")}
                  </label>
                  <DateField
                    id="mb-check-out"
                    lang={locale}
                    onClick={openDatePicker}
                    placeholder={t("create.datePlaceholder")}
                    {...register("checkOut")}
                    className={`${inputCls} font-bold tabular-nums [color-scheme:dark] cursor-pointer`}
                  />
                </div>
              </div>
              {(errors.checkIn || errors.checkOut) && (
                <p role="alert" className="text-xs text-red-400 mt-2">
                  {errors.checkOut?.message ?? errors.checkIn?.message}
                </p>
              )}
              {datesValid && (
                <p className="text-xs text-admin-primary font-medium mt-2 tabular-nums">
                  {t("create.nights", { n: nights })}
                </p>
              )}
            </section>

            {/* 게스트 */}
            <section className={cardCls}>
              <span className={sectionLabel}>{t("create.guestSection")}</span>
              <div className="flex flex-col gap-4">
                <div>
                  <label htmlFor="mb-guest-name" className="text-xs text-slate-400 block mb-1.5">
                    {t("create.guestName")}
                  </label>
                  <input
                    id="mb-guest-name"
                    type="text"
                    placeholder={t("create.guestNamePlaceholder")}
                    {...register("guestName")}
                    className={inputCls}
                  />
                  {errors.guestName && (
                    <p role="alert" className="text-xs text-red-400 mt-1.5">
                      {errors.guestName.message}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <span className="text-xs text-slate-400 block mb-1.5">
                      {t("create.guestCount")}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={t("create.guestCountDec")}
                        onClick={() =>
                          setValue("guestCount", Math.max(1, Number(guestCount) - 1), {
                            shouldValidate: true,
                          })
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
                      >
                        <span className="material-symbols-outlined text-base">remove</span>
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        aria-label={t("create.guestCount")}
                        {...register("guestCount")}
                        className={`${inputCls} w-20 text-center font-bold tabular-nums [color-scheme:dark]`}
                      />
                      <button
                        type="button"
                        aria-label={t("create.guestCountInc")}
                        onClick={() =>
                          setValue("guestCount", Number(guestCount) + 1, { shouldValidate: true })
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
                      >
                        <span className="material-symbols-outlined text-base">add</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label htmlFor="mb-guest-phone" className="text-xs text-slate-400 block mb-1.5">
                      {t("create.guestPhone")}
                    </label>
                    <input
                      id="mb-guest-phone"
                      type="tel"
                      inputMode="tel"
                      placeholder={t("create.guestPhonePlaceholder")}
                      {...register("guestPhone")}
                      className={inputCls}
                    />
                  </div>
                </div>
                {overCapacity && selectedVilla && (
                  <p role="alert" className="text-xs text-amber-400 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">warning</span>
                    {t("create.capacityWarning", { max: selectedVilla.maxGuests })}
                  </p>
                )}
                {/* 조식 포함 */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={breakfast}
                    onChange={(e) => setBreakfast(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-admin-primary [color-scheme:dark]"
                  />
                  <span className="text-sm text-slate-300">{t("create.breakfast")}</span>
                </label>
              </div>
            </section>
          </div>

          {/* ── 우: 채널·판매가·상태 ── */}
          <div className="flex flex-col gap-6">
            {/* 채널 + 파트너 */}
            <section className={cardCls}>
              <span className={sectionLabel}>{t("create.channelSection")}</span>
              <div className="grid grid-cols-3 gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannel(ch)}
                    className={toggleBtn(channel === ch)}
                  >
                    {t(`channels.${ch}`)}
                  </button>
                ))}
              </div>
              {channel !== "DIRECT" && (
                <div className="mt-4 flex flex-col gap-2">
                  <label htmlFor="mb-partner" className="text-xs text-slate-400">
                    {t("create.partnerLabel")}
                  </label>
                  <select
                    id="mb-partner"
                    value={partnerId}
                    onChange={(e) => onPartnerSelect(e.target.value)}
                    className={`${inputCls} [color-scheme:dark] cursor-pointer`}
                  >
                    <option value="">{t("create.partnerPlaceholder")}</option>
                    {partnerOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.nameVi ? ` (${p.nameVi})` : ""}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="mb-agency" className="text-xs text-slate-400 mt-1">
                    {t("create.agencyNameLabel")}
                  </label>
                  <input
                    id="mb-agency"
                    type="text"
                    placeholder={t("create.agencyNamePlaceholder")}
                    {...register("agencyName")}
                    className={inputCls}
                  />
                </div>
              )}
            </section>

            {/* 판매가 */}
            <section className={cardCls}>
              <span className={sectionLabel}>{t("create.priceSection")}</span>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {CURRENCIES.map((cur) => (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setCurrency(cur)}
                    className={toggleBtn(currency === cur)}
                  >
                    {CURRENCY_SYMBOL[cur]} {cur}
                  </button>
                ))}
              </div>
              <label htmlFor="mb-price" className="text-xs text-slate-400 block mb-1.5">
                {t("create.priceLabel")}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                  {CURRENCY_SYMBOL[currency]}
                </span>
                <input
                  id="mb-price"
                  type="text"
                  inputMode="numeric"
                  placeholder={t("create.pricePlaceholder")}
                  value={totalSale ? formatThousands(totalSale) : ""}
                  onChange={(e) =>
                    setValue("totalSale", e.target.value.replace(/[^\d]/g, ""), {
                      shouldValidate: true,
                    })
                  }
                  className={`${inputCls} pl-8 font-bold tabular-nums`}
                />
              </div>
              {errors.totalSale && (
                <p role="alert" className="text-xs text-red-400 mt-1.5">
                  {errors.totalSale.message}
                </p>
              )}
            </section>

            {/* 상태 */}
            <section className={cardCls}>
              <span className={sectionLabel}>{t("create.statusSection")}</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setStatus("HOLD")}
                  className={toggleBtn(status === "HOLD")}
                >
                  {t("status.HOLD")}
                </button>
                <button
                  type="button"
                  onClick={() => setStatus("CONFIRMED")}
                  className={toggleBtn(status === "CONFIRMED")}
                >
                  {t("status.CONFIRMED")}
                </button>
              </div>
              {status === "HOLD" && (
                <div className="mt-4">
                  <label htmlFor="mb-hold" className="text-xs text-slate-400 block mb-1.5">
                    {t("create.holdExpiresLabel")}
                  </label>
                  <input
                    id="mb-hold"
                    type="datetime-local"
                    value={holdExpiresAt}
                    onChange={(e) => setHoldExpiresAt(e.target.value)}
                    className={`${inputCls} [color-scheme:dark] cursor-pointer`}
                  />
                  <div className="flex gap-2 mt-2">
                    {([24, 48] as const).map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() =>
                          setHoldExpiresAt(localDateTimeValue(new Date(Date.now() + h * 3600_000)))
                        }
                        className="flex-1 py-1.5 rounded-lg border border-slate-700 text-slate-400 text-xs font-medium hover:bg-slate-800"
                      >
                        {t("create.holdPreset", { h })}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                    {t("create.holdHint")}
                  </p>
                </div>
              )}
            </section>

            {/* 에러 + 제출 */}
            {errorMessage && (
              <p
                role="alert"
                className="bg-red-900/20 border border-red-900/40 rounded-xl p-4 text-sm text-red-300"
              >
                {errorMessage}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-admin-primary hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg"
            >
              <span className="material-symbols-outlined">add_circle</span>
              {isSubmitting ? t("create.submitting") : t("create.submit")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
