"use client";

// 관리자 수동 예약 생성 폼 (T-admin-manual-booking → 검색 패널 개편 — 운영자 다크 ko)
// 전화·Zalo로 직접 받은 예약을 운영자가 직접 기록하는 정식 경로. POST /api/bookings.
// - 흐름: 날짜(체크인/아웃) → 빌라 검색 → 게스트/채널/판매가/상태. 날짜가 공실 검색 조건이므로 먼저 입력.
// - 빌라 검색: /villas 필터 UX를 로컬 상태로 재현(라우터 이동 없음). GET /api/villas/bookable(BE)로 디바운스 조회.
//     서버가 ACTIVE + isSellable 게이트를 항상 강제(검수 게이트). ci·co 유효 시 해당 기간 공실만 반환.
// - 날짜: components/date-field.tsx DateField 필수 (iOS raw date input 공백 함정 회피).
// - 채널→통화 기본값: DIRECT=KRW, 여행사·랜드사=VND (오버라이드 허용 — KRW/VND/USD 버튼).
// - 파트너: 여행사·랜드사에서 GET /api/partners/options?type= 재사용 + agencyName 자유 텍스트 폴백.
// - 상태: 가예약(HOLD, 만료시각 필수·기본 +24h) / 확정(CONFIRMED).
// - 409 에러코드(SOLD_OUT/NOT_SELLABLE/OVER_CAPACITY/여신)별 한국어 메시지.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatThousands, formatVnd, formatKrw } from "@/lib/format";
import { DateField } from "@/components/date-field";
import { BED_TYPES } from "@/lib/bedding";
import { FEATURE_CATEGORIES, FEATURE_ITEMS } from "@/lib/features";

type Channel = "DIRECT" | "TRAVEL_AGENCY" | "LAND_AGENCY";
type Currency = "KRW" | "VND" | "USD";
type Status = "HOLD" | "CONFIRMED";

const CHANNELS: Channel[] = ["DIRECT", "TRAVEL_AGENCY", "LAND_AGENCY"];
const CURRENCIES: Currency[] = ["KRW", "VND", "USD"];
const CURRENCY_SYMBOL: Record<Currency, string> = { KRW: "₩", VND: "₫", USD: "$" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

// 상세 필터 옵션 — /villas 필터와 동일 값
const BEDROOM_OPTIONS = [1, 2, 3, 4, 5];
const GUEST_OPTIONS = [2, 4, 6, 8, 10, 12];
const BEACH_PRESETS = [100, 300, 500, 1000];

// GET /api/villas/bookable 결과 1건 (BE 계약 고정)
export interface VillaResult {
  id: string;
  name: string;
  nameVi: string | null;
  complex: string | null;
  maxGuests: number;
  bedrooms: number;
  bathrooms: number;
  hasPool: boolean;
  breakfastAvailable: boolean;
  beachDistanceM: number | null;
}

interface PartnerOption {
  id: string;
  name: string;
  nameVi: string | null;
  type: Channel;
  status: string;
}

// GET /api/bookings/quote 결과 (BE 계약 고정). BigInt(VND)는 string 직렬화.
interface QuoteRow {
  label: string | null;
  nights: number;
  saleKrwPerNight?: number;
  saleVndPerNight?: string;
  costVndPerNight: string;
}
interface Quote {
  nights: number;
  saleCurrency: Currency;
  manual?: boolean; // USD — 자동 판매가 없음(참조값만)
  rows: QuoteRow[];
  totalSaleKrw?: number;
  totalSaleVnd?: string;
  totalCostVnd: string;
  marginVnd: string | null;
  fxVndPerKrw: string | null;
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
  initialVillas,
  areaOptions,
  prefill,
}: {
  initialVillas: VillaResult[];
  areaOptions: string[];
  prefill: { villaId?: string; checkIn?: string; checkOut?: string };
}) {
  const t = useTranslations("adminBookings");
  const tf = useTranslations("adminVillas.list.filters"); // /villas 필터 라벨 재사용
  const tFeat = useTranslations("features");
  const tBed = useTranslations("bedding");
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

  const villaId = watch("villaId");
  const checkIn = watch("checkIn");
  const checkOut = watch("checkOut");
  const guestCount = watch("guestCount");
  const totalSale = watch("totalSale");

  const datesValid = DATE_RE.test(checkIn) && DATE_RE.test(checkOut) && checkIn < checkOut;
  const nights = datesValid ? nightsBetween(checkIn, checkOut) : 0;

  // ── 빌라 검색 상태 (로컬 — 라우터 이동 없음) ──
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [minBedrooms, setMinBedrooms] = useState("");
  const [minGuestsFilter, setMinGuestsFilter] = useState("");
  const [minGuestsTouched, setMinGuestsTouched] = useState(false);
  const [bedType, setBedType] = useState("");
  const [beach, setBeach] = useState("");
  const [fPool, setFPool] = useState(false);
  const [fBreakfast, setFBreakfast] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");

  // guestCount ↔ minGuests 연동: 사용자가 필터에서 직접 고르기 전에는 정원값을 검색 조건으로 사용.
  const effectiveMinGuests = minGuestsTouched
    ? minGuestsFilter
    : Number(guestCount) > 0
      ? String(guestCount)
      : "";

  // 결과·프리필
  const [results, setResults] = useState<VillaResult[]>(initialVillas);
  const [truncated, setTruncated] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedVilla, setSelectedVilla] = useState<VillaResult | null>(null);
  const [prefillMissing, setPrefillMissing] = useState(false);
  const prefillVillaId = prefill.villaId;
  const prefillHandled = useRef(false);

  const detailCount =
    (minBedrooms ? 1 : 0) +
    (minGuestsTouched && minGuestsFilter ? 1 : 0) +
    (bedType ? 1 : 0) +
    (beach ? 1 : 0) +
    (fPool ? 1 : 0) +
    (fBreakfast ? 1 : 0) +
    tags.length;

  // 검색 쿼리스트링 — /villas 파라미터 형식과 동일("1" 토글, tags 쉼표분리)
  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (area) p.set("area", area);
    if (minBedrooms) p.set("minBedrooms", minBedrooms);
    if (effectiveMinGuests) p.set("minGuests", effectiveMinGuests);
    if (bedType) p.set("bedType", bedType);
    if (beach) p.set("beach", beach);
    if (fPool) p.set("pool", "1");
    if (fBreakfast) p.set("breakfast", "1");
    if (tags.length) p.set("tags", tags.join(","));
    if (datesValid) {
      p.set("ci", checkIn);
      p.set("co", checkOut);
    }
    return p.toString();
  }, [q, area, minBedrooms, effectiveMinGuests, bedType, beach, fPool, fBreakfast, tags, datesValid, checkIn, checkOut]);

  // 디바운스 fetch (필터·날짜 변경 시). 마운트 시에도 1회 조회 → 시드(initialVillas)를 실검색으로 대체.
  useEffect(() => {
    const controller = new AbortController();
    setLoadingResults(true);
    const timer = setTimeout(() => {
      fetch(`/api/villas/bookable?${queryString}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) {
            setResults([]);
            setTruncated(false);
            setSearched(true);
            return;
          }
          const data = (await res.json()) as { villas?: VillaResult[]; truncated?: boolean };
          const villas = data.villas ?? [];
          setResults(villas);
          setTruncated(!!data.truncated);
          setSearched(true);
          // 프리필 villaId 1회 해석 — 검색 결과(날짜 공실 반영)에 있으면 선택, 없으면 안내.
          if (!prefillHandled.current && prefillVillaId) {
            prefillHandled.current = true;
            const found = villas.find((v) => v.id === prefillVillaId);
            if (found) {
              setSelectedVilla(found);
              setValue("villaId", found.id, { shouldValidate: true });
            } else {
              setPrefillMissing(true);
            }
          }
        })
        .catch(() => {
          /* abort·네트워크 오류 — 이전 결과 유지 */
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingResults(false);
        });
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [queryString, prefillVillaId, setValue]);

  const selectVilla = (v: VillaResult) => {
    setSelectedVilla(v);
    setValue("villaId", v.id, { shouldValidate: true });
    setPrefillMissing(false);
  };

  const clearSelection = () => {
    setSelectedVilla(null);
    setValue("villaId", "", { shouldValidate: true });
  };

  const toggleTag = (key: string) => {
    setTags((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };

  const resetDetail = () => {
    setMinBedrooms("");
    setMinGuestsFilter("");
    setMinGuestsTouched(false);
    setBedType("");
    setBeach("");
    setFPool(false);
    setFBreakfast(false);
    setTags([]);
  };

  // 태그 검색 필터링 — 라벨(현재 로케일) 또는 키 부분일치
  const tagQuery = tagSearch.trim().toLowerCase();
  const filteredCategories = FEATURE_CATEGORIES.map((cat) => ({
    cat,
    items: FEATURE_ITEMS[cat].filter((it) => {
      if (!tagQuery) return true;
      const label = tFeat(`items.${it.featureKey}`).toLowerCase();
      return label.includes(tagQuery) || it.featureKey.toLowerCase().includes(tagQuery);
    }),
  })).filter((g) => g.items.length > 0);

  const overCapacity =
    !!selectedVilla && Number(guestCount) > 0 && Number(guestCount) > selectedVilla.maxGuests;

  // 유령 선택 방지: 선택한 빌라가 (날짜 변경 등으로) 현재 검색 결과에서 빠지면 경고.
  //   서버 checkAvailability 가 최종 방어(409)지만, 제출 전 UX로 알린다. truncated(100+ 잘림) 시엔
  //   결과 부재가 곧 점유를 뜻하지 않으므로 오탐 방지로 경고하지 않는다.
  const selectionStale =
    !!selectedVilla &&
    searched &&
    !loadingResults &&
    !truncated &&
    !results.some((v) => v.id === selectedVilla.id);

  // ── 나머지 폼 상태 (버튼형 토글) ──
  const [channel, setChannel] = useState<Channel>("DIRECT");
  const [currency, setCurrency] = useState<Currency>("KRW");
  const [status, setStatus] = useState<Status>("CONFIRMED");
  const [partnerId, setPartnerId] = useState<string>("");
  const [holdExpiresAt, setHoldExpiresAt] = useState<string>(() =>
    localDateTimeValue(new Date(Date.now() + 24 * 3600_000))
  );
  const [breakfastIncluded, setBreakfastIncluded] = useState(false);

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

  // ── 견적 (선택 빌라 + 유효 날짜 → GET /api/bookings/quote) ──
  //   canViewFinance 게이트 페이지이므로 원가·마진 노출 허용. 통화·채널도 조회 조건.
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  // 판매가 자동 채움 추적: false면 견적 총액을 자동 반영, 사용자가 손대면 true(자동 덮어쓰기 중단).
  const [manualPrice, setManualPrice] = useState(false);

  const quoteEnabled = !!villaId && datesValid;

  useEffect(() => {
    if (!quoteEnabled) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }
    const controller = new AbortController();
    setQuoteLoading(true);
    const timer = setTimeout(() => {
      const p = new URLSearchParams({
        villaId,
        checkIn,
        checkOut,
        saleCurrency: currency,
        channel,
      });
      fetch(`/api/bookings/quote?${p.toString()}`, { signal: controller.signal })
        .then(async (res) => {
          if (res.ok) {
            const data = (await res.json()) as { quote: Quote };
            setQuote(data.quote);
            setQuoteError(null);
            return;
          }
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setQuote(null);
          setQuoteError(data.error ?? (res.status === 409 ? "RATE_NOT_SET" : "GENERIC"));
        })
        .catch(() => {
          /* abort·네트워크 오류 — 직전 견적 유지 */
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuoteLoading(false);
        });
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [quoteEnabled, villaId, checkIn, checkOut, currency, channel]);

  // 자동 채움: 추적 상태(manualPrice=false)에서 견적이 도착하면 통화 일치 총액을 입력.
  //   USD(manual)는 자동가가 없으므로 값 비움(참조 환산만 표시, 사용자가 직접 입력).
  useEffect(() => {
    if (!quote || manualPrice) return;
    if (quote.manual) {
      setValue("totalSale", "", { shouldValidate: true });
      return;
    }
    const total =
      quote.saleCurrency === "KRW"
        ? quote.totalSaleKrw
        : quote.saleCurrency === "VND"
          ? quote.totalSaleVnd
          : undefined;
    if (total != null) setValue("totalSale", String(total), { shouldValidate: true });
  }, [quote, manualPrice, setValue]);

  // 현재 통화의 견적 총액(자동가) — 자동 채움 뱃지·"견적가 적용" 버튼 판정용.
  const autoTotal =
    quote && !quote.manual
      ? currency === "KRW"
        ? quote.totalSaleKrw != null
          ? String(quote.totalSaleKrw)
          : null
        : currency === "VND"
          ? quote.totalSaleVnd ?? null
          : null
      : null;

  const applyQuotePrice = () => {
    if (autoTotal == null) return;
    setValue("totalSale", autoTotal, { shouldValidate: true });
    setManualPrice(false);
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
          breakfastIncluded,
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
  const selectBox =
    "cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-admin-primary [color-scheme:dark]";

  const toggleBtn = (active: boolean) =>
    active
      ? "px-3 py-2.5 rounded-xl border border-admin-primary bg-admin-primary/10 text-admin-primary font-bold text-sm"
      : "px-3 py-2.5 rounded-xl border border-slate-700 text-slate-400 font-medium text-sm hover:border-slate-600 hover:bg-slate-800/30 transition-colors";

  const filterToggle = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "border-admin-primary bg-admin-primary/10 text-admin-primary"
        : "border-slate-700 text-slate-400 hover:text-white"
    }`;

  /** 빌라 메타 뱃지 행 (결과 카드·선택 요약 공용) */
  const VillaMeta = ({ v }: { v: VillaResult }) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-admin-muted">
      <span className="inline-flex items-center gap-0.5">
        <span className="material-symbols-outlined text-[14px]">bed</span>
        {t("create.bedroomsBadge", { n: v.bedrooms })}
      </span>
      <span className="inline-flex items-center gap-0.5">
        <span className="material-symbols-outlined text-[14px]">bathtub</span>
        {t("create.bathroomsBadge", { n: v.bathrooms })}
      </span>
      <span className="inline-flex items-center gap-0.5">
        <span className="material-symbols-outlined text-[14px]">group</span>
        {t("create.maxGuests", { n: v.maxGuests })}
      </span>
      {v.beachDistanceM != null && (
        <span className="inline-flex items-center gap-0.5">
          <span className="material-symbols-outlined text-[14px]">beach_access</span>
          {t("create.beachBadge", { m: v.beachDistanceM })}
        </span>
      )}
      {v.hasPool && <span className="material-symbols-outlined text-[14px]">pool</span>}
      {v.breakfastAvailable && (
        <span className="material-symbols-outlined text-[14px]">restaurant</span>
      )}
    </div>
  );

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

      {initialVillas.length === 0 ? (
        <div className="bg-admin-card border border-slate-800 rounded-2xl p-12 text-center text-sm text-slate-400">
          {t("create.noVillas")}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-6 [&_input]:scroll-mb-24 [&_select]:scroll-mb-24"
        >
          {/* ── 일정 (검색 조건 — 빌라보다 먼저) ── */}
          <section className={cardCls}>
            <span className={sectionLabel}>{t("create.datesSection")}</span>
            <div className="grid grid-cols-2 gap-3 max-w-md">
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
            {datesValid ? (
              <p className="text-xs text-admin-primary font-medium mt-2 tabular-nums">
                {t("create.nights", { n: nights })}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500 mt-2">{t("create.vacancyHint")}</p>
            )}
          </section>

          {/* ── 빌라 검색 ── */}
          <section className={cardCls}>
            <span className={sectionLabel}>{t("create.searchSection")}</span>

            {/* 선택 요약 (패널 접혀도 상단 노출) */}
            {selectedVilla && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-admin-primary bg-admin-primary/10 p-4">
                <div className="min-w-0">
                  {selectedVilla.complex && (
                    <span className="block text-[10px] uppercase tracking-wider font-bold text-admin-primary/80 truncate">
                      {selectedVilla.complex}
                    </span>
                  )}
                  <p className="font-bold text-white truncate">{selectedVilla.name}</p>
                  <div className="mt-1">
                    <VillaMeta v={selectedVilla} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-admin-primary px-3 py-1.5 text-xs font-bold text-admin-primary hover:bg-admin-primary/10"
                >
                  <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                  {t("create.changeVilla")}
                </button>
              </div>
            )}
            {errors.villaId && !selectedVilla && (
              <p role="alert" className="text-xs text-red-400 mb-3">
                {errors.villaId.message}
              </p>
            )}
            {prefillMissing && (
              <p role="alert" className="mb-3 text-xs text-amber-400 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">warning</span>
                {t("create.prefillMissing")}
              </p>
            )}
            {selectionStale && (
              <p role="alert" className="mb-3 text-xs text-amber-400 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">warning</span>
                {t("create.selectionStale")}
              </p>
            )}

            {/* 상단줄 — 검색어 + 지역 + 상세 토글 */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[220px]">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  search
                </span>
                <input
                  className={`${inputCls} pl-9`}
                  placeholder={t("create.searchPlaceholder")}
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              {areaOptions.length > 0 && (
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {tf("area")}
                  </span>
                  <select
                    aria-label={tf("area")}
                    className={selectBox}
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                  >
                    <option value="">{tf("allAreas")}</option>
                    {areaOptions.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="button"
                aria-expanded={detailOpen}
                onClick={() => setDetailOpen((v) => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  detailOpen || detailCount > 0
                    ? "border-admin-primary text-admin-primary"
                    : "border-slate-700 text-slate-300 hover:text-white"
                }`}
              >
                <span className="material-symbols-outlined text-sm">tune</span>
                {tf("detailToggle")}
                {detailCount > 0 && (
                  <span className="ml-0.5 rounded bg-admin-primary px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                    {detailCount}
                  </span>
                )}
              </button>
            </div>

            {/* 접이식 상세 패널 */}
            {detailOpen && (
              <div className="mt-3 flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  {/* 침실 이상 */}
                  <label className="flex items-center gap-2 text-sm text-slate-400">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {tf("minBedrooms")}
                    </span>
                    <select
                      aria-label={tf("minBedrooms")}
                      className={selectBox}
                      value={minBedrooms}
                      onChange={(e) => setMinBedrooms(e.target.value)}
                    >
                      <option value="">{tf("any")}</option>
                      {BEDROOM_OPTIONS.map((n) => (
                        <option key={n} value={String(n)}>
                          {tf("bedroomsOption", { n })}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* 인원 이상 (guestCount 연동) */}
                  <label className="flex items-center gap-2 text-sm text-slate-400">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {tf("minGuests")}
                    </span>
                    <select
                      aria-label={tf("minGuests")}
                      className={selectBox}
                      value={minGuestsTouched ? minGuestsFilter : ""}
                      onChange={(e) => {
                        setMinGuestsTouched(true);
                        setMinGuestsFilter(e.target.value);
                      }}
                    >
                      <option value="">{tf("any")}</option>
                      {GUEST_OPTIONS.map((n) => (
                        <option key={n} value={String(n)}>
                          {tf("guestsOption", { n })}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* 침대 종류 */}
                  <label className="flex items-center gap-2 text-sm text-slate-400">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {tf("bedType")}
                    </span>
                    <select
                      aria-label={tf("bedType")}
                      className={selectBox}
                      value={bedType}
                      onChange={(e) => setBedType(e.target.value)}
                    >
                      <option value="">{tf("any")}</option>
                      {BED_TYPES.map((b) => (
                        <option key={b} value={b}>
                          {tBed(b)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* 해변거리 이내 */}
                  <label className="flex items-center gap-2 text-sm text-slate-400">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {tf("beach")}
                    </span>
                    <select
                      aria-label={tf("beach")}
                      className={selectBox}
                      value={beach}
                      onChange={(e) => setBeach(e.target.value)}
                    >
                      <option value="">{tf("any")}</option>
                      {BEACH_PRESETS.map((m) => (
                        <option key={m} value={String(m)}>
                          {tf("beachOption", { m })}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* guestCount 연동 안내 (미터치 시) */}
                {!minGuestsTouched && Number(guestCount) > 0 && (
                  <p className="text-[11px] text-slate-500">
                    {t("create.minGuestsAuto", { n: Number(guestCount) })}
                  </p>
                )}

                {/* 불리언 토글 (수영장·조식) */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={fPool}
                    onClick={() => setFPool((v) => !v)}
                    className={filterToggle(fPool)}
                  >
                    <span className="material-symbols-outlined text-[16px]">pool</span>
                    {tf("pool")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={fBreakfast}
                    onClick={() => setFBreakfast((v) => !v)}
                    className={filterToggle(fBreakfast)}
                  >
                    <span className="material-symbols-outlined text-[16px]">restaurant</span>
                    {tf("breakfast")}
                  </button>
                </div>

                {/* 셀링포인트 태그 — 검색형 멀티셀렉트 */}
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {tf("tags")}
                  </span>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => toggleTag(k)}
                          className="inline-flex items-center gap-1 rounded-full bg-admin-primary/15 px-2.5 py-1 text-xs font-medium text-admin-primary"
                        >
                          {tFeat(`items.${k}`)}
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder={tf("tagsPlaceholder")}
                    className="w-full max-w-xs bg-slate-900 border border-slate-700 text-sm text-slate-300 rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary"
                  />
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 p-2 flex flex-col gap-2">
                    {filteredCategories.map(({ cat, items }) => (
                      <div key={cat} className="flex flex-col gap-1">
                        <span className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          {tFeat(`categories.${cat}`)}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {items.map((it) => {
                            const on = tags.includes(it.featureKey);
                            return (
                              <button
                                key={it.featureKey}
                                type="button"
                                aria-pressed={on}
                                onClick={() => toggleTag(it.featureKey)}
                                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                                  on
                                    ? "border-admin-primary bg-admin-primary/10 text-admin-primary"
                                    : "border-slate-700 text-slate-400 hover:text-white"
                                }`}
                              >
                                <span className="material-symbols-outlined text-[14px]">
                                  {it.icon}
                                </span>
                                {tFeat(`items.${it.featureKey}`)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {detailCount > 0 && (
                  <button
                    type="button"
                    className="self-start flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm"
                    onClick={resetDetail}
                  >
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    {tf("resetDetail")}
                  </button>
                )}
              </div>
            )}

            {/* 결과 목록 */}
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
                {loadingResults ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    {t("create.searching")}
                  </span>
                ) : (
                  <span>{t("create.resultCount", { n: results.length })}</span>
                )}
                {truncated && !loadingResults && (
                  <span className="text-amber-400">· {t("create.truncatedNote")}</span>
                )}
              </div>
              {results.length === 0 && searched && !loadingResults ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
                  {t("create.noResults")}
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[440px] overflow-y-auto pr-1">
                  {results.map((v) => {
                    const active = v.id === villaId;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => selectVilla(v)}
                        className={`text-left rounded-xl border p-3 transition-colors ${
                          active
                            ? "border-admin-primary bg-admin-primary/10"
                            : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            {v.complex && (
                              <span className="block text-[10px] uppercase tracking-wider font-bold text-admin-muted truncate">
                                {v.complex}
                              </span>
                            )}
                            <p className="font-bold text-white truncate">{v.name}</p>
                            {v.nameVi && v.nameVi !== v.name && (
                              <p className="text-[11px] text-admin-muted truncate">{v.nameVi}</p>
                            )}
                          </div>
                          {active && (
                            <span className="material-symbols-outlined shrink-0 text-admin-primary">
                              check_circle
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5">
                          <VillaMeta v={v} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ── 게스트 / 채널·판매가·상태 (2단) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* 좌: 게스트 */}
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
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={breakfastIncluded}
                    onChange={(e) => setBreakfastIncluded(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-admin-primary [color-scheme:dark]"
                  />
                  <span className="text-sm text-slate-300">{t("create.breakfast")}</span>
                </label>
              </div>
            </section>

            {/* 우: 채널·판매가·상태 */}
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

              {/* 견적 (선택 빌라 + 유효 날짜 시) */}
              {quoteEnabled && (
                <section className={cardCls}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className={`${sectionLabel} mb-0`}>{t("create.quote.title")}</span>
                    {quoteLoading && quote && (
                      <span className="material-symbols-outlined text-sm text-slate-500 animate-spin">
                        progress_activity
                      </span>
                    )}
                  </div>

                  {quoteError ? (
                    quoteError === "RATE_NOT_SET" ? (
                      <div className="flex flex-col gap-3">
                        <p className="flex items-start gap-2 text-sm text-amber-300">
                          <span className="material-symbols-outlined text-base">warning</span>
                          {t("create.errors.RATE_NOT_SET")}
                        </p>
                        <Link
                          href={`/villas/${villaId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="self-start inline-flex items-center gap-1.5 rounded-lg border border-admin-primary px-3 py-1.5 text-xs font-bold text-admin-primary hover:bg-admin-primary/10"
                        >
                          <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                          {t("create.quote.openVillaSalesInfo")}
                        </Link>
                      </div>
                    ) : (
                      <p className="flex items-center gap-2 text-sm text-slate-400">
                        <span className="material-symbols-outlined text-base">error</span>
                        {quoteError === "VILLA_NOT_FOUND"
                          ? t("create.errors.VILLA_NOT_FOUND")
                          : t("create.quote.loadError")}
                      </p>
                    )
                  ) : quote ? (
                    <>
                      {/* 헤더 — 총 판매가(또는 USD 참조 환산) */}
                      {quote.manual ? (
                        <div className="mb-4">
                          <p className="flex items-center gap-1.5 text-sm text-amber-300">
                            <span className="material-symbols-outlined text-base">info</span>
                            {t("create.quote.manualUsdNote")}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                            <div>
                              <span className="block text-[11px] text-slate-500">
                                {t("create.quote.referenceTotal")} · VND
                              </span>
                              <p className="text-lg font-bold text-white tabular-nums">
                                {quote.totalSaleVnd != null ? formatVnd(quote.totalSaleVnd) : "—"}
                              </p>
                            </div>
                            <div>
                              <span className="block text-[11px] text-slate-500">
                                {t("create.quote.referenceTotal")} · KRW
                              </span>
                              <p className="text-lg font-bold text-white tabular-nums">
                                {quote.totalSaleKrw != null ? formatKrw(quote.totalSaleKrw) : "—"}
                              </p>
                            </div>
                            <div className="ml-auto self-end">
                              <span className="text-sm font-medium text-admin-primary tabular-nums">
                                {t("create.nights", { n: quote.nights })}
                              </span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mb-4 flex items-baseline justify-between gap-3">
                          <div>
                            <span className="block text-[11px] text-slate-500">
                              {t("create.quote.totalSaleLabel")}
                            </span>
                            <p className="text-2xl font-bold text-white tabular-nums">
                              {currency === "KRW"
                                ? quote.totalSaleKrw != null
                                  ? formatKrw(quote.totalSaleKrw)
                                  : "—"
                                : quote.totalSaleVnd != null
                                  ? formatVnd(quote.totalSaleVnd)
                                  : "—"}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-medium text-admin-primary tabular-nums">
                            {t("create.nights", { n: quote.nights })}
                          </span>
                        </div>
                      )}

                      {/* 박별 요율 구성 */}
                      <ul className="flex flex-col gap-1.5 border-t border-slate-800 pt-3">
                        {quote.rows.map((row, i) => {
                          const per =
                            currency === "KRW"
                              ? row.saleKrwPerNight != null
                                ? formatKrw(row.saleKrwPerNight)
                                : null
                              : row.saleVndPerNight != null
                                ? formatVnd(row.saleVndPerNight)
                                : null;
                          return (
                            <li
                              key={i}
                              className="flex items-center justify-between gap-2 text-sm"
                            >
                              <span className="truncate text-slate-400">
                                {row.label
                                  ? t(`create.quote.seasons.${row.label}` as "create.quote.seasons.LOW")
                                  : t("create.quote.baseRate")}
                              </span>
                              <span className="shrink-0 tabular-nums text-slate-300">
                                {per ?? "—"}{" "}
                                <span className="text-slate-500">
                                  × {t("create.nights", { n: row.nights })}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>

                      {/* 원가 · 예상 마진 */}
                      <div className="mt-3 flex flex-col gap-1.5 border-t border-slate-800 pt-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">
                            {t("create.quote.totalCostLabel")}
                          </span>
                          <span className="tabular-nums text-slate-300">
                            {formatVnd(quote.totalCostVnd)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">{t("create.quote.marginLabel")}</span>
                          {quote.marginVnd != null ? (
                            <span
                              className={`font-bold tabular-nums ${
                                quote.marginVnd.startsWith("-")
                                  ? "text-red-400"
                                  : "text-emerald-400"
                              }`}
                            >
                              {formatVnd(quote.marginVnd)}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">
                              {t("create.quote.marginUnknown")}
                            </span>
                          )}
                        </div>
                        {quote.fxVndPerKrw && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">{t("create.quote.fxLabel")}</span>
                            <span className="text-xs tabular-nums text-slate-400">
                              {formatThousands(quote.fxVndPerKrw)}₫ / ₩1
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 견적가 적용 (수동 수정 상태에서만) */}
                      {manualPrice && autoTotal != null && totalSale !== autoTotal && (
                        <button
                          type="button"
                          onClick={applyQuotePrice}
                          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-admin-primary px-3 py-1.5 text-xs font-bold text-admin-primary hover:bg-admin-primary/10"
                        >
                          <span className="material-symbols-outlined text-[15px]">
                            auto_fix_high
                          </span>
                          {t("create.quote.applyToPrice", {
                            price:
                              currency === "KRW"
                                ? formatKrw(Number(autoTotal))
                                : formatVnd(autoTotal),
                          })}
                        </button>
                      )}
                    </>
                  ) : (
                    /* 로딩 스켈레톤 (최초 조회) */
                    <div className="flex animate-pulse flex-col gap-3">
                      <div className="h-7 w-40 rounded bg-slate-800" />
                      <div className="h-4 w-full rounded bg-slate-800/70" />
                      <div className="h-4 w-3/4 rounded bg-slate-800/70" />
                      <div className="h-4 w-1/2 rounded bg-slate-800/70" />
                    </div>
                  )}
                </section>
              )}

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
                    onChange={(e) => {
                      setManualPrice(true);
                      setValue("totalSale", e.target.value.replace(/[^\d]/g, ""), {
                        shouldValidate: true,
                      });
                    }}
                    className={`${inputCls} pl-8 font-bold tabular-nums`}
                  />
                  {/* 자동 채움 상태 뱃지 (견적가 그대로 적용됨) */}
                  {!manualPrice && autoTotal != null && totalSale === autoTotal && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-full bg-admin-primary/15 px-2 py-0.5 text-[10px] font-bold text-admin-primary">
                      <span className="material-symbols-outlined text-[13px]">bolt</span>
                      {t("create.quote.autoFilledBadge")}
                    </span>
                  )}
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
          </div>
        </form>
      )}
    </div>
  );
}
