"use client";

// app/g/_components/guest-options.tsx — 부가 옵션 신청 폼 (ADR-0019 v2 게스트 UI 개편, 별도 라우트)
//   체크인과 독립(/g/[token]/options) — 투숙 중 언제든 접근. 카탈로그 카드 + 희망 날짜/시간(#3)만.
//   ★요청 내역은 별도 페이지(/g/[token]/orders)로 분리 — 신청 후 그쪽으로 이동(router.push). 옵션이 많아져도 확인·정산이 쉽게.
//   ★결제통화: 가격은 항상 VND 기본 표기(VND 우선 수납). 하단 합계에만 언어 모국통화로 "오늘 환율 기준" 환산액 보조 표기(vi=없음).
//   ★마진 비공개: 판매가만(원가·마진 0). 환산값은 표시용 근사치.
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  resolveOrderPricing,
  ServiceSelectionError,
  type CatalogOptions,
} from "@/lib/service-catalog";
import { GUEST_LABELS } from "@/lib/guest-i18n";
import { PublicLangSelector } from "@/components/public-lang-selector";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";
import { todayVnDateString } from "@/lib/date-vn";
import { readVariantRule, anyVariantHasHeightRule, type VariantRule } from "@/lib/ticket-variant-rules";
import type { GuestLabels } from "@/lib/guest-i18n";
import { OptionCard, type CardSelection } from "./option-card";
import { guestVnd } from "./guest-format";
import { resolveSelectedPeople, groupPeopleByVariant, ticketGroupsTotalVnd } from "./ticket-variant-logic";
import { ALL_TYPES, buildGuestTypeTabs, filterGuestCatalogByType } from "./guest-options-filter";
import type { GuestCatalogView } from "./types";
import type { GuestOptionsProps } from "./types";

/** ISO → YYYY-MM-DD (UTC, @db.Date 자정 기준) — date input min/max용. */
function isoToDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

// 품목 설정 오류 코드 — 서버 응답(error 또는 selection code)이 이 집합이면 "운영자 문의" 구체 문구.
//   VARIANT_REQUIRED·UNKNOWN_VARIANT·NO_PRICE = 게스트 재시도로 해결 불가(운영자 카탈로그 문제).
//   VARIANT_PRICE_REQUIRED = 카탈로그 write 가드(주문 경로엔 안 오지만 방어적으로 포함).
const CONFIG_ERROR_CODES = new Set([
  "VARIANT_REQUIRED",
  "NO_PRICE",
  "UNKNOWN_VARIANT",
  "VARIANT_PRICE_REQUIRED",
]);

function emptySelection(variantKey: string | null): CardSelection {
  return {
    variantKey,
    addonKeys: [],
    modifierKeys: [],
    quantity: 0,
    serviceDate: null,
    serviceTime: null,
    guestNote: null,
    ticketGuestIdxs: [],
    ticketGuestVariants: {},
  };
}

/** 여권 생년월일 "YYYY-MM-DD" → "dd/MM/yyyy" 단순 재배치(타임존 변환 금지). null·불량이면 "—"·원문. */
function formatBirthDate(raw: string | null): string {
  if (!raw) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
}

/** variant-person(TICKET + 체크인 명단 + variant) 여부 + 정규화 규칙. 자동/수동 판정·그룹 분리 제출에 공통 사용. */
function ticketVariantContext(
  c: GuestCatalogView,
  checkedInGuests: { name: string | null; birthDate: string | null }[]
): { isTVP: boolean; rules: VariantRule[] } {
  const isTVP = c.type === "TICKET" && checkedInGuests.length > 0 && c.variants.length > 0;
  const rules: VariantRule[] = isTVP
    ? c.variants.map((v) =>
        readVariantRule({
          key: v.key,
          bornBeforeYear: v.bornBeforeYear,
          ageMin: v.ageMin,
          ageMax: v.ageMax,
          heightMaxCm: v.heightMaxCm,
        })
      )
    : [];
  return { isTVP, rules };
}

export default function GuestOptions(props: GuestOptionsProps) {
  const { token, lang, booking, catalog, checkedInGuests } = props;
  const L = GUEST_LABELS[lang];
  const router = useRouter();
  const suffix = lang === "ko" ? "" : `?lang=${lang}`;
  const ordersHref = `/g/${token}/orders${suffix}`;

  const dateMin = isoToDateInput(booking.checkIn);
  const dateMax = isoToDateInput(booking.checkOut);

  const [selections, setSelections] = useState<Record<string, CardSelection>>(() =>
    Object.fromEntries(catalog.map((c) => [c.id, emptySelection(c.variants[0]?.key ?? null)]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  // 카테고리 탭 — 표시 필터만(선택 상태 selections는 전체 catalog 기준으로 유지). 실존 타입만 노출.
  const [activeType, setActiveType] = useState<string>(ALL_TYPES);
  const typeTabs = useMemo(() => buildGuestTypeTabs(catalog), [catalog]);
  const visibleCatalog = useMemo(
    () => filterGuestCatalogByType(catalog, activeType),
    [catalog, activeType]
  );
  // ★이용자 이름 — 서비스 받으실 분(묶음 공통 1값). 예약 대표자 이름 prefill, 수정 가능. 빈값이면 서버가 대표자 폴백.
  const [customerName, setCustomerName] = useState<string>(booking.guestName ?? "");
  // ★티켓 이용자 신장(사람 idx→cm) — 폼 전역 1값. "티켓 이용자 정보" 카드에서 1회 입력, 모든 TICKET 품목 판정에 공유(테오 2026-07-12).
  const [heightByIdx, setHeightByIdx] = useState<Record<number, number>>({});
  const setPersonHeight = (idx: number, raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 3);
    setHeightByIdx((prev) => {
      const next = { ...prev };
      if (digits === "") delete next[idx];
      else next[idx] = parseInt(digits, 10);
      return next;
    });
  };

  // 티켓 이용자 정보 통합 카드 노출 판정 — 카탈로그에 TICKET 품목 존재 && 체크인 명단 존재.
  //   신장 입력칸은 TICKET 품목 중 신장 규칙(heightMaxCm) variant가 하나라도 있을 때만.
  const hasTicketWithGuests =
    checkedInGuests.length > 0 && catalog.some((c) => c.type === "TICKET");
  const showSharedHeight = useMemo(
    () =>
      catalog.some((c) => {
        const ctx = ticketVariantContext(c, checkedInGuests);
        return ctx.isTVP && anyVariantHasHeightRule(ctx.rules);
      }),
    [catalog, checkedInGuests]
  );
  // 현재 필터에 보이는 첫 TICKET 카드 id — 그 카드 직전에 통합 카드를 1회 배치.
  const firstTicketCardId = useMemo(
    () => (checkedInGuests.length > 0 ? visibleCatalog.find((c) => c.type === "TICKET")?.id ?? null : null),
    [visibleCatalog, checkedInGuests]
  );

  // ── 합계 미리보기(선택 항목 VND 합산 → KRW 파생) ──
  const cardOptions = useMemo(() => {
    const map: Record<string, CatalogOptions> = {};
    for (const c of catalog) {
      map[c.id] = {
        variants: c.variants.map((o) => ({ key: o.key, labelKo: o.label, priceVnd: o.priceVnd })),
        addons: c.addons.map((o) => ({ key: o.key, labelKo: o.label, priceVnd: o.priceVnd })),
        modifiers: c.modifiers.map((o) => ({ key: o.key, labelKo: o.label, priceVnd: o.priceVnd })),
      };
    }
    return map;
  }, [catalog]);

  const grandTotal = useMemo(() => {
    let vnd = 0n;
    let has = false;
    for (const c of catalog) {
      const sel = selections[c.id];
      if (!sel || sel.quantity < 1) continue;
      const ctx = ticketVariantContext(c, checkedInGuests);
      if (ctx.isTVP && sel.ticketGuestIdxs.length > 0) {
        // 인원별 구분 지정 → variant 그룹별 합(서버 동형 재계산). 이용일 미선택이면 VN 오늘 기준 판정.
        const eff = sel.serviceDate ?? todayVnDateString();
        const people = resolveSelectedPeople(
          sel.ticketGuestIdxs, checkedInGuests, ctx.rules, sel.ticketGuestVariants, heightByIdx, eff, c.variants[0]?.key ?? null
        );
        const groups = groupPeopleByVariant(people);
        vnd += ticketGroupsTotalVnd(groups, { priceVnd: c.priceVnd ? BigInt(c.priceVnd) : null }, cardOptions[c.id], sel.addonKeys, sel.modifierKeys);
        if (groups.length > 0) has = true;
        continue;
      }
      try {
        const p = resolveOrderPricing(
          { priceVnd: c.priceVnd ? BigInt(c.priceVnd) : null },
          cardOptions[c.id],
          { variantKey: sel.variantKey, addonKeys: sel.addonKeys, modifierKeys: sel.modifierKeys, quantity: sel.quantity }
        );
        vnd += p.totalPriceVnd;
        has = true;
      } catch (e) {
        if (!(e instanceof ServiceSelectionError)) throw e;
      }
    }
    return { vnd, has };
  }, [catalog, selections, cardOptions, checkedInGuests, heightByIdx]);

  const anySelected = catalog.some((c) => (selections[c.id]?.quantity ?? 0) > 0);
  // 선택한 항목은 희망 날짜 필수. 시간은 TICKET 제외 필수(TICKET은 이용일만, 테오 2026-07-12). 서버도 동일 검증.
  const missingDateTime = catalog.some((c) => {
    const sel = selections[c.id];
    if (!sel || sel.quantity <= 0) return false;
    if (!sel.serviceDate) return true;
    return c.type !== "TICKET" && !sel.serviceTime;
  });
  // 인원별 구분 미배정(자동 판정 실패 + 수동 미선택) 차단 — variant-person TICKET만.
  const missingTicketVariant = catalog.some((c) => {
    const sel = selections[c.id];
    if (!sel || sel.quantity <= 0) return false;
    const ctx = ticketVariantContext(c, checkedInGuests);
    if (!ctx.isTVP) return false;
    const eff = sel.serviceDate ?? todayVnDateString();
    const people = resolveSelectedPeople(
      sel.ticketGuestIdxs, checkedInGuests, ctx.rules, sel.ticketGuestVariants, heightByIdx, eff, c.variants[0]?.key ?? null
    );
    return people.some((p) => p.key == null);
  });
  const canSubmit = anySelected && !missingDateTime && !missingTicketVariant;
  // 합계 = ₫ 원천 단일 표기(다국적 커버). 모국통화 환산 보조 표기 제거 — 5언어 전부 ₫로 일관.
  const grandTotalStr = guestVnd(grandTotal.vnd.toString());

  const submitOrders = async () => {
    if (submitting) return;
    const chosen = catalog.filter((c) => (selections[c.id]?.quantity ?? 0) > 0);
    if (chosen.length === 0) return;
    setSubmitting(true);
    setOrdersError(null);
    // 단일 주문 POST(부분 실패 시 throw로 중단 — 기존 루프 방식). true면 성공.
    //   실패 시 서버 응답의 오류 코드(error 또는 selection code)를 Error.code에 실어 던진다 —
    //   품목 설정 오류(가격 누락 등)는 게스트에게 구체 문구로 안내하기 위함. json 파싱 실패는 관용(코드 null).
    const postOrder = async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/g/${token}/service-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let code: string | null = null;
        try {
          const j = (await res.json()) as { error?: unknown; code?: unknown };
          code =
            (typeof j?.code === "string" ? j.code : null) ??
            (typeof j?.error === "string" ? j.error : null);
        } catch {
          /* json 파싱 실패는 관용 — 일반 오류로 처리 */
        }
        const err = new Error(`HTTP_${res.status}`) as Error & { code?: string | null };
        err.code = code;
        throw err;
      }
    };
    try {
      for (const c of chosen) {
        const sel = selections[c.id];
        const ctx = ticketVariantContext(c, checkedInGuests);
        // ── variant-person TICKET(ADR-0036 개정) — 인원별 구분을 variant 그룹으로 나눠 그룹당 1 주문.
        //   가격이 다른 연령/신장 구분을 분리 구매(quantity=그룹 인원수, ticketGuests=그 그룹만, variantKey=그 구분).
        if (ctx.isTVP && sel.ticketGuestIdxs.length > 0) {
          const eff = sel.serviceDate ?? todayVnDateString();
          const people = resolveSelectedPeople(
            sel.ticketGuestIdxs, checkedInGuests, ctx.rules, sel.ticketGuestVariants, heightByIdx, eff, c.variants[0]?.key ?? null
          );
          const groups = groupPeopleByVariant(people);
          for (const grp of groups) {
            await postOrder({
              catalogItemId: c.id,
              variantKey: grp.variantKey,
              addonKeys: sel.addonKeys,
              modifierKeys: sel.modifierKeys,
              quantity: grp.guests.length,
              serviceDate: sel.serviceDate ?? undefined, // TICKET은 이용일만(시간 미포함)
              guestNote: sel.guestNote ?? undefined,
              customerName: customerName.trim() || undefined,
              ticketGuests: grp.guests, // 이름·생년월일·(신장) — 그 그룹만
            });
          }
          continue;
        }
        // ── 그 외(비-variant TICKET·일반 서비스) — 기존 단일 주문. TICKET+명단이면 선택 인원 스냅샷 첨부.
        const ticketGuests =
          c.type === "TICKET" && checkedInGuests.length > 0 && sel.ticketGuestIdxs.length > 0
            ? sel.ticketGuestIdxs.map((i) => checkedInGuests[i]).filter(Boolean)
            : undefined;
        await postOrder({
          catalogItemId: c.id,
          variantKey: sel.variantKey ?? undefined,
          addonKeys: sel.addonKeys,
          modifierKeys: sel.modifierKeys,
          quantity: sel.quantity,
          serviceDate: sel.serviceDate ?? undefined,
          // TICKET은 시간 미포함(이용일만). 그 외는 희망 시간 전송.
          serviceTime: c.type === "TICKET" ? undefined : sel.serviceTime ?? undefined,
          guestNote: sel.guestNote ?? undefined,
          // ★이용자 이름 — 묶음 공통 1값(빈값이면 서버가 예약 대표자 폴백)
          customerName: customerName.trim() || undefined,
          // TICKET 이용자 선택 스냅샷(이름·생년월일만) — 있을 때만
          ...(ticketGuests ? { ticketGuests } : {}),
        });
      }
      // 신청 완료 → 신청 내역 페이지로 이동(서버 렌더로 최신 목록·옵션 상세 표시) + 성공 배너(ordered=1)
      router.push(ordersHref + (suffix ? "&" : "?") + "ordered=1");
    } catch (e) {
      // 품목 설정 오류(variant 필수·가격 부재·미지 variant)는 구체 문구 — 게스트가 재시도해도 안 되므로 운영자 문의 안내.
      //   ★미체크인+규칙 variant(TICKET_GUESTS_REQUIRED, P2-B)는 재시도가 아니라 셀프 체크인 선행이 해법 — 별도 유도 문구.
      const code = (e as { code?: string | null } | null)?.code ?? null;
      setOrdersError(
        code === "TICKET_GUESTS_REQUIRED"
          ? L.addons.ticketCheckinRequired
          : code && CONFIG_ERROR_CODES.has(code)
            ? L.addons.configError
            : L.addons.error
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-50 flex flex-col shadow-2xl relative">
      <header className="w-full sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-100">
        <div className="flex items-center h-14 px-3 gap-1.5">
          <a href={ordersHref} className="p-2 rounded-full hover:bg-slate-50 active:scale-95">
            <span className="material-symbols-outlined text-slate-600">arrow_back</span>
          </a>
          <h1 className="font-bold text-base text-slate-900">{L.addons.title}</h1>
          <span className="ml-auto flex items-center gap-2 pr-0.5">
            <VillaGoMark className="h-5 w-auto" />
            <VillaGoWordmark className="text-sm" villa="text-slate-900" go="text-teal-600" />
            <PublicLangSelector current={lang} />
          </span>
        </div>
      </header>

      <main className="flex-grow px-4 py-5 space-y-4 pb-40">
        <p className="text-sm text-slate-500 leading-relaxed">{L.addons.pageIntro}</p>

        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex gap-3">
          <span className="material-symbols-outlined text-amber-500 text-[20px]">info</span>
          <p className="text-xs text-amber-800 leading-relaxed">{L.addons.banner}</p>
        </div>

        {catalog.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-10">{L.addons.empty}</p>
        ) : (
          <>
            {/* 카테고리 탭 — 실존 타입만(+전체), 건수 뱃지. 타입이 2종 이상일 때만 노출(1종이면 필터 불필요). 가로 스크롤. */}
            {typeTabs.length > 2 && (
              <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {typeTabs.map(({ key, count }) => {
                  const active = activeType === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActiveType(key)}
                      className={
                        active
                          ? "shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold bg-teal-600 text-white shadow-sm active:scale-95"
                          : "shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium bg-white text-slate-600 border border-slate-200 active:scale-95"
                      }
                    >
                      {L.serviceTypes[key as keyof typeof L.serviceTypes] ?? key}
                      <span
                        className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                          active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {visibleCatalog.map((c) => (
              <Fragment key={c.id}>
                {/* 티켓 이용자 정보 통합 카드 — 첫 TICKET 카드 직전 1회. 이름·생년월일 + (신장 규칙 있으면) 신장 1회 입력. */}
                {hasTicketWithGuests && c.id === firstTicketCardId && (
                  <TicketGuestInfoCard
                    labels={L.addons}
                    guests={checkedInGuests}
                    showHeight={showSharedHeight}
                    heightByIdx={heightByIdx}
                    onHeightChange={setPersonHeight}
                  />
                )}
                <OptionCard
                  item={c}
                  labels={L.addons}
                  selection={selections[c.id] ?? emptySelection(c.variants[0]?.key ?? null)}
                  onChange={(next) => setSelections((prev) => ({ ...prev, [c.id]: next }))}
                  badgeText={typeBadgeLabel(c.type)}
                  dateMin={dateMin}
                  dateMax={dateMax}
                  checkedInGuests={checkedInGuests}
                  sharedHeights={heightByIdx}
                />
              </Fragment>
            ))}
          </>
        )}

        {/* 이용자 이름 — 서비스 받으실 분(묶음 공통). 대표자 이름 prefill, 수정 가능. 빈값 허용(서버 폴백). */}
        {catalog.length > 0 && (
          <div className="bg-white border border-slate-100 rounded-xl p-4 space-y-2 shadow-sm">
            <label
              htmlFor="guest-customer-name"
              className="flex items-center gap-1.5 text-sm font-bold text-slate-700"
            >
              <span className="material-symbols-outlined text-teal-600 text-[18px]">person</span>
              {L.addons.customerNameLabel}
            </label>
            <input
              id="guest-customer-name"
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              maxLength={80}
              placeholder={L.addons.customerNamePlaceholder}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 focus:ring-teal-500 focus:border-teal-500"
            />
            <p className="text-[11px] text-slate-400 leading-snug">{L.addons.customerNameHint}</p>
          </div>
        )}

        {ordersError && <p className="text-xs text-red-500 text-center">{ordersError}</p>}

        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex gap-3">
          <span className="material-symbols-outlined text-slate-400 text-[20px]">payments</span>
          <p className="text-xs text-slate-500 leading-relaxed">{L.result.settleNote}</p>
        </div>
      </main>

      {/* 하단 합계 + 요청 버튼 */}
      {catalog.length > 0 && (
        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-4 py-3.5 space-y-3 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]">
          {anySelected && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-500 shrink-0">{L.addons.estTotal}</span>
              <div className="text-right min-w-0">
                <span className="text-xl font-extrabold text-teal-600 tabular-nums block">
                  {grandTotalStr}
                </span>
              </div>
            </div>
          )}
          {anySelected && missingDateTime && (
            <p className="text-xs text-amber-600 text-center flex items-center justify-center gap-1">
              <span className="material-symbols-outlined text-[16px]">schedule</span>
              {L.addons.dateTimeRequired}
            </p>
          )}
          {anySelected && !missingDateTime && missingTicketVariant && (
            <p className="text-xs text-amber-600 text-center flex items-center justify-center gap-1">
              <span className="material-symbols-outlined text-[16px]">confirmation_number</span>
              {L.addons.ticketVariantRequired}
            </p>
          )}
          <button
            type="button"
            disabled={submitting || !canSubmit}
            onClick={submitOrders}
            className="w-full h-14 bg-teal-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-transform"
          >
            {submitting ? L.addons.requesting : L.addons.requestCta}
          </button>
        </div>
      )}
    </div>
  );
}

/** 티켓 이용자 정보 통합 카드 — 티켓 품목 카드들 앞에 1회. 이용자별 이름·생년월일 + (신장 규칙 있으면) 신장 1회 입력.
 *   신장은 폼 전역 상태(사람 idx→cm)라 여기서 1번 입력하면 모든 TICKET 품목 판정에 공유된다. 현장 측정·차액 고지도 여기 1회. */
function TicketGuestInfoCard({
  labels,
  guests,
  showHeight,
  heightByIdx,
  onHeightChange,
}: {
  labels: GuestLabels["addons"];
  guests: { name: string | null; birthDate: string | null }[];
  showHeight: boolean;
  heightByIdx: Record<number, number>;
  onHeightChange: (idx: number, raw: string) => void;
}) {
  return (
    <div className="bg-white border border-sky-100 rounded-2xl shadow-sm p-4 space-y-2.5">
      <p className="flex items-center gap-1.5 text-sm font-bold text-sky-700">
        <span className="material-symbols-outlined text-[18px]">confirmation_number</span>
        {labels.ticketPeopleTitle}
      </p>
      <p className="text-[11px] text-slate-500 leading-snug">{labels.ticketPeopleHint}</p>
      {/* 신장 규칙 품목이 있을 때만 — 자가신고 고지(현장 재측정·초과 시 차액). 허위신고 방지. 1회만. */}
      {showHeight && (
        <p className="flex items-start gap-1 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-700">
          <span className="material-symbols-outlined text-[14px] mt-px">straighten</span>
          {labels.ticketHeightNotice}
        </p>
      )}
      <div className="space-y-1.5 pt-0.5">
        {guests.map((g, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
          >
            <span className="material-symbols-outlined text-slate-300 text-[18px]">person</span>
            <span className="min-w-0 flex-1 flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800 truncate">{g.name ?? "—"}</span>
              <span className="text-[11px] tabular-nums text-slate-400 shrink-0">{formatBirthDate(g.birthDate)}</span>
            </span>
            {showHeight && (
              <span className="flex items-center gap-1 shrink-0">
                <span className="text-[11px] text-slate-500">{labels.ticketHeightLabel}</span>
                <input
                  inputMode="numeric"
                  value={heightByIdx[idx]?.toString() ?? ""}
                  onChange={(e) => onHeightChange(idx, e.target.value)}
                  placeholder={labels.ticketHeightPlaceholder}
                  aria-label={`${g.name ?? ""} ${labels.ticketHeightLabel}`.trim()}
                  className="w-16 rounded border border-slate-200 px-2 py-1 text-xs text-slate-800 tabular-nums text-right focus:ring-sky-500 focus:border-sky-500"
                />
                <span className="text-[11px] text-slate-400">cm</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function typeBadgeLabel(type: string): string {
  const map: Record<string, string> = {
    MASSAGE: "SPA",
    BARBER: "BARBER",
    CAR_RENTAL: "CAR",
    MOTORBIKE_RENTAL: "BIKE",
    BBQ: "BBQ",
    TICKET: "TICKET",
    GUIDE: "GUIDE",
    BREAKFAST: "BREAKFAST",
  };
  return map[type] ?? type;
}

