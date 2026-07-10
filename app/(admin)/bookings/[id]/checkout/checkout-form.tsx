"use client";

// 체크아웃 검수 폼 (b4 변환, T3.3) — 공간별 비교 업로드 + 미니바 소모 입력(#2b) +
// 파손 리포트 + 하단 고정 액션 바 (전액 환불 / 차감 후 환불 승인)
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { resizeImage } from "@/lib/image-resize";
import { formatThousands } from "@/lib/format";
import { computeGuestBill, type GuestSettlementMethodValue } from "@/lib/checkout-settlement";
import { InlineGuide } from "@/components/inline-guide";
import ImageLightbox, { type LightboxImage } from "@/components/image-lightbox";

interface Section {
  id: string;
  label: string;
  baselineUrl: string | null;
}
interface MinibarItem {
  id: string;
  /** 회사표준 품목 표시명(로케일별 서버 해석) */
  label: string;
  /** 미니바 고객 청구 단가(= 우리 판매가, VND 동 단위 문자열) */
  unitPriceVnd: string;
  /** 비치 목표(par) — 빌라 오버라이드 ?? 회사표준 stockQty. "남은 수량" 입력 상한·기본값. */
  par: number;
  /** 현재고(onHand) — MinibarStockMovement ΣqtyDelta. 참고 표시용. */
  onHand: number;
}

/** 확정 부가옵션(CONFIRMED|DELIVERED) — 게스트 청구서용. 판매가만(원가 비노출, ADR-0019 S4). */
export interface ConfirmedServiceOrder {
  id: string;
  /** 표시명(카탈로그명 또는 유형 라벨, 서버 해석) */
  name: string;
  quantity: number;
  /** 판매가 KRW (스냅샷, 없으면 null) */
  priceKrw: number | null;
  /** 판매가 VND (스냅샷 문자열, 없으면 null) */
  priceVnd: string | null;
}

const SETTLEMENT_METHODS: GuestSettlementMethodValue[] = ["CASH", "BANK_TRANSFER", "OTHER"];

export default function CheckoutForm({
  bookingId,
  sections,
  minibar,
  depositLabel,
  depositVnd,
  confirmedOrders,
}: {
  bookingId: string;
  sections: Section[];
  minibar: MinibarItem[];
  depositLabel: string | null;
  /** 보증금이 VND일 때만 — 환불 예정액 계산용 (동 단위 숫자 문자열) */
  depositVnd: string | null;
  /** 확정 부가옵션(CONFIRMED|DELIVERED) — 게스트 청구서 합산용. 판매가만. */
  confirmedOrders: ConfirmedServiceOrder[];
}) {
  const t = useTranslations("adminCheckout");
  const router = useRouter();

  const [photos, setPhotos] = useState<Record<string, string>>({}); // sectionId → url
  const [uploading, setUploading] = useState<string | null>(null);
  const [damageFound, setDamageFound] = useState(false);
  const [damageNote, setDamageNote] = useState("");
  const [damagePhotos, setDamagePhotos] = useState<string[]>([]);
  const [deduction, setDeduction] = useState(""); // 파손 등 기타 차감 (동 단위 숫자 문자열)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  // 게스트 통합정산 수납 (ADR-0019 S4) — 결제수단(선택)·메모. 미선택도 허용(청구액만 기록·미수납).
  const [settlementMethod, setSettlementMethod] = useState<GuestSettlementMethodValue | null>(null);
  const [settlementNote, setSettlementNote] = useState("");

  // 라이트박스 이미지 — 섹션별 기준→체크아웃 사진 (클릭 확대)
  const lightboxImages: LightboxImage[] = sections.flatMap((s) => {
    const items: LightboxImage[] = [];
    if (s.baselineUrl) items.push({ url: s.baselineUrl, label: `${s.label} · ${t("baseline")}` });
    const up = photos[s.id];
    if (up) items.push({ url: up, label: `${s.label} · ${t("checkoutPhoto")}` });
    return items;
  });
  const openLightbox = (url: string) => {
    const idx = lightboxImages.findIndex((im) => im.url === url);
    if (idx >= 0) setLightbox(idx);
  };

  // ── 미니바 "남은 수량" 입력 (소모 자동계산) ─────────────────────────
  // 운영자는 소모량을 직접 세지 않는다. 현재 "남은 수량(remaining)"만 입력하면
  //   소비량 = 비치목표(par) − 남은수량 으로 시스템이 역산한다(0 ≤ remaining ≤ par 클램프).
  // remainingMap[id] = 남은 수량. 미입력(undefined) = 기본값 par(소비 0).
  const [remainingMap, setRemainingMap] = useState<Record<string, number>>({});

  /** 남은 수량 변경 (0 ~ par 클램프) — 스테퍼·직접입력 공통. remaining>par 또는 음수 방지. */
  const setRemainingClamped = (item: MinibarItem, next: number) => {
    const clamped = Math.max(0, Math.min(item.par, Math.trunc(next || 0)));
    setRemainingMap((r) => ({ ...r, [item.id]: clamped }));
  };

  /** 행별 결과 — 남은수량 → 소비량(par−remaining) 역산, 차감액 = 소비 × 단가(BigInt, float 금지) */
  const minibarRows = minibar.map((m) => {
    const remaining = remainingMap[m.id] ?? m.par; // 기본값 = par(소비 0)
    const consumed = Math.max(0, m.par - remaining); // 음수 소비 방지 clamp
    const unit = BigInt(m.unitPriceVnd);
    const lineDeduction = unit * BigInt(consumed);
    return { item: m, remaining, consumed, unit, lineDeduction };
  });

  /** 미니바 차감 합계(BigInt) */
  const minibarTotal = minibarRows.reduce((sum, r) => sum + r.lineDeduction, 0n);

  // ── 게스트 청구서 합산 (ADR-0019 S4) ───────────────────────────
  //   미니바 소비(실시간 미리보기, 단가는 서버 스냅샷이 정본) + 확정 부가옵션(판매가만).
  //   통화별 분리(ADR-0003): VND/KRW 합산 금지. 보증금 차감은 별개(아래 보증금 정산 섹션).
  const guestBill = computeGuestBill(
    minibarTotal,
    confirmedOrders.map((o) => ({
      priceKrw: o.priceKrw,
      priceVnd: o.priceVnd != null ? BigInt(o.priceVnd) : null,
    }))
  );

  const upload = async (file: File): Promise<string | null> => {
    try {
      const blob = await resizeImage(file);
      const formData = new FormData();
      formData.append("file", new File([blob], file.name, { type: blob.type }));
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      if (!res.ok) return null;
      const data = await res.json();
      return data.url ?? null;
    } catch {
      return null;
    }
  };

  const onSectionPhoto = async (sectionId: string, file: File | null) => {
    if (!file) return;
    setUploading(sectionId);
    setError(null);
    const url = await upload(file);
    if (url) setPhotos((p) => ({ ...p, [sectionId]: url }));
    else setError(t("uploadError"));
    setUploading(null);
  };

  const onDamagePhoto = async (file: File | null) => {
    if (!file) return;
    setUploading("damage");
    const url = await upload(file);
    if (url) setDamagePhotos((p) => [...p, url]);
    else setError(t("uploadError"));
    setUploading(null);
  };

  const photoUrls = Object.values(photos);
  const deductionDigits = deduction.replace(/[^\d]/g, "");
  const damageDeductionVnd =
    damageFound && /^\d+$/.test(deductionDigits) ? BigInt(deductionDigits) : 0n;
  const deductionValid = /^\d+$/.test(deductionDigits) && BigInt(deductionDigits) > 0n;

  // 총 차감액 = 미니바 자동 차감 + 파손 등 기타 차감 (BigInt, float 금지)
  const totalDeductionVnd = minibarTotal + damageDeductionVnd;

  const canRefundFull = !damageFound && photoUrls.length >= 1 && !busy;
  const canDeduct =
    damageFound &&
    photoUrls.length >= 1 &&
    deductionValid &&
    (damageNote.trim().length > 0 || damagePhotos.length > 0) &&
    !busy;
  // 미니바만 차감(파손 없음)으로도 "차감 후 환불 승인" 가능 — 보증금 VND일 때만
  const canDeductMinibarOnly =
    // 보증금 미수취(NONE)여도 허용 — 미니바는 보증금 차감이 아니라 게스트 청구(정산)로 기록되므로
    // 여기서 막으면 무보증금+미니바 소비 조합의 체크아웃이 불가능해진다(consumer-bugs #5, 서버는 NONE 유지).
    !damageFound && photoUrls.length >= 1 && minibarTotal > 0n && !busy;

  // 환불 예정액 — 보증금 VND일 때만 산출 (BigInt, float 금지)
  const refundEstimate = (() => {
    if (!depositVnd) return null;
    const deposit = BigInt(depositVnd);
    const left = deposit > totalDeductionVnd ? deposit - totalDeductionVnd : 0n;
    return `${formatThousands(left)}₫`;
  })();

  /** 미니바 소모 요약 메모 (차감 근거 증빙 — 소모>0 항목만) */
  const minibarNote = () => {
    const lines = minibarRows
      .filter((r) => r.consumed > 0)
      .map((r) => `${r.item.label} x${r.consumed} = ${formatThousands(r.lineDeduction)}₫`);
    if (lines.length === 0) return "";
    return `${t("minibarNotePrefix")} ${lines.join(", ")}`;
  };

  // 차감이 발생하면(미니바+파손>0) BE 보증금 차감 경로(damageFound) 사용 —
  // 미니바 소모도 보증금 차감 근거이므로 deductionVnd로 반영(ADR-0003: 소모분 deductionVnd 반영).
  const hasDeduction = totalDeductionVnd > 0n;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // 차감 근거 메모 — 파손 메모 + 미니바 소모 요약 결합 (둘 중 하나라도 있으면 전송)
      const combinedNote = [damageFound && damageNote.trim() ? damageNote.trim() : "", minibarNote()]
        .filter(Boolean)
        .join("\n");
      // 미니바 판매 라인 — 소모>0만. 가격은 보내지 않는다(서버가 스냅샷 재계산, 마진 비공개).
      //   "남은 수량(remaining)"을 보내면 서버가 par를 재조회해 소비량을 역산한다(클라 par/소비 신뢰 금지).
      const minibarLines = minibarRows
        .filter((r) => r.consumed > 0)
        .map((r) => ({
          minibarItemId: r.item.id,
          remaining: r.remaining,
        }));
      const res = await fetch(`/api/bookings/${bookingId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoUrls,
          // 보증금에서 차감하는 모든 경로(미니바 소모·파손)는 BE 차감 경로로 통일
          damageFound: hasDeduction,
          damageNote: hasDeduction && combinedNote ? combinedNote : undefined,
          damagePhotoUrls: hasDeduction && damagePhotos.length ? damagePhotos : undefined,
          deductionVnd: hasDeduction ? totalDeductionVnd.toString() : undefined,
          // 미니바 품목별 판매 캡처(매출·마진 통계 소스). 0건이면 빈 배열(라인 미생성).
          minibarLines: minibarLines.length ? minibarLines : undefined,
          // 게스트 통합정산 수납(ADR-0019 S4) — 결제수단 선택 시에만. 미선택이면 청구액만 기록(미수납).
          settlement: settlementMethod
            ? { method: settlementMethod, note: settlementNote.trim() || undefined }
            : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? data?.error ?? t("submitError"));
        setBusy(false);
        return;
      }
      router.replace(`/bookings/${bookingId}`);
      router.refresh();
    } catch {
      setError(t("submitError"));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-10">
      {/* 객실 상태 비교 (b4 Comparison Grid) */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap text-white">
            <span className="material-symbols-outlined text-admin-primary">visibility</span>
            {t("comparison")}
          </h3>
          <div className="text-xs text-slate-500 flex gap-4 whitespace-nowrap">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> {t("baseline")}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> {t("checkoutPhoto")}
            </span>
          </div>
        </div>
        {/* 인라인 가이드 — T-9 */}
        <div className="mb-6">
          <InlineGuide variant="dark" text={t("guide.photos")} />
        </div>
        <div className="space-y-8">
          {sections.map((section) => {
            const uploaded = photos[section.id];
            return (
              <div key={section.id} className="bg-admin-card rounded-xl p-6 border border-slate-800 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-slate-200 whitespace-nowrap">{section.label}</h4>
                  {uploaded ? (
                    <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded whitespace-nowrap">
                      {t("sectionDone")}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-1 rounded whitespace-nowrap">
                      {t("sectionMissing")}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500 font-medium whitespace-nowrap">{t("baseline")}</p>
                    {section.baselineUrl ? (
                      <button
                        type="button"
                        onClick={() => openLightbox(section.baselineUrl!)}
                        aria-label={`${section.label} — ${t("baseline")}`}
                        className="block w-full aspect-video rounded-lg overflow-hidden relative cursor-zoom-in"
                      >
                        <Image src={section.baselineUrl} alt={section.label} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
                      </button>
                    ) : (
                      <div className="aspect-video rounded-lg border border-slate-700 flex flex-col items-center justify-center text-slate-600">
                        <span className="material-symbols-outlined text-3xl mb-1">hide_image</span>
                        <span className="text-xs">{t("baselineMissing")}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500 font-medium whitespace-nowrap">{t("checkoutPhoto")}</p>
                    {uploaded ? (
                      <button
                        type="button"
                        onClick={() => openLightbox(uploaded)}
                        aria-label={`${section.label} — ${t("checkoutPhoto")}`}
                        className="block w-full aspect-video rounded-lg overflow-hidden relative cursor-zoom-in"
                      >
                        <Image src={uploaded} alt={`${section.label} — ${t("checkoutPhoto")}`} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
                      </button>
                    ) : (
                      <label className="aspect-video rounded-lg border-2 border-dashed border-slate-600 flex flex-col items-center justify-center text-slate-500 hover:text-white hover:border-slate-400 transition-all cursor-pointer">
                        <span className="material-symbols-outlined text-4xl mb-2">
                          {uploading === section.id ? "hourglass_top" : "photo_camera"}
                        </span>
                        <span className="text-xs font-bold whitespace-nowrap">
                          {uploading === section.id ? t("uploading") : t("uploadPhoto")}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploading !== null}
                          onChange={(e) => onSectionPhoto(section.id, e.target.files?.[0] ?? null)}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <ImageLightbox images={lightboxImages} index={lightbox} onIndexChange={setLightbox} />

      {/* 미니바 차감 자동계산 (b16) — 소모=비치−남은, 차감액=소모×단가 실시간 */}
      <section className="bg-admin-card rounded-xl border border-slate-800 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-b border-slate-800 bg-slate-800/30">
          <h3 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap text-white">
            <span className="material-symbols-outlined text-admin-primary">liquor</span>
            {t("minibar")}
          </h3>
          <span className="text-[10px] bg-admin-primary/10 text-admin-primary border border-admin-primary/20 px-2 py-1 rounded font-bold whitespace-nowrap flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">calculate</span>
            {t("autoCalc")}
          </span>
        </div>

        {/* 인라인 가이드 — T-9 */}
        <div className="px-6 pt-4">
          <InlineGuide variant="dark" text={t("guide.minibar")} />
        </div>

        {minibar.length === 0 ? (
          <p className="text-sm text-slate-500 p-6">{t("minibarEmpty")}</p>
        ) : (
          <>
            {/* 데스크톱(≥768px): 표 — "남은 수량" 입력, 소비량·차감액 자동계산 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse tabular-nums">
                <thead>
                  <tr className="text-[11px] font-bold text-slate-500 uppercase tracking-wider bg-slate-900/50">
                    <th className="px-6 py-3 border-b border-slate-800">{t("item")}</th>
                    <th className="px-6 py-3 border-b border-slate-800 text-right">{t("unitPrice")}</th>
                    <th className="px-6 py-3 border-b border-slate-800 text-center">{t("par")}</th>
                    <th className="px-6 py-3 border-b border-slate-800 text-center">{t("remainingQty")}</th>
                    <th className="px-6 py-3 border-b border-slate-800 text-center">{t("consumedQty")}</th>
                    <th className="px-6 py-3 border-b border-slate-800 text-right">{t("lineDeduction")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {minibarRows.map(({ item, remaining, consumed, lineDeduction }) => (
                    <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-200">
                        {item.label}
                        <span className="block text-[11px] text-slate-500 font-normal">
                          {t("onHandLabel")}: {item.onHand}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-slate-400">
                        {formatThousands(item.unitPriceVnd)}₫
                      </td>
                      <td className="px-6 py-4 text-center text-slate-400 font-bold">{item.par}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="inline-flex items-center bg-slate-900 rounded border border-slate-700 p-0.5">
                          <button
                            type="button"
                            aria-label={t("decrement")}
                            disabled={remaining <= 0}
                            onClick={() => setRemainingClamped(item, remaining - 1)}
                            className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            aria-label={`${item.label} ${t("remainingQty")}`}
                            min={0}
                            max={item.par}
                            value={remaining}
                            onChange={(e) => setRemainingClamped(item, parseInt(e.target.value, 10))}
                            className="w-10 bg-transparent border-none text-center text-xs font-bold text-white focus:ring-0 p-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            aria-label={t("increment")}
                            disabled={remaining >= item.par}
                            onClick={() => setRemainingClamped(item, remaining + 1)}
                            className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className={`px-6 py-4 text-center font-bold ${consumed > 0 ? "text-amber-400" : "text-slate-600"}`}>
                        {consumed}
                      </td>
                      <td className={`px-6 py-4 text-right font-bold ${lineDeduction > 0n ? "text-red-400" : "text-slate-600"}`}>
                        {formatThousands(lineDeduction)}₫
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 모바일(<768px): 카드 스택 — "남은 수량" 입력, 소비량 자동표시 */}
            <div className="md:hidden flex flex-col divide-y divide-slate-800/60">
              {minibarRows.map(({ item, remaining, consumed, lineDeduction }) => (
                <div key={item.id} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-slate-200">{item.label}</span>
                    <span className={`font-bold tabular-nums ${lineDeduction > 0n ? "text-red-400" : "text-slate-600"}`}>
                      {formatThousands(lineDeduction)}₫
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs mb-2">
                    <span className="text-slate-500">
                      {formatThousands(item.unitPriceVnd)}₫ · {t("par")}{" "}
                      <span className="text-slate-300 font-bold tabular-nums">{item.par}</span>
                      {" · "}
                      {t("consumedQty")}{" "}
                      <span className="text-amber-400 font-bold tabular-nums">{consumed}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-400 font-bold">{t("remainingQty")}</span>
                    <div className="inline-flex items-center bg-slate-900 rounded border border-slate-700 p-0.5 shrink-0">
                      <button
                        type="button"
                        aria-label={t("decrement")}
                        disabled={remaining <= 0}
                        onClick={() => setRemainingClamped(item, remaining - 1)}
                        className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-30"
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-xs font-bold text-white tabular-nums">{remaining}</span>
                      <button
                        type="button"
                        aria-label={t("increment")}
                        disabled={remaining >= item.par}
                        onClick={() => setRemainingClamped(item, remaining + 1)}
                        className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-30"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 합계 스트라이프 */}
            <div className="bg-amber-500/5 border-t border-slate-800 px-6 py-4 flex justify-between items-center">
              <span className="text-xs font-bold text-amber-500 uppercase tracking-widest">{t("minibarTotal")}</span>
              <span className="text-xl font-black text-amber-500 tabular-nums tracking-tight">
                {formatThousands(minibarTotal)}₫
              </span>
            </div>
          </>
        )}
        <div className="px-6 py-4 flex items-center gap-2 text-xs text-slate-500 bg-slate-800/30">
          <span className="material-symbols-outlined text-sm">info</span>
          <p>{t("minibarInfo")}</p>
        </div>
      </section>

      {/* 게스트 통합 청구서 (ADR-0019 S4, b20 청구서 미니요약) — 미니바 + 확정 부가옵션, 통화별 분리 */}
      <section className="bg-admin-card border border-slate-800 rounded-xl p-6 shadow-sm space-y-5">
        <h3 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap text-white">
          <span className="material-symbols-outlined text-emerald-400">receipt_long</span>
          {t("guestBillTitle")}
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 좌: 합산 내역 */}
          <div className="space-y-4">
            {/* 미니바 소비 합계(실시간 미리보기) */}
            <div className="flex justify-between items-center text-sm border-b border-slate-800 pb-3">
              <span className="text-slate-400">{t("guestBillMinibar")}</span>
              <span className="font-bold text-slate-200 tabular-nums">
                {formatThousands(guestBill.minibarVnd)}₫
              </span>
            </div>

            {/* 확정 부가옵션 목록 (판매가만) */}
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {t("guestBillServices")}
              </p>
              {confirmedOrders.length === 0 ? (
                <p className="text-xs text-slate-600">{t("guestBillNoServices")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {confirmedOrders.map((o) => (
                    <li
                      key={o.id}
                      className="flex justify-between items-start gap-3 text-sm"
                    >
                      <span className="text-slate-300">
                        {o.name}
                        {o.quantity > 1 && (
                          <span className="text-slate-500"> ×{o.quantity}</span>
                        )}
                      </span>
                      <span className="text-right tabular-nums shrink-0">
                        {o.priceKrw != null && (
                          <span className="block text-slate-200 font-semibold">
                            {formatThousands(o.priceKrw)}원
                          </span>
                        )}
                        {o.priceVnd != null && (
                          <span className="block text-slate-400">
                            {formatThousands(o.priceVnd)}₫
                          </span>
                        )}
                        {o.priceKrw == null && o.priceVnd == null && (
                          <span className="text-slate-600">—</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 총 청구액 — 통화별 표기(합산 금지, ADR-0003) */}
            <div className="border-t border-slate-800 pt-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-bold text-white">{t("guestBillTotalVnd")}</span>
                <span className="text-lg font-black text-emerald-400 tabular-nums">
                  {formatThousands(guestBill.totalVnd)}₫
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-white">{t("guestBillTotalKrw")}</span>
                <span className="text-lg font-black text-emerald-400 tabular-nums">
                  {formatThousands(guestBill.totalKrw)}원
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
                {t("guestBillCurrencyNote")}
              </p>
            </div>
          </div>

          {/* 우: 결제수단(선택) + 메모 */}
          <div className="bg-admin-bg border border-slate-800 rounded-lg p-5 space-y-4 self-start">
            <div>
              <p className="text-xs font-bold text-slate-400 tracking-wider mb-3">
                {t("settlementMethod")}
              </p>
              <div className="flex flex-col gap-2">
                {SETTLEMENT_METHODS.map((m) => (
                  <label
                    key={m}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                      settlementMethod === m
                        ? "border-admin-primary bg-admin-primary/10"
                        : "border-slate-700 hover:border-slate-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="settlementMethod"
                      className="accent-admin-primary"
                      checked={settlementMethod === m}
                      onChange={() => setSettlementMethod(m)}
                    />
                    <span className="text-sm font-medium text-slate-200">
                      {t(`settlementMethods.${m}`)}
                    </span>
                  </label>
                ))}
              </div>
              {settlementMethod && (
                <button
                  type="button"
                  onClick={() => setSettlementMethod(null)}
                  className="mt-2 text-xs text-slate-500 hover:text-slate-300"
                >
                  {t("settlementClear")}
                </button>
              )}
              <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                {t("settlementOptionalNote")}
              </p>
            </div>

            <div className="space-y-2">
              <label
                className="text-xs font-bold text-slate-400 tracking-wider"
                htmlFor="settlementNote"
              >
                {t("settlementNote")}
              </label>
              <textarea
                id="settlementNote"
                value={settlementNote}
                onChange={(e) => setSettlementNote(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-white focus:ring-admin-primary focus:border-admin-primary outline-none"
                placeholder={t("settlementNotePlaceholder")}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 파손 및 손실 리포트 (b4 Damage Section) */}
      <section className="bg-[#7F1D1D]/10 border border-[#7F1D1D]/30 rounded-xl p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-admin-alert rounded-lg">
              <span className="material-symbols-outlined text-white">report_problem</span>
            </div>
            <div>
              <h3 className="text-xl font-bold text-white whitespace-nowrap">{t("damageTitle")}</h3>
              <p className="text-sm text-[#F87171]">{t("damageDesc")}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 bg-slate-900 p-2 rounded-full border border-slate-700 whitespace-nowrap self-start">
            <span className="text-sm px-4 font-medium text-slate-400 whitespace-nowrap">{t("damageFound")}</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only"
                checked={damageFound}
                onChange={(e) => setDamageFound(e.target.checked)}
              />
              {/* 켜짐 표시를 React 상태(damageFound)가 직접 제어 — peer-checked CSS 의존 제거 */}
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  damageFound ? "bg-admin-primary" : "bg-slate-700"
                }`}
              >
                <span
                  className={`absolute top-[2px] h-5 w-5 rounded-full border bg-white transition-transform ${
                    damageFound ? "translate-x-[22px] border-white" : "translate-x-[2px] border-gray-300"
                  }`}
                />
              </span>
            </label>
            <span className="text-sm px-4 font-bold text-white whitespace-nowrap">
              {damageFound ? "ON" : "OFF"}
            </span>
          </div>
        </div>

        {damageFound && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="space-y-3">
              <p className="text-xs text-slate-400 font-bold tracking-wider whitespace-nowrap">{t("damagePhotos")}</p>
              <div className="grid grid-cols-2 gap-3">
                {damagePhotos.map((url, i) => (
                  <div key={url} className="relative aspect-square rounded-xl overflow-hidden border-2 border-admin-alert/50">
                    <Image src={url} alt={`${t("damagePhotos")} ${i + 1}`} fill sizes="200px" className="object-cover" />
                    <button
                      type="button"
                      aria-label={t("removePhoto")}
                      onClick={() => setDamagePhotos((p) => p.filter((u) => u !== url))}
                      className="absolute top-2 right-2 bg-black/60 p-1.5 rounded-full hover:bg-red-600 transition-colors"
                    >
                      <span className="material-symbols-outlined text-white text-sm">close</span>
                    </button>
                  </div>
                ))}
                <label className="aspect-square rounded-xl border-2 border-dashed border-slate-600 flex flex-col items-center justify-center text-slate-500 hover:text-white hover:border-slate-400 transition-all cursor-pointer">
                  <span className="material-symbols-outlined text-3xl">
                    {uploading === "damage" ? "hourglass_top" : "add_a_photo"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading !== null}
                    onChange={(e) => onDamagePhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
            <div className="lg:col-span-2 space-y-6">
              <div className="space-y-2">
                <label className="text-xs text-slate-400 font-bold tracking-wider whitespace-nowrap" htmlFor="damageNote">
                  {t("damageNote")}
                </label>
                <textarea
                  id="damageNote"
                  value={damageNote}
                  onChange={(e) => setDamageNote(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-4 text-white font-medium focus:ring-admin-primary focus:border-admin-primary outline-none"
                  placeholder={t("damageNotePlaceholder")}
                />
              </div>
              <div className="space-y-2 max-w-sm">
                <label className="text-xs text-slate-400 font-bold tracking-wider whitespace-nowrap" htmlFor="deduction">
                  {t("deduction")}
                </label>
                <div className="relative">
                  <input
                    id="deduction"
                    type="text"
                    inputMode="numeric"
                    value={deduction ? formatThousands(deductionDigits) : ""}
                    onChange={(e) => setDeduction(e.target.value.replace(/[^\d]/g, ""))}
                    className="w-full bg-slate-900 border-2 border-admin-alert rounded-lg py-3 px-4 text-red-400 font-bold text-lg focus:ring-admin-alert focus:border-admin-alert outline-none whitespace-nowrap"
                    placeholder="0"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-red-400 text-sm whitespace-nowrap">VND</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 보증금 정산 상세 (b16) — 보증금 − 차감 합계 = 환불 예정액 자동 */}
      {depositVnd && (
        <section className="bg-admin-card border border-slate-800 rounded-xl p-6 shadow-sm max-w-md">
          <h5 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">
            {t("settlementTitle")}
          </h5>
          <div className="space-y-3 tabular-nums">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">{t("settlementDeposit")}</span>
              <span className="font-bold text-slate-200">{formatThousands(depositVnd)}₫</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-400">{t("settlementMinibar")} (−)</span>
              <span className="font-bold text-red-400">{formatThousands(minibarTotal)}₫</span>
            </div>
            {damageDeductionVnd > 0n && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">{t("settlementDamage")} (−)</span>
                <span className="font-bold text-red-400">{formatThousands(damageDeductionVnd)}₫</span>
              </div>
            )}
            <div className="h-px bg-slate-800 my-2" />
            <div className="flex justify-between items-center">
              <span className="font-bold text-white">{t("settlementRefund")}</span>
              <span className="text-lg font-black text-emerald-400">{refundEstimate}</span>
            </div>
          </div>
        </section>
      )}

      {/* 인라인 가이드 — T-9 (제출·환불 버튼 안내) */}
      <InlineGuide variant="dark" text={t("guide.submit")} />

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{error}</p>
      )}

      {/* 하단 고정 액션 바 (b4 Sticky Bottom Bar) */}
      <div className="fixed bottom-0 left-0 lg:left-64 right-0 bg-admin-card border-t border-slate-800 px-4 md:px-8 py-4 z-40 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex flex-col whitespace-nowrap">
            {depositLabel && (
              <span className="text-xs text-slate-400 whitespace-nowrap">
                {t("deposit")}: {depositLabel}
              </span>
            )}
            {refundEstimate && (
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-slate-200 font-bold whitespace-nowrap">{t("refundEstimate")}:</span>
                <span className="text-2xl font-black text-amber-500 whitespace-nowrap tabular-nums">{refundEstimate}</span>
              </div>
            )}
          </div>
          <div className="flex gap-4">
            <button
              type="button"
              // 차감(미니바·파손)이 1원이라도 있으면 전액 환불 불가 — 차감 후 환불 경로로 유도
              disabled={!canRefundFull || minibarTotal > 0n}
              onClick={submit}
              className="flex items-center gap-2 px-8 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold border border-emerald-500 shadow-lg shadow-emerald-900/20 transition-all active:scale-95 whitespace-nowrap"
            >
              <span className="material-symbols-outlined">payments</span>
              {t("refundFull")}
            </button>
            <button
              type="button"
              disabled={!(canDeduct || canDeductMinibarOnly)}
              onClick={submit}
              className="flex items-center gap-2 px-10 py-4 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-lg transition-all active:scale-95 shadow-lg shadow-orange-900/20 whitespace-nowrap"
            >
              <span className="material-symbols-outlined">check_circle</span>
              {t("refundDeduct")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
