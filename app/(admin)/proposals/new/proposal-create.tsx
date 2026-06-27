"use client";

// 제안 만들기 (T2.1 — Stitch b2-proposal-create 변환, 3패널 → 모바일 세로 스택)
// - 채널→통화 자동 전환 (ADR-0003): 직접=KRW(쉼표+원), 여행사·랜드사=VND(쉼표+₫) — 오버라이드 UI 없음
// - 후보: GET /api/proposals/candidates (날짜·통화 변경 시 재조회), warnings는 안내 배너
// - 마진 요약: VND 채널 = Σ판매가−Σ원가 정확값 / KRW 채널 = FX_VND_PER_KRW 참고 환산 (미설정 시 행 숨김)
// - 인원 입력은 스키마 무필드로 제외 (계약 합의 편차, IDEAS 등재)
// - 금액 규칙: VND는 BigInt 합산 — 부동소수점 금지 (KRW 환산 참고치만 표시용 Number 허용)
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatThousands, formatVnd } from "@/lib/format";

type Channel = "TRAVEL_AGENCY" | "LAND_AGENCY" | "DIRECT";
// 표시 순서: 랜드사 → 여행사 → 직접 (기본값 랜드사)
const CHANNELS: Channel[] = ["LAND_AGENCY", "TRAVEL_AGENCY", "DIRECT"];

// 파트너 드롭다운에서 "직접 입력(일반 소비자)"를 고른 sentinel 값
const DIRECT_CUSTOMER = "__direct__";

interface PartnerOption {
  id: string;
  name: string;
  nameVi: string | null;
  type: Channel;
  status: string;
}

interface Candidate {
  id: string;
  name: string;
  complex: string | null;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  hasPool: boolean;
  breakfastAvailable: boolean;
  qualityScore: number; // 청소 검수 통과율(0~100) — 후순위 정렬·표시 (Phase 2)
  photoUrl: string | null;
  nights: number;
  totalSaleKrw: number | null;
  totalSaleVnd: string | null; // BigInt 직렬화 — 문자열
  totalSaleUsd: number | null; // USD는 수동입력 — 후보 단계에선 항상 null (Phase 2)
  totalSupplierCostVnd: string; // ADMIN 전용 — 마진 계산용
}

interface CandidateWarning {
  villaId: string;
  name: string;
  reason: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round(
    (new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) /
      DAY_MS
  );
}

export default function ProposalCreate() {
  const t = useTranslations("adminProposals.create");
  const locale = useLocale();
  const router = useRouter();

  // 네이티브 date 입력칸 어디를 눌러도 달력이 열리도록 (아이콘 외 영역 클릭 포함)
  const openDatePicker = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      e.currentTarget.showPicker?.();
    } catch {
      // showPicker 미지원·비활성 컨텍스트는 무시(기본 동작 유지)
    }
  };

  const formSchema = useMemo(
    () =>
      z
        .object({
          clientName: z.string().trim().min(1, t("clientNameRequired")),
          checkIn: z.string().regex(DATE_RE, t("selectDatesFirst")),
          checkOut: z.string().regex(DATE_RE, t("selectDatesFirst")),
          channel: z.enum(["TRAVEL_AGENCY", "LAND_AGENCY", "DIRECT"]),
          partnerId: z.string(), // "" = 일반 소비자(자유 텍스트), 그 외 = 파트너 id
          expiresInHours: z.union([z.literal(24), z.literal(48)]),
        })
        .refine((v) => !DATE_RE.test(v.checkIn) || !DATE_RE.test(v.checkOut) || v.checkIn < v.checkOut, {
          message: t("dateOrderError"),
          path: ["checkOut"],
        }),
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
      clientName: "",
      checkIn: "",
      checkOut: "",
      channel: "LAND_AGENCY", // 기본 랜드사
      partnerId: "",
      expiresInHours: 48, // 기본 48h (계약)
    },
  });

  const checkIn = watch("checkIn");
  const checkOut = watch("checkOut");
  const channel = watch("channel");
  const partnerId = watch("partnerId");
  const expiresInHours = watch("expiresInHours");

  // 채널 → 통화 자동 (ADR-0003): DIRECT→KRW, 여행사·랜드사→VND.
  // Phase 2: ADMIN이 USD 토글을 켜면 통화를 USD로 오버라이드(요율표 자동견적 없음 → 수동 입력).
  const [usdMode, setUsdMode] = useState(false);
  const baseCurrency: "KRW" | "VND" = channel === "DIRECT" ? "KRW" : "VND";
  const currency: "KRW" | "VND" | "USD" = usdMode ? "USD" : baseCurrency;
  const datesValid = DATE_RE.test(checkIn) && DATE_RE.test(checkOut) && checkIn < checkOut;
  const nights = datesValid ? nightsBetween(checkIn, checkOut) : 0;

  // ----- 후보 조회 -----
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [warnings, setWarnings] = useState<CandidateWarning[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [maxHint, setMaxHint] = useState(false);
  // Phase 2 USD: 빌라별 수동 USD 총액 입력값(문자열, 정수 달러). villaId → "1500"
  const [usdTotals, setUsdTotals] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!datesValid) {
      setCandidates(null);
      setWarnings([]);
      setSelectedIds([]);
      return;
    }
    const controller = new AbortController();
    setCandidatesLoading(true);
    setCandidatesError(false);
    (async () => {
      try {
        const res = await fetch(
          `/api/proposals/candidates?checkIn=${checkIn}&checkOut=${checkOut}&saleCurrency=${currency}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          candidates: Candidate[];
          warnings: CandidateWarning[];
        };
        setCandidates(data.candidates);
        setWarnings(data.warnings);
        // 조건 변경으로 사라진 후보는 선택에서 제거
        setSelectedIds((prev) => prev.filter((id) => data.candidates.some((c) => c.id === id)));
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setCandidates([]);
        setWarnings([]);
        setCandidatesError(true);
      } finally {
        if (!controller.signal.aborted) setCandidatesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [datesValid, checkIn, checkOut, currency]);

  // ----- 환율 칩 (GET /api/settings — FX_VND_PER_KRW, 미설정 null) -----
  const [fx, setFx] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = (await res.json()) as { settings: Record<string, string | null> };
        const raw = data.settings.FX_VND_PER_KRW;
        const parsed = raw ? Number(raw) : NaN;
        setFx(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
      } catch {
        // 미설정과 동일 취급 — 칩에 "환율 미설정" 표시
      }
    })();
  }, []);

  // ----- 파트너 옵션 (채널=여행사·랜드사일 때 GET /api/partners/options?type=) -----
  const [partnerOptions, setPartnerOptions] = useState<PartnerOption[]>([]);
  // 여행사·랜드사 채널에서 "직접 입력(일반 소비자)"를 명시 선택했는지 (DIRECT 채널은 항상 직접 입력)
  const [directCustomer, setDirectCustomer] = useState(false);

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
        // 차단(BLOCKED) 파트너는 신규 제안 대상에서 제외
        setPartnerOptions(data.partners.filter((p) => p.status !== "BLOCKED"));
      } catch {
        setPartnerOptions([]);
      }
    })();
    return () => controller.abort();
  }, [channel]);

  // 채널이 바뀌면 파트너·고객명 선택을 초기화 (유형별 파트너 목록이 달라짐)
  useEffect(() => {
    setValue("partnerId", "");
    setValue("clientName", "");
    setDirectCustomer(false);
  }, [channel, setValue]);

  // 파트너 드롭다운 변경 — 파트너 선택 시 clientName 자동 채움, "직접 입력"이면 텍스트칸 노출
  const onPartnerSelect = (value: string) => {
    if (value === DIRECT_CUSTOMER) {
      setDirectCustomer(true);
      setValue("partnerId", "");
      setValue("clientName", "", { shouldValidate: true });
      return;
    }
    const p = partnerOptions.find((o) => o.id === value);
    setDirectCustomer(false);
    setValue("partnerId", value);
    setValue("clientName", p ? p.name : "", { shouldValidate: true });
  };

  // 자유 텍스트 입력칸 노출 조건: DIRECT 채널이거나, 여행사·랜드사에서 "직접 입력" 선택 시
  const showClientNameInput = channel === "DIRECT" || directCustomer;
  // 파트너 드롭다운의 현재 값 (선택된 파트너 id, 직접입력이면 sentinel, 미선택이면 "")
  const partnerSelectValue = partnerId ? partnerId : directCustomer ? DIRECT_CUSTOMER : "";

  const toggleVilla = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((v) => v !== id));
      return;
    }
    if (selectedIds.length >= 3) {
      // 최대 3개 (계약 완료 기준 3)
      setMaxHint(true);
      setTimeout(() => setMaxHint(false), 2500);
      return;
    }
    setSelectedIds([...selectedIds, id]);
  };

  const selected = useMemo(
    () => (candidates ?? []).filter((c) => selectedIds.includes(c.id)),
    [candidates, selectedIds]
  );

  // USD 입력 파서 — 숫자만, 양의 정수만 유효(아니면 0). 표시·합계용.
  const parseUsd = (id: string): number => {
    const raw = usdTotals[id];
    if (!raw) return 0;
    const n = Number(raw.replace(/[^\d]/g, ""));
    return Number.isInteger(n) && n > 0 ? n : 0;
  };

  // ----- 요약 합계 (VND는 BigInt — 부동소수점 금지) -----
  const totals = useMemo(() => {
    const saleVnd = selected.reduce((sum, c) => sum + BigInt(c.totalSaleVnd ?? "0"), 0n);
    const saleKrw = selected.reduce((sum, c) => sum + (c.totalSaleKrw ?? 0), 0);
    const saleUsd = selected.reduce((sum, c) => sum + parseUsd(c.id), 0); // USD 정수 합
    const costVnd = selected.reduce((sum, c) => sum + BigInt(c.totalSupplierCostVnd), 0n);
    return { saleVnd, saleKrw, saleUsd, costVnd };
    // usdTotals 변경 시 재계산 필요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, usdTotals]);

  const totalSaleLabel =
    currency === "VND"
      ? formatVnd(totals.saleVnd)
      : currency === "USD"
        ? `$${formatThousands(totals.saleUsd)}`
        : `${formatThousands(totals.saleKrw)}원`;
  // 마진: VND 채널 = 정확값(BigInt). KRW 채널 = fx 참고 환산 — 표시 전용 (정확 마진은 Phase 2 리포트)
  const marginVnd = totals.saleVnd - totals.costVnd;
  const marginKrwRef =
    fx !== null ? Math.round(totals.saleKrw - Number(totals.costVnd) / fx) : null;
  const fxChipLabel =
    fx !== null
      ? t("fxChip", { krw: formatThousands(Math.round(1_000_000 / fx)) })
      : t("fxMissing");

  const stayAmountLabel = (c: Candidate) =>
    currency === "VND"
      ? formatVnd(c.totalSaleVnd ?? "0")
      : currency === "USD"
        ? `$${formatThousands(parseUsd(c.id))}` // 수동 입력 USD 총액
        : `${formatThousands(c.totalSaleKrw ?? 0)}원`;

  // ----- 생성 -----
  const [failures, setFailures] = useState<{ name: string; reason: string }[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const onSubmit = async (values: FormValues) => {
    if (selected.length === 0) return;
    setFailures(null);
    setSubmitError(null);
    // USD 모드: 선택된 빌라마다 양의 정수 USD 총액이 있어야 함
    if (currency === "USD" && selectedIds.some((id) => parseUsd(id) <= 0)) {
      setSubmitError(t("usdTotalRequired"));
      return;
    }
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: values.clientName,
          channel: values.channel,
          // Phase 2: USD 토글 시 통화 명시 전달(미전송 시 채널 기본값 KRW/VND)
          saleCurrency: currency === "USD" ? "USD" : undefined,
          // 파트너 연결(선택) — DIRECT 채널·일반 소비자면 미전송
          partnerId: values.channel !== "DIRECT" && values.partnerId ? values.partnerId : undefined,
          expiresInHours: values.expiresInHours,
          items: selectedIds.map((villaId) => ({
            villaId,
            checkIn: values.checkIn,
            checkOut: values.checkOut,
            // USD 모드일 때만 수동 입력 총액 포함
            ...(currency === "USD" ? { totalUsd: parseUsd(villaId) } : {}),
          })),
        }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as { proposal: { token: string } };
        setCreatedToken(data.proposal.token);
        return;
      }
      if (res.status === 409) {
        // items_unavailable — 항목별 사유 그대로 안내 (계약 완료 기준 3)
        const data = (await res.json()) as {
          failures: { villaId: string; reason: string }[];
        };
        setFailures(
          data.failures.map((f) => ({
            name: candidates?.find((c) => c.id === f.villaId)?.name ?? f.villaId,
            reason: f.reason,
          }))
        );
        return;
      }
      setSubmitError(t("submitError"));
    } catch {
      setSubmitError(t("submitError"));
    }
  };

  const copyCreatedLink = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${createdToken}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // 클립보드 거부 — 링크가 화면에 노출되어 있어 수동 복사 가능
    }
  };

  const sectionLabel = "text-xs font-bold text-slate-500 uppercase tracking-wider block mb-3";

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">{t("title")}</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col xl:flex-row gap-6 items-start">
        {/* ───────── 패널 1: 일정·채널 (b2 좌측) ───────── */}
        <section className="w-full xl:w-72 shrink-0 flex flex-col gap-8">
          <div>
            <span className={sectionLabel}>{t("scheduleSection")}</span>
            <div className="space-y-3">
              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                <label
                  htmlFor="proposal-check-in"
                  className="flex items-center gap-2 mb-2 text-xs text-admin-muted"
                >
                  <span className="material-symbols-outlined text-blue-400 text-base">
                    calendar_month
                  </span>
                  {t("checkIn")}
                </label>
                <input
                  id="proposal-check-in"
                  type="date"
                  lang={locale}
                  onClick={openDatePicker}
                  {...register("checkIn")}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-100 tabular-nums [color-scheme:dark] cursor-pointer"
                />
              </div>
              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                <label
                  htmlFor="proposal-check-out"
                  className="flex items-center gap-2 mb-2 text-xs text-admin-muted"
                >
                  <span className="material-symbols-outlined text-blue-400 text-base">
                    event_available
                  </span>
                  {t("checkOut")}
                </label>
                <input
                  id="proposal-check-out"
                  type="date"
                  lang={locale}
                  onClick={openDatePicker}
                  {...register("checkOut")}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-100 tabular-nums [color-scheme:dark] cursor-pointer"
                />
              </div>
              {(errors.checkIn || errors.checkOut) && (
                <p role="alert" className="text-xs text-red-400 px-1">
                  {errors.checkOut?.message ?? errors.checkIn?.message}
                </p>
              )}
              {datesValid && (
                <p className="text-xs text-blue-400 font-medium px-1 tabular-nums">
                  {t("nights", { nights })}
                </p>
              )}
            </div>
          </div>

          <div className="bg-indigo-500/10 p-4 rounded-xl border border-indigo-500/20 text-xs text-indigo-300 leading-relaxed">
            <span className="material-symbols-outlined text-sm mb-1 block">info</span>
            {t("conditionHint")}
          </div>
        </section>

        {/* ───────── 패널 2: 판매 가능 빌라 (b2 중앙) ───────── */}
        <section className="w-full xl:flex-1 min-w-0 flex flex-col gap-4">
          <div>
            <h2 className="text-admin-muted text-sm font-medium">{t("results")}</h2>
            {candidates !== null && !candidatesLoading && !candidatesError && (
              <p className="text-slate-100 font-bold">
                {t("resultsCount", { count: candidates.length })}
              </p>
            )}
          </div>

          {/* 요율 미설정 빌라 안내 배너 (warnings) */}
          {warnings.length > 0 && (
            <div className="bg-amber-900/20 border border-amber-900/40 rounded-xl p-4 text-xs text-admin-pending space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">warning</span>
                {t("warningsTitle")}
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-200/80">
                {warnings.map((w) => (
                  <li key={w.villaId}>
                    {w.name} — {w.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!datesValid ? (
            <div className="bg-slate-800/20 border border-slate-800 rounded-2xl p-12 text-center text-sm text-admin-muted">
              {t("selectDatesFirst")}
            </div>
          ) : candidatesLoading ? (
            <div className="bg-slate-800/20 border border-slate-800 rounded-2xl p-12 flex flex-col items-center gap-3 text-sm text-admin-muted">
              <span
                className="w-6 h-6 border-2 border-slate-600 border-t-admin-primary rounded-full animate-spin"
                aria-hidden
              />
              {t("loadingCandidates")}
            </div>
          ) : candidatesError ? (
            <div className="bg-slate-800/20 border border-slate-800 rounded-2xl p-12 text-center text-sm text-red-400">
              {t("candidatesError")}
            </div>
          ) : (candidates ?? []).length === 0 ? (
            <div className="bg-slate-800/20 border border-slate-800 rounded-2xl p-12 text-center text-sm text-admin-muted">
              {t("emptyCandidates")}
            </div>
          ) : (
            <div className="space-y-4">
              {maxHint && (
                <p role="alert" className="text-xs text-admin-pending font-medium">
                  {t("maxSelected")}
                </p>
              )}
              {(candidates ?? []).map((c) => {
                const isSelected = selectedIds.includes(c.id);
                return (
                  <div
                    key={c.id}
                    role="checkbox"
                    aria-checked={isSelected ? "true" : "false"}
                    tabIndex={0}
                    onClick={() => toggleVilla(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleVilla(c.id);
                      }
                    }}
                    className={`p-4 rounded-2xl flex gap-4 sm:gap-5 cursor-pointer transition-all ${
                      isSelected
                        ? "border-2 border-admin-primary bg-blue-500/5 shadow-xl"
                        : "border border-slate-800 bg-slate-800/20 hover:border-slate-700 hover:bg-slate-800/40"
                    }`}
                  >
                    <div className="relative w-24 h-24 sm:w-40 sm:h-28 rounded-xl overflow-hidden shrink-0 bg-slate-800">
                      {c.photoUrl ? (
                        <Image
                          src={c.photoUrl}
                          alt={c.name}
                          fill
                          sizes="(max-width: 640px) 96px, 160px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-600">
                          <span className="material-symbols-outlined text-4xl">villa</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-1 gap-2">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            {c.complex && (
                              <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block truncate">
                                {c.complex}
                              </span>
                            )}
                            <h3
                              className={`font-bold text-base sm:text-lg truncate ${
                                isSelected ? "text-slate-100" : "text-slate-300"
                              }`}
                            >
                              {c.name}
                            </h3>
                            <span
                              className={`mt-0.5 inline-block rounded px-1.5 py-px text-[10px] font-bold tabular-nums ${
                                c.qualityScore >= 90
                                  ? "bg-green-500/15 text-green-400"
                                  : c.qualityScore >= 70
                                    ? "bg-amber-500/15 text-amber-400"
                                    : "bg-red-500/15 text-red-400"
                              }`}
                              title={t("qualityTitle")}
                            >
                              ★ {c.qualityScore}
                            </span>
                          </div>
                          {isSelected ? (
                            <span className="material-symbols-outlined text-admin-primary icon-fill shrink-0">
                              check_circle
                            </span>
                          ) : (
                            <span className="w-5 h-5 rounded-full border-2 border-slate-700 shrink-0" />
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-slate-400 text-xs">
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <span className="material-symbols-outlined text-sm">bed</span>
                            {t("bedrooms", { count: c.bedrooms })}
                          </span>
                          {c.hasPool && (
                            <span className="flex items-center gap-1 text-blue-400 whitespace-nowrap">
                              <span className="material-symbols-outlined text-sm">pool</span>
                              {t("pool")}
                            </span>
                          )}
                          {c.breakfastAvailable && (
                            <span className="flex items-center gap-1 whitespace-nowrap">
                              <span className="material-symbols-outlined text-sm">restaurant</span>
                              {t("breakfast")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500 block whitespace-nowrap">
                          {t("stayTotal", { nights: c.nights })}
                        </span>
                        <span
                          className={`font-bold text-base sm:text-lg tabular-nums whitespace-nowrap ${
                            isSelected ? "text-blue-400" : "text-slate-400"
                          }`}
                        >
                          {stayAmountLabel(c)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ───────── 패널 3: 제안 요약 (b2 우측) ───────── */}
        <section className="w-full xl:w-96 shrink-0 bg-admin-card rounded-2xl border border-slate-800 flex flex-col">
          <div className="p-6 border-b border-slate-800">
            <h2 className="text-lg font-bold text-slate-100">{t("summaryTitle")}</h2>
          </div>
          <div className="p-6 space-y-7">
            {/* 판매 채널 (랜드사·여행사·직접 — 채널이 곧 통화, ADR-0003) */}
            <div>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-3">
                {t("channelSection")}
              </span>
              <div className="grid grid-cols-3 gap-2">
                {CHANNELS.map((ch) => {
                  const active = channel === ch;
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setValue("channel", ch, { shouldValidate: true })}
                      className={
                        active
                          ? "px-2 py-2.5 rounded-xl border border-blue-500 bg-blue-500/10 text-blue-400 font-bold text-sm"
                          : "px-2 py-2.5 rounded-xl border border-slate-700 text-slate-400 font-medium text-sm hover:border-slate-600 hover:bg-slate-800/30 transition-colors"
                      }
                    >
                      {t(`channels.${ch}`)}
                    </button>
                  );
                })}
              </div>
              {/* VND 결제 캡션 (ADR-0003 — 여행사·랜드사 채널일 때, USD 모드 아닐 때) */}
              {currency === "VND" && (
                <p className="text-xs text-slate-400 mt-2 px-1">{t("vndNotice")}</p>
              )}
              {/* Phase 2: USD 판매 토글 (ADMIN 수동) */}
              <label className="flex items-center gap-2 mt-3 px-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={usdMode}
                  onChange={(e) => setUsdMode(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 [color-scheme:dark]"
                />
                <span className="text-xs font-medium text-slate-300">{t("usdToggle")}</span>
              </label>
              {currency === "USD" && (
                <p className="text-xs text-amber-300/90 mt-2 px-1">{t("usdNotice")}</p>
              )}
            </div>

            {/* 고객 / 파트너 — 채널에 맞춘 셀렉터(여행사·랜드사) + 일반 소비자 텍스트 입력 */}
            <div>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                {t("customerSection")}
              </span>
              {channel !== "DIRECT" && (
                <select
                  aria-label={t("customerSection")}
                  value={partnerSelectValue}
                  onChange={(e) => onPartnerSelect(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-100 px-4 py-3 mb-2 [color-scheme:dark]"
                >
                  <option value="" disabled>
                    {t("partnerSelectPlaceholder")}
                  </option>
                  {partnerOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.nameVi ? ` (${p.nameVi})` : ""}
                    </option>
                  ))}
                  <option value={DIRECT_CUSTOMER}>{t("partnerDirectOption")}</option>
                </select>
              )}
              {showClientNameInput && (
                <input
                  id="proposal-client-name"
                  type="text"
                  placeholder={t("clientNamePlaceholder")}
                  {...register("clientName")}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-100 px-4 py-3 placeholder:text-slate-600"
                />
              )}
              {errors.clientName && (
                <p role="alert" className="text-xs text-red-400 mt-1.5">
                  {errors.clientName.message}
                </p>
              )}
            </div>

            {/* 선택된 빌라 스택 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t("selectedVillas", { count: selected.length })}
                </span>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="text-xs text-blue-400 hover:underline"
                  >
                    {t("clearAll")}
                  </button>
                )}
              </div>
              {selected.length === 0 ? (
                <p className="text-xs text-admin-muted bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                  {t("noneSelected")}
                </p>
              ) : (
                <div className="space-y-3">
                  {selected.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-col gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-slate-800">
                          {c.photoUrl ? (
                            <Image
                              src={c.photoUrl}
                              alt={c.name}
                              fill
                              sizes="48px"
                              className="object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-600">
                              <span className="material-symbols-outlined text-xl">villa</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-slate-100 truncate">{c.name}</div>
                          <div className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                            {stayAmountLabel(c)} ({t("stayTotal", { nights: c.nights })})
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={t("removeVilla")}
                          onClick={() => toggleVilla(c.id)}
                          className="text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                      </div>
                      {/* Phase 2 USD: 빌라별 USD 총액 수동 입력 */}
                      {currency === "USD" && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400 shrink-0">
                            {t("usdTotalLabel")}
                          </span>
                          <div className="relative flex-1">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                              $
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              aria-label={`${c.name} ${t("usdTotalLabel")}`}
                              placeholder={t("usdTotalPlaceholder")}
                              value={usdTotals[c.id] ?? ""}
                              onChange={(e) =>
                                setUsdTotals((prev) => ({
                                  ...prev,
                                  [c.id]: e.target.value.replace(/[^\d]/g, ""),
                                }))
                              }
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-sm font-bold text-slate-100 tabular-nums placeholder:text-slate-600"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 만료 시간 — 24h/48h만 (계약: "무제한" 금지) */}
            <div>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-3">
                {t("expirySection")}
              </span>
              <div className="flex gap-2">
                {([24, 48] as const).map((h) => {
                  const active = expiresInHours === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setValue("expiresInHours", h, { shouldValidate: true })}
                      className={
                        active
                          ? "flex-1 py-2 px-3 rounded-lg border border-blue-500 bg-blue-500/20 text-blue-400 text-sm font-bold"
                          : "flex-1 py-2 px-3 rounded-lg border border-slate-700 text-slate-400 text-sm font-medium hover:bg-slate-800 transition-colors"
                      }
                    >
                      {t(h === 24 ? "hours24" : "hours48")}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 합계 — 총 판매가 / 마진 / 최종 제안 금액 (ADMIN 화면 — 마진 표시 허용) */}
            <div className="pt-5 border-t border-slate-800 space-y-3">
              <div className="flex justify-between text-sm gap-3">
                <span className="text-slate-400 whitespace-nowrap">{t("totalSale")}</span>
                <span className="text-slate-100 font-medium tabular-nums">{totalSaleLabel}</span>
              </div>
              {currency === "VND" ? (
                <div className="flex justify-between text-sm gap-3">
                  <span className="text-slate-400 whitespace-nowrap">{t("marginSummary")}</span>
                  <span className="text-blue-400 font-medium tabular-nums">
                    {formatVnd(marginVnd)}
                  </span>
                </div>
              ) : currency === "USD" ? (
                // USD: 환산 후 마진은 서버 스냅샷 환율로 계산(/revenue·정산에서 표시). 생성 화면은 USD 총액만.
                <p className="text-[11px] text-admin-muted leading-relaxed">{t("usdNotice")}</p>
              ) : marginKrwRef !== null ? (
                <div className="flex justify-between text-sm gap-3">
                  <span className="text-slate-400 whitespace-nowrap">{t("marginReference")}</span>
                  <span className="text-blue-400 font-medium tabular-nums whitespace-nowrap">
                    ≈ {formatThousands(marginKrwRef)}원
                  </span>
                </div>
              ) : (
                // KRW 채널 + 환율 미설정 — 마진 행 숨김 + 안내 (계약)
                <p className="text-[11px] text-admin-muted leading-relaxed">{t("fxMissing")}</p>
              )}
              <div className="flex justify-between items-center pt-2 gap-3">
                <span className="text-slate-100 font-bold whitespace-nowrap">
                  {t("finalAmount")}
                </span>
                <span className="text-blue-400 font-bold text-xl tabular-nums">
                  {totalSaleLabel}
                </span>
              </div>
            </div>

            {/* 409 항목별 사유 안내 */}
            {failures && failures.length > 0 && (
              <div
                role="alert"
                className="bg-red-900/20 border border-red-900/40 rounded-xl p-4 text-xs text-red-300 space-y-1"
              >
                <p className="font-bold">{t("unavailableTitle")}</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {failures.map((f, i) => (
                    <li key={i}>
                      {f.name} — {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {submitError && (
              <p role="alert" className="text-xs text-red-400">
                {submitError}
              </p>
            )}
          </div>

          <div className="p-6 border-t border-slate-800">
            <button
              type="submit"
              disabled={selected.length === 0 || isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
            >
              <span className="material-symbols-outlined">link</span>
              {isSubmitting ? t("submitting") : t("submit")}
            </button>
            {/* 환율 참고 칩 (b2 하단 — 미설정 시 "환율 미설정") */}
            <div className="flex justify-center mt-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full border border-slate-700 text-slate-500 text-xs tabular-nums">
                {fxChipLabel}
              </span>
            </div>
            <p className="text-[10px] text-center text-slate-500 mt-3">{t("linkHint")}</p>
          </div>
        </section>
      </form>

      {/* 생성 완료 모달 — 공개 링크 복사 → 목록 이동 */}
      {createdToken && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("successTitle")}
            className="w-full max-w-md bg-admin-card border border-slate-700 rounded-2xl p-8 flex flex-col items-center gap-4 text-center"
          >
            <span className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-emerald-400 text-3xl icon-fill">
                check_circle
              </span>
            </span>
            <h2 className="text-lg font-bold text-white">{t("successTitle")}</h2>
            <p className="text-sm text-admin-muted">{t("successDesc")}</p>
            <div className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xs text-slate-300 break-all text-left">
              {typeof window !== "undefined" ? window.location.origin : ""}/p/{createdToken}
            </div>
            <div className="w-full flex gap-2">
              <button
                type="button"
                onClick={() => void copyCreatedLink()}
                className="flex-1 bg-admin-primary hover:bg-admin-primary-dark text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-base">
                  {linkCopied ? "check" : "content_copy"}
                </span>
                {linkCopied ? t("copied") : t("copyLink")}
              </button>
              <button
                type="button"
                onClick={() => router.push("/proposals")}
                className="flex-1 border border-slate-700 text-slate-200 hover:bg-slate-800 font-bold py-3 rounded-xl text-sm transition-colors"
              >
                {t("goList")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
