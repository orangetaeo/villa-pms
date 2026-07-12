"use client";

// app/g/_components/option-card.tsx — G4 부가옵션 카드 1개 (ADR-0019 S3)
//   variant(1택·가격대체) · addon(다중·가산, 13종 이상은 바텀시트) · modifier(토글·가산) · 수량 스테퍼.
//   합계 미리보기는 resolveOrderPricing(클라)로 — 서버가 최종 재계산(변조 방지).
import { useMemo, useState } from "react";
import {
  resolveOrderPricing,
  ServiceSelectionError,
  fulfillmentMode,
  type CatalogOptions,
} from "@/lib/service-catalog";
import { fulfillmentNote } from "@/lib/guest-fulfillment";
import { catalogImage } from "@/lib/service-image";
import { DateField } from "@/components/date-field";
import { todayVnDateString } from "@/lib/date-vn";
import {
  readVariantRule,
  anyVariantHasRule,
  type VariantRule,
} from "@/lib/ticket-variant-rules";
import type { GuestLabels } from "@/lib/guest-i18n";
import { guestVndPrice, guestVndDelta } from "./guest-format";
import { resolveSelectedPeople, groupPeopleByVariant, ticketGroupsTotalVnd, ticketGroupSubtotals } from "./ticket-variant-logic";
import type { GuestCatalogView, GuestOption } from "./types";

export interface CardSelection {
  variantKey: string | null;
  addonKeys: string[];
  modifierKeys: string[];
  quantity: number;
  /** 희망 날짜(YYYY-MM-DD, 투숙기간 내). 미선택이면 null. (#3) */
  serviceDate: string | null;
  /** 희망 시간(HH:MM 자유 입력). 미선택이면 null. (#3) */
  serviceTime: string | null;
  /** 요청사항(선택, 최대 500자). 이행자에게 전달되는 게스트 특이사항. 미입력이면 null. */
  guestNote: string | null;
  /** TICKET 이용자 선택 — checkedInGuests 인덱스 목록(ADR-0036). 선택 수 = quantity 동기화.
   *   빈 명단(체크인 전)이면 사용 안 함(기존 수량 스테퍼). 제출 시 인덱스→{name,birthDate,heightCm} 해석. */
  ticketGuestIdxs: number[];
  /** TICKET 인원별 연령/신장 구분 수동 배정(idx→variantKey) — 자동 판정 실패 폴백·순수 수동 모드에서만 유효.
   *   자동 판정되는 사람은 이 값과 무관(파생). variants 있는 TICKET에서만 사용. */
  ticketGuestVariants: Record<number, string>;
}

const NOTE_MAX = 500;

const TYPE_BADGE: Record<string, string> = {
  BBQ: "bg-orange-50 text-orange-600",
  TICKET: "bg-sky-50 text-sky-600",
  GUIDE: "bg-violet-50 text-violet-600",
  CAR_RENTAL: "bg-emerald-50 text-emerald-600",
  MOTORBIKE_RENTAL: "bg-rose-50 text-rose-600",
  MASSAGE: "bg-fuchsia-50 text-fuchsia-600",
  BARBER: "bg-amber-100 text-amber-700",
  BREAKFAST: "bg-teal-50 text-teal-600",
};

const toVndStr = (v: bigint | null): string | null => (v == null ? null : v.toString());

export function OptionCard({
  item,
  labels,
  selection,
  onChange,
  badgeText,
  dateMin,
  dateMax,
  checkedInGuests,
  sharedHeights,
}: {
  item: GuestCatalogView;
  labels: GuestLabels["addons"];
  selection: CardSelection;
  onChange: (next: CardSelection) => void;
  badgeText: string;
  /** 희망 날짜 입력 가능 범위(YYYY-MM-DD) — 투숙 체크인~체크아웃. (#3) */
  dateMin: string;
  dateMax: string;
  /** 체크인된 투숙객 명단(TICKET 이용자 선택용, ADR-0036). 빈 배열이면 기존 수량 스테퍼. */
  checkedInGuests: { name: string | null; birthDate: string | null }[];
  /** 티켓 이용자별 공유 신장(idx→cm) — 폼 전역 "티켓 이용자 정보" 카드에서 1회 입력. 판정 원천(읽기전용). */
  sharedHeights: Record<number, number>;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const options: CatalogOptions = useMemo(
    () => ({
      variants: item.variants.map((o) => optToDef(o)),
      addons: item.addons.map((o) => optToDef(o)),
      modifiers: item.modifiers.map((o) => optToDef(o)),
    }),
    [item]
  );

  // 합계 미리보기 — 수량 0이어도 현재 선택(variant·addon·modifier) 기준 "단가(1개)"를 표시한다.
  // (M1) 옛 동작: quantity<1이면 null→item.priceVnd(기본가) 폴백 → 선택한 variant 가격과 불일치.
  //   예) 두리안 200,000 선택인데 하단 50,000 표시. 수량을 1로 가정해 선택을 반영한다.
  const preview = useMemo(() => {
    const qty = Math.max(1, selection.quantity);
    try {
      return resolveOrderPricing(
        { priceVnd: item.priceVnd ? BigInt(item.priceVnd) : null },
        options,
        {
          variantKey: selection.variantKey,
          addonKeys: selection.addonKeys,
          modifierKeys: selection.modifierKeys,
          quantity: qty,
        }
      );
    } catch (e) {
      if (e instanceof ServiceSelectionError) return null;
      throw e;
    }
  }, [item, options, selection]);

  const selectedAddons = item.addons.filter((a) => selection.addonKeys.includes(a.key));

  const setQty = (delta: number) =>
    onChange({ ...selection, quantity: Math.max(0, selection.quantity + delta) });

  const pickVariant = (key: string) => onChange({ ...selection, variantKey: key });

  const toggleAddon = (key: string) => {
    const has = selection.addonKeys.includes(key);
    onChange({
      ...selection,
      addonKeys: has
        ? selection.addonKeys.filter((k) => k !== key)
        : [...selection.addonKeys, key],
    });
  };

  const toggleModifier = (key: string) => {
    const has = selection.modifierKeys.includes(key);
    onChange({
      ...selection,
      modifierKeys: has
        ? selection.modifierKeys.filter((k) => k !== key)
        : [...selection.modifierKeys, key],
    });
  };

  // TICKET 이용자 선택(ADR-0036) — 체크인 명단이 있으면 수량 스테퍼 대신 인원 체크박스.
  //   선택 수 = quantity 동기화(같이 갱신). 명단 비면 기존 스테퍼 유지.
  const isTicketWithGuests = item.type === "TICKET" && checkedInGuests.length > 0;
  const hasVariants = item.variants.length > 0;
  // 인원별 연령/신장 구분 지정 모드 — TICKET + 체크인 명단 + variant 존재. variant 없으면 기존 단일가 체크박스.
  const isTicketVariantPerson = isTicketWithGuests && hasVariants;
  // TICKET은 이용일(날짜)만 받고 시간은 불요(테오 2026-07-12) — 오전/오후/야간 구분은 카탈로그 variant로.
  //   그 외 서비스는 날짜+시간 둘 다 필수(현행).
  const hideTime = item.type === "TICKET";
  const firstVariantKey = item.variants[0]?.key ?? null;

  // variant 자동판정 규칙(정규화) — bornBeforeYear·나이·heightMaxCm. 규칙 있으면 자동 모드, 전무면 순수 수동.
  const ageRules: VariantRule[] = useMemo(
    () =>
      item.variants.map((v) =>
        readVariantRule({
          key: v.key,
          bornBeforeYear: v.bornBeforeYear,
          ageMin: v.ageMin,
          ageMax: v.ageMax,
          heightMaxCm: v.heightMaxCm,
        })
      ),
    [item.variants]
  );
  const autoMode = isTicketVariantPerson && anyVariantHasRule(ageRules);
  // 자동 판정 기준 이용일 — 미선택이면 VN 오늘(신청 즉시 판정). serviceDate 바뀌면 재판정.
  const effServiceDate = selection.serviceDate ?? todayVnDateString();

  // 선택 인원별 최종 variant(자동/수동) 해석 — 표시·합계·제출에 공통 사용.
  //   신장 원천은 폼 전역 공유 상태(sharedHeights) — "티켓 이용자 정보" 카드에서 1회 입력, 모든 티켓 품목이 공유.
  const resolvedPeople = useMemo(
    () =>
      isTicketVariantPerson
        ? resolveSelectedPeople(
            selection.ticketGuestIdxs,
            checkedInGuests,
            ageRules,
            selection.ticketGuestVariants,
            sharedHeights,
            effServiceDate,
            firstVariantKey
          )
        : [],
    [isTicketVariantPerson, selection.ticketGuestIdxs, selection.ticketGuestVariants, sharedHeights, checkedInGuests, ageRules, effServiceDate, firstVariantKey]
  );
  const resolvedByIdx = useMemo(() => new Map(resolvedPeople.map((p) => [p.idx, p])), [resolvedPeople]);
  // 수동 구분 선택이 필요한 선택 인원 — 순수 수동 모드 전원 + 자동 판정 실패 폴백(auto=false). 자동 배정자는 제외.
  const manualPeople = useMemo(() => resolvedPeople.filter((p) => !p.auto), [resolvedPeople]);

  const variantByKey = (key: string | null): GuestOption | null =>
    key ? item.variants.find((v) => v.key === key) ?? null : null;

  // 인원별 variant 단가 합(서버 동형 재계산, 표시용). 미배정은 0 기여.
  const ticketVariantTotalVnd = useMemo(() => {
    if (!isTicketVariantPerson) return null;
    const groups = groupPeopleByVariant(resolvedPeople);
    return ticketGroupsTotalVnd(
      groups,
      { priceVnd: item.priceVnd ? BigInt(item.priceVnd) : null },
      options,
      selection.addonKeys,
      selection.modifierKeys
    );
  }, [isTicketVariantPerson, resolvedPeople, item.priceVnd, options, selection.addonKeys, selection.modifierKeys]);

  // 카드 하단 "요금 영역"(참고용, 서버 재계산이 정본) — 품목별 합계 표시.
  //   variant-person 모드: 구분별 소계 줄("라벨 ×N = 금액") + 카드 합계. 그 외: 단가 × 수량 = 합계.
  const ticketSubtotals = useMemo(() => {
    if (!isTicketVariantPerson) return [];
    const groups = groupPeopleByVariant(resolvedPeople);
    return ticketGroupSubtotals(
      groups,
      { priceVnd: item.priceVnd ? BigInt(item.priceVnd) : null },
      options,
      selection.addonKeys,
      selection.modifierKeys
    );
  }, [isTicketVariantPerson, resolvedPeople, item.priceVnd, options, selection.addonKeys, selection.modifierKeys]);

  // 일반(수량 스테퍼) 카드 요금 — 단가(1개, variant+addons 반영) + 합계(단가×수량). 선택 무효면 null.
  const generalFee = useMemo(() => {
    if (isTicketVariantPerson || selection.quantity < 1) return null;
    try {
      const unit = resolveOrderPricing(
        { priceVnd: item.priceVnd ? BigInt(item.priceVnd) : null },
        options,
        {
          variantKey: selection.variantKey,
          addonKeys: selection.addonKeys,
          modifierKeys: selection.modifierKeys,
          quantity: 1,
        }
      ).totalPriceVnd;
      return { unitVnd: unit, totalVnd: unit * BigInt(selection.quantity) };
    } catch (e) {
      if (e instanceof ServiceSelectionError) return null;
      throw e;
    }
  }, [isTicketVariantPerson, item.priceVnd, options, selection.variantKey, selection.addonKeys, selection.modifierKeys, selection.quantity]);

  // 비-variant TICKET(단일가) 이용자 체크 토글 — 기존 흐름.
  const toggleTicketGuest = (idx: number) => {
    const has = selection.ticketGuestIdxs.includes(idx);
    const next = has
      ? selection.ticketGuestIdxs.filter((i) => i !== idx)
      : [...selection.ticketGuestIdxs, idx];
    onChange({ ...selection, ticketGuestIdxs: next, quantity: next.length });
  };

  // variant-person 모드 이용자 체크 토글 — 체크 해제 시 그 사람의 수동 배정도 제거(신장은 폼 전역 공유라 유지).
  const toggleTicketPerson = (idx: number) => {
    const has = selection.ticketGuestIdxs.includes(idx);
    if (has) {
      const nextIdxs = selection.ticketGuestIdxs.filter((i) => i !== idx);
      const nextVars = { ...selection.ticketGuestVariants };
      delete nextVars[idx];
      onChange({ ...selection, ticketGuestIdxs: nextIdxs, ticketGuestVariants: nextVars, quantity: nextIdxs.length });
    } else {
      const nextIdxs = [...selection.ticketGuestIdxs, idx];
      // 순수 수동 모드면 기본 variant 미리 배정(첫 variant). 자동 모드는 파생이라 미설정.
      const nextVars = autoMode || !firstVariantKey
        ? selection.ticketGuestVariants
        : { ...selection.ticketGuestVariants, [idx]: firstVariantKey };
      onChange({ ...selection, ticketGuestIdxs: nextIdxs, ticketGuestVariants: nextVars, quantity: nextIdxs.length });
    }
  };

  // 수동 배정(순수 수동 모드·자동 실패 폴백에서 사람이 직접 구분 선택).
  const setTicketPersonVariant = (idx: number, key: string) =>
    onChange({ ...selection, ticketGuestVariants: { ...selection.ticketGuestVariants, [idx]: key } });

  // 하단 큰 가격 — variant-person이면 인원별 구분 단가 합(미선택이면 첫 variant 단가 힌트), 그 외는 기존 미리보기.
  const previewStr = isTicketVariantPerson
    ? ticketVariantTotalVnd != null && ticketVariantTotalVnd > 0n
      ? guestVndPrice(toVndStr(ticketVariantTotalVnd))
      : guestVndPrice(item.variants[0]?.priceVnd ?? item.priceVnd)
    : preview != null
      ? guestVndPrice(toVndStr(preview.totalPriceVnd))
      : guestVndPrice(item.priceVnd);

  const badgeCls = TYPE_BADGE[item.type] ?? "bg-slate-100 text-slate-500";
  const active = selection.quantity > 0;
  // 이행 방식 안내(#5) — 배송형/예약형(픽업·방문)/기타. 날짜·시간 입력과 함께 노출.
  //   예약형은 카탈로그 pickupAvailable/pickupNote로 픽업 제공/직접 방문/미정 세분.
  const mode = fulfillmentMode(item.type);
  const fulfillNote = fulfillmentNote(item.type, item.pickupAvailable, item.pickupNote, labels);
  // 업로드 사진 우선, 없으면 타입 기본 이미지(폴백)
  const photo = catalogImage(item.type, item.photoUrl);

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm overflow-hidden ${
        active ? "border-2 border-teal-200" : "border border-slate-100"
      }`}
    >
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="w-full h-36 object-cover" alt={item.name} src={photo} loading="lazy" decoding="async" />
      )}
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-base text-slate-900">{item.name}</h3>
            {item.desc && <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>}
          </div>
          <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${badgeCls}`}>
            {badgeText}
          </span>
        </div>

        {/* variants — 1택, 가격 대체. ★variant-person(TICKET+명단) 모드에선 인원별 지정으로 대체 → 숨김. */}
        {item.variants.length > 0 && !isTicketVariantPerson && (
          <div>
            <p className="text-[11px] font-bold text-slate-500 mb-1.5">{labels.timeLabel}</p>
            <div className="grid grid-cols-2 gap-2">
              {item.variants.map((v) => {
                const on = selection.variantKey === v.key;
                return (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => pickVariant(v.key)}
                    className={`rounded-lg px-3 py-2.5 text-left ${
                      on ? "border-2 border-teal-500 bg-teal-50" : "border border-slate-200 bg-white"
                    }`}
                  >
                    <p className={`text-xs font-bold ${on ? "text-teal-700" : "text-slate-500"}`}>
                      {v.label}
                    </p>
                    <p
                      className={`text-sm font-extrabold tabular-nums ${
                        on ? "text-slate-900" : "text-slate-700"
                      }`}
                    >
                      {guestVndPrice(v.priceVnd)}
                    </p>
                    {v.desc && (
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{v.desc}</p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* addons — 다중. ≤4면 인라인 토글, 그 이상은 바텀시트 */}
        {item.addons.length > 0 && item.addons.length <= 4 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-500">{labels.addonsLabel}</p>
            {item.addons.map((a) => (
              <label
                key={a.key}
                className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 cursor-pointer"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={selection.addonKeys.includes(a.key)}
                    onChange={() => toggleAddon(a.key)}
                    className="w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="text-sm text-slate-800 block">{a.label}</span>
                    {a.desc && <span className="text-[11px] text-slate-400 block leading-snug">{a.desc}</span>}
                  </span>
                </span>
                <span className="text-xs font-semibold text-teal-600 tabular-nums shrink-0">
                  {guestVndDelta(a.priceVnd)}
                </span>
              </label>
            ))}
          </div>
        )}
        {item.addons.length > 4 && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="w-full flex items-center justify-between rounded-lg border border-dashed border-teal-300 bg-teal-50/40 px-3 py-2.5 active:scale-[0.99]"
          >
            <span className="text-sm font-semibold text-teal-700">
              {labels.addonsTrigger(item.addons.length)}
            </span>
            <span className="flex items-center gap-2">
              {selection.addonKeys.length > 0 && (
                <span className="bg-teal-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums">
                  {labels.selectedCount(selection.addonKeys.length)}
                </span>
              )}
              <span className="material-symbols-outlined text-teal-600 text-[20px]">expand_more</span>
            </span>
          </button>
        )}
        {item.addons.length > 4 && selectedAddons.length > 0 && (
          <p className="text-[11px] text-slate-400">
            {selectedAddons.map((a) => a.label).join(" · ")}
          </p>
        )}

        {/* modifiers — 토글, 가산 */}
        {item.modifiers.map((m) => (
          <label
            key={m.key}
            className="flex items-center justify-between rounded-xl border border-fuchsia-100 bg-fuchsia-50/40 px-3 py-2.5 cursor-pointer"
          >
            <span className="min-w-0">
              <span className="text-sm font-semibold text-slate-800 block">{m.label}</span>
              {m.desc && <span className="text-[11px] text-slate-400 block leading-snug">{m.desc}</span>}
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-bold text-teal-600 tabular-nums">
                {guestVndDelta(m.priceVnd)}
              </span>
              <input
                type="checkbox"
                checked={selection.modifierKeys.includes(m.key)}
                onChange={() => toggleModifier(m.key)}
                className="w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
            </span>
          </label>
        ))}

        {/* TICKET 이용자 선택(ADR-0036) — 체크인 명단에서 이름 칩 토글. 선택 수 = 수량. 명단 비면 이 블록 없음(기존 스테퍼).
            ★생년월일·신장은 상단 "티켓 이용자 정보" 카드에서 1회 입력 — 여기선 이름 칩만(테오 2026-07-12). */}
        {isTicketWithGuests && !isTicketVariantPerson && (
          <div className="space-y-2 rounded-xl border border-sky-100 bg-sky-50/50 p-3">
            <p className="flex items-center gap-1 text-[11px] font-bold text-sky-700">
              <span className="material-symbols-outlined text-[15px]">confirmation_number</span>
              {labels.ticketGuestTitle}
            </p>
            <p className="text-[11px] text-slate-500 leading-snug">{labels.ticketGuestHint}</p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {checkedInGuests.map((g, idx) => {
                const on = selection.ticketGuestIdxs.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleTicketGuest(idx)}
                    aria-pressed={on}
                    className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm active:scale-95 ${
                      on ? "border-sky-400 bg-white font-semibold text-slate-800" : "border-slate-200 bg-white text-slate-500"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">{on ? "check_circle" : "add_circle"}</span>
                    <span className="truncate max-w-[9rem]">{g.name ?? "—"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* TICKET 인원별 연령/신장 구분 지정(ADR-0036 개정) — 이름 칩(체크 토글) + 자동 판정 구분/단가 배지.
            ★생년월일·신장·현장측정 고지는 상단 "티켓 이용자 정보" 카드에서 1회. 신장 1회 입력이 모든 티켓 판정에 공유됨. */}
        {isTicketVariantPerson && (
          <div className="space-y-2 rounded-xl border border-sky-100 bg-sky-50/50 p-3">
            <p className="flex items-center gap-1 text-[11px] font-bold text-sky-700">
              <span className="material-symbols-outlined text-[15px]">confirmation_number</span>
              {labels.ticketGuestTitle}
            </p>
            <p className="text-[11px] text-slate-500 leading-snug">
              {autoMode ? labels.ticketGuestAutoHint : labels.ticketGuestVariantHint}
            </p>
            {/* 이름 칩 — 선택 시 자동 판정 구분(라벨+단가) 배지. 수동 모드/자동 실패자는 아래에서 구분 선택. */}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {checkedInGuests.map((g, idx) => {
                const on = selection.ticketGuestIdxs.includes(idx);
                const rp = resolvedByIdx.get(idx);
                const autoV = rp?.auto ? variantByKey(rp.key) : null;
                const manualV = on && rp && !rp.auto && rp.key ? variantByKey(rp.key) : null;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleTicketPerson(idx)}
                    aria-pressed={on}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm active:scale-95 ${
                      on ? "border-sky-400 bg-white font-semibold text-slate-800" : "border-slate-200 bg-white text-slate-500"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">{on ? "check_circle" : "add_circle"}</span>
                    <span className="truncate max-w-[9rem]">{g.name ?? "—"}</span>
                    {/* 자동 판정 배지 — 구분 라벨(소비자 변경 불가) + 단가 */}
                    {on && autoV && (
                      <span className="flex items-center gap-1">
                        <span className="rounded-full bg-sky-100 px-1.5 py-px text-[10px] font-bold text-sky-700">{autoV.label}</span>
                        <span className="text-[11px] tabular-nums text-slate-500">{guestVndPrice(autoV.priceVnd)}</span>
                      </span>
                    )}
                    {/* 수동 배정된 구분(아래 선택 반영) */}
                    {manualV && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-600">{manualV.label}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* 수동 구분 선택 — 순수 수동 모드(성인/어린이 등) 또는 자동 판정 실패 폴백. 선택된 사람만 노출. */}
            {manualPeople.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {autoMode && (
                  <p className="text-[11px] text-amber-600 leading-snug">{labels.ticketGuestManualHint}</p>
                )}
                {manualPeople.map((p) => {
                  const g = checkedInGuests[p.idx];
                  return (
                    <div key={p.idx} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <p className="text-xs font-semibold text-slate-700 mb-1.5 truncate">{g?.name ?? "—"}</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {item.variants.map((v) => {
                          const sel = p.key === v.key;
                          return (
                            <button
                              key={v.key}
                              type="button"
                              onClick={() => setTicketPersonVariant(p.idx, v.key)}
                              className={`rounded-lg px-2.5 py-1.5 text-left ${
                                sel ? "border-2 border-sky-500 bg-sky-50" : "border border-slate-200 bg-white"
                              }`}
                            >
                              <span className={`block text-[11px] font-bold ${sel ? "text-sky-700" : "text-slate-500"}`}>
                                {v.label}
                              </span>
                              <span className="block text-xs font-extrabold tabular-nums text-slate-800">
                                {guestVndPrice(v.priceVnd)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 희망 날짜·시간 (#3) — 수량 선택 시 노출. 필수(미입력 시 신청 차단). */}
        {active && (
          <>
            <div
              className={`flex items-start gap-2 rounded-lg px-3 py-2 ${
                mode === "APPOINTMENT"
                  ? "bg-fuchsia-50 text-fuchsia-700"
                  : "bg-teal-50 text-teal-700"
              }`}
            >
              <span className="material-symbols-outlined text-[16px] mt-0.5">
                {mode === "DELIVERY" ? "local_shipping" : mode === "APPOINTMENT" ? "directions_car" : "info"}
              </span>
              <p className="text-[11px] leading-snug">{fulfillNote}</p>
            </div>
            <div className={hideTime ? "pt-1" : "grid grid-cols-2 gap-2 pt-1"}>
            <div>
              <label className="text-[11px] font-bold text-slate-500 mb-1 block">
                {labels.serviceDateLabel} <span className="text-rose-500">*</span>
              </label>
              <DateField
                min={dateMin}
                max={dateMax}
                aria-label={labels.serviceDateLabel}
                title={labels.serviceDateLabel}
                value={selection.serviceDate ?? ""}
                onChange={(e) => onChange({ ...selection, serviceDate: e.target.value || null })}
                placeholder={labels.serviceDatePlaceholder}
                placeholderClassName="text-neutral-400"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
            {/* TICKET은 시간 입력 없음(날짜만) — 오전/오후/야간은 카탈로그 variant로 구분(테오 2026-07-12) */}
            {!hideTime && (
              <div>
                <label className="text-[11px] font-bold text-slate-500 mb-1 block">
                  {labels.serviceTimeLabel} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="time"
                  aria-label={labels.serviceTimeLabel}
                  title={labels.serviceTimeLabel}
                  value={selection.serviceTime ?? ""}
                  onChange={(e) => onChange({ ...selection, serviceTime: e.target.value || null })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>
            )}
            </div>
            {/* 요청사항(선택) — 게스트 특이사항을 이행자(원천 공급자)에게 전달. 최대 500자. */}
            <div className="pt-1">
              <label className="text-[11px] font-bold text-slate-500 mb-1 block">
                {labels.noteLabel}
              </label>
              <textarea
                rows={2}
                maxLength={NOTE_MAX}
                aria-label={labels.noteLabel}
                placeholder={labels.notePlaceholder}
                value={selection.guestNote ?? ""}
                onChange={(e) =>
                  onChange({ ...selection, guestNote: e.target.value || null })
                }
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-300 focus:ring-teal-500 focus:border-teal-500 resize-none"
              />
            </div>
          </>
        )}

        {/* 요금 영역(참고용) — 수량>0일 때 품목별 합계. 서버가 최종 재계산(변조 방지). */}
        {active && (isTicketVariantPerson ? ticketSubtotals.length > 0 : generalFee != null) && (
          <div className="rounded-lg border border-teal-100 bg-teal-50/50 px-3 py-2 space-y-1">
            {isTicketVariantPerson ? (
              <>
                {/* 구분별 소계 줄 — "라벨 ×N = 금액" */}
                {ticketSubtotals.map((s) => (
                  <div
                    key={s.variantKey}
                    className="flex items-center justify-between text-[11px] text-slate-600"
                  >
                    <span className="min-w-0 truncate">
                      {variantByKey(s.variantKey)?.label ?? "—"}{" "}
                      <span className="tabular-nums text-slate-400">×{s.count}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {guestVndPrice(toVndStr(s.subtotalVnd))}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-teal-100 pt-1">
                  <span className="text-xs font-bold text-slate-700">{labels.itemTotal}</span>
                  <span className="text-sm font-extrabold text-teal-700 tabular-nums">
                    {guestVndPrice(toVndStr(ticketVariantTotalVnd ?? 0n))}
                  </span>
                </div>
              </>
            ) : (
              generalFee != null && (
                <div className="flex items-center justify-between">
                  {/* 단가 × 수량 명세 */}
                  <span className="text-[11px] tabular-nums text-slate-500">
                    {guestVndPrice(toVndStr(generalFee.unitVnd))} × {selection.quantity}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-700">{labels.itemTotal}</span>
                    <span className="text-sm font-extrabold text-teal-700 tabular-nums">
                      {guestVndPrice(toVndStr(generalFee.totalVnd))}
                    </span>
                  </span>
                </div>
              )
            )}
          </div>
        )}

        {/* 가격 + 수량 스테퍼. TICKET 이용자 선택 모드에선 수량이 선택 인원으로 결정되므로 스테퍼 대신 선택 수 표기. */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-extrabold text-slate-900 tabular-nums">{previewStr}</span>
            {item.unitLabel && (
              <span className="text-xs text-slate-400">{labels.perUnit(item.unitLabel)}</span>
            )}
          </div>
          {isTicketWithGuests ? (
            <span className="text-sm font-bold text-sky-700 tabular-nums">
              {labels.selectedCount(selection.quantity)}
            </span>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQty(-1)}
                className="w-9 h-9 rounded-full border border-slate-200 text-slate-400 flex items-center justify-center text-lg active:scale-95"
              >
                −
              </button>
              <span className="w-5 text-center font-bold tabular-nums">{selection.quantity}</span>
              <button
                type="button"
                onClick={() => setQty(1)}
                className="w-9 h-9 rounded-full bg-teal-600 text-white flex items-center justify-center text-lg active:scale-95"
              >
                +
              </button>
            </div>
          )}
        </div>
      </div>

      {/* addons 바텀시트 (다중선택 체크리스트) */}
      {sheetOpen && (
        <div className="fixed inset-0 z-[60] max-w-md mx-auto">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSheetOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-base text-slate-900">{labels.sheetTitle}</h3>
                <p className="text-[11px] text-slate-400">{labels.sheetHint}</p>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="p-2 rounded-full hover:bg-slate-50 active:scale-95"
              >
                <span className="material-symbols-outlined text-slate-500">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 divide-y divide-slate-100">
              {item.addons.map((a) => (
                <label
                  key={a.key}
                  className="flex items-center justify-between px-2 py-3 cursor-pointer"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={selection.addonKeys.includes(a.key)}
                      onChange={() => toggleAddon(a.key)}
                      className="w-5 h-5 rounded border-slate-300 text-teal-600 focus:ring-teal-500 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="text-sm text-slate-800 block">{a.label}</span>
                      {a.desc && <span className="text-[11px] text-slate-400 block leading-snug">{a.desc}</span>}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                    {guestVndDelta(a.priceVnd)}
                  </span>
                </label>
              ))}
            </div>
            <div className="border-t border-slate-100 px-5 py-4 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-[11px] text-slate-400">
                  {labels.selectedCount(selection.addonKeys.length)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="h-12 px-8 bg-teal-600 text-white font-bold rounded-xl active:scale-[0.98]"
              >
                {labels.apply}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function optToDef(o: GuestOption) {
  return { key: o.key, labelKo: o.label, priceVnd: o.priceVnd };
}
