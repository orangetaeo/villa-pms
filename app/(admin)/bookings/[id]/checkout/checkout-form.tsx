"use client";

// 체크아웃 검수 폼 (b4 변환, T3.3) — 공간별 비교 업로드 + 미니바 읽기 전용 +
// 파손 리포트 + 하단 고정 액션 바 (전액 환불 / 차감 후 환불 승인)
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { resizeImage } from "@/lib/image-resize";
import { formatThousands } from "@/lib/format";

interface Section {
  id: string;
  label: string;
  baselineUrl: string | null;
}
interface MinibarItem {
  id: string;
  label: string;
  isCustom: boolean;
  itemKey: string;
  quantity: number;
  /** 미니바 고객 청구 단가(VND, 동 단위 문자열) — null이면 단가 미설정(차감 0) */
  unitPriceVnd: string | null;
}

export default function CheckoutForm({
  bookingId,
  sections,
  minibar,
  depositLabel,
  depositVnd,
}: {
  bookingId: string;
  sections: Section[];
  minibar: MinibarItem[];
  depositLabel: string | null;
  /** 보증금이 VND일 때만 — 환불 예정액 계산용 (동 단위 숫자 문자열) */
  depositVnd: string | null;
}) {
  const t = useTranslations("adminCheckout");
  const ta = useTranslations("amenities.items");
  const router = useRouter();

  const [photos, setPhotos] = useState<Record<string, string>>({}); // sectionId → url
  const [uploading, setUploading] = useState<string | null>(null);
  const [damageFound, setDamageFound] = useState(false);
  const [damageNote, setDamageNote] = useState("");
  const [damagePhotos, setDamagePhotos] = useState<string[]>([]);
  const [deduction, setDeduction] = useState(""); // 파손 등 기타 차감 (동 단위 숫자 문자열)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 미니바 차감 자동계산 (b16) ─────────────────────────────────
  // remaining[id] = 남은 수량(스테퍼). 초기값 = 비치 수량(전부 남음 = 소모 0).
  const [remaining, setRemaining] = useState<Record<string, number>>(() =>
    Object.fromEntries(minibar.map((m) => [m.id, m.quantity]))
  );

  /** 남은 수량 변경 (0 ~ 비치 수량 범위로 클램프) — 스테퍼·직접입력 공통 */
  const setRemainingClamped = (item: MinibarItem, next: number) => {
    const clamped = Math.max(0, Math.min(item.quantity, Math.trunc(next || 0)));
    setRemaining((r) => ({ ...r, [item.id]: clamped }));
  };

  /** 행별 자동계산 결과 — 소모 = 비치 − 남은, 차감액 = 소모 × 단가(BigInt, float 금지) */
  const minibarRows = minibar.map((m) => {
    const left = remaining[m.id] ?? m.quantity;
    const consumed = Math.max(0, m.quantity - left);
    const unit = m.unitPriceVnd ? BigInt(m.unitPriceVnd) : 0n;
    const lineDeduction = unit * BigInt(consumed);
    return { item: m, left, consumed, unit, lineDeduction };
  });

  /** 미니바 차감 합계(BigInt) */
  const minibarTotal = minibarRows.reduce((sum, r) => sum + r.lineDeduction, 0n);

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
    !damageFound && photoUrls.length >= 1 && depositVnd != null && minibarTotal > 0n && !busy;

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
      .map((r) => {
        const name = r.item.isCustom ? r.item.label : ta(r.item.itemKey);
        return `${name} x${r.consumed} = ${formatThousands(r.lineDeduction)}₫`;
      });
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
                      <div className="aspect-video rounded-lg overflow-hidden relative">
                        <Image src={section.baselineUrl} alt={section.label} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
                      </div>
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
                      <div className="aspect-video rounded-lg overflow-hidden relative">
                        <Image src={uploaded} alt={`${section.label} — ${t("checkoutPhoto")}`} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
                      </div>
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

        {minibar.length === 0 ? (
          <p className="text-sm text-slate-500 p-6">{t("minibarEmpty")}</p>
        ) : (
          <>
            {/* 데스크톱(≥768px): 표 */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse tabular-nums">
                <thead>
                  <tr className="text-[11px] font-bold text-slate-500 uppercase tracking-wider bg-slate-900/50">
                    <th className="px-6 py-3 border-b border-slate-800">{t("item")}</th>
                    <th className="px-6 py-3 border-b border-slate-800 text-center">{t("stockedQty")}</th>
                    <th className="px-6 py-3 border-b border-slate-800 text-center">{t("remainingQty")}</th>
                    <th className="px-6 py-3 border-b border-slate-800 text-center">{t("consumedQty")}</th>
                    <th className="px-6 py-3 border-b border-slate-800 text-right">{t("unitPrice")}</th>
                    <th className="px-6 py-3 border-b border-slate-800 text-right">{t("lineDeduction")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {minibarRows.map(({ item, left, consumed, unit, lineDeduction }) => {
                    const dimmed = item.quantity === 0;
                    return (
                      <tr
                        key={item.id}
                        className={dimmed ? "opacity-40 bg-slate-900/20" : "hover:bg-slate-800/40 transition-colors"}
                      >
                        <td className="px-6 py-4 font-medium text-slate-200">
                          {item.isCustom ? item.label : ta(item.itemKey)}
                        </td>
                        <td className="px-6 py-4 text-center text-slate-400">{item.quantity}</td>
                        <td className="px-6 py-4 text-center">
                          <div className="inline-flex items-center bg-slate-900 rounded border border-slate-700 p-0.5">
                            <button
                              type="button"
                              aria-label={t("decrement")}
                              disabled={dimmed || left <= 0}
                              onClick={() => setRemainingClamped(item, left - 1)}
                              className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              aria-label={`${item.isCustom ? item.label : ta(item.itemKey)} ${t("remainingQty")}`}
                              min={0}
                              max={item.quantity}
                              value={left}
                              disabled={dimmed}
                              onChange={(e) => setRemainingClamped(item, parseInt(e.target.value, 10))}
                              className="w-10 bg-transparent border-none text-center text-xs font-bold text-white focus:ring-0 p-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              type="button"
                              aria-label={t("increment")}
                              disabled={dimmed || left >= item.quantity}
                              onClick={() => setRemainingClamped(item, left + 1)}
                              className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span
                            className={
                              consumed > 0
                                ? "px-3 py-1 bg-admin-primary/10 text-admin-primary font-bold rounded-md border border-admin-primary/20"
                                : "px-3 py-1 bg-slate-800 text-slate-600 font-bold rounded-md border border-slate-700"
                            }
                          >
                            {consumed}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-slate-400">
                          {item.unitPriceVnd ? formatThousands(item.unitPriceVnd) + "₫" : t("noPrice")}
                        </td>
                        <td className={`px-6 py-4 text-right font-bold ${lineDeduction > 0n ? "text-red-400" : "text-slate-600"}`}>
                          {formatThousands(lineDeduction)}₫
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 모바일(<768px): 카드 스택 */}
            <div className="md:hidden flex flex-col divide-y divide-slate-800/60">
              {minibarRows.map(({ item, left, consumed, lineDeduction }) => {
                const dimmed = item.quantity === 0;
                return (
                  <div key={item.id} className={`p-4 ${dimmed ? "opacity-40" : ""}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-bold text-slate-200">{item.isCustom ? item.label : ta(item.itemKey)}</span>
                      <span className={`font-bold tabular-nums ${lineDeduction > 0n ? "text-red-400" : "text-slate-600"}`}>
                        {formatThousands(lineDeduction)}₫
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-slate-500">
                        {t("stockedQty")} {item.quantity} · {t("consumedQty")}{" "}
                        <span className="text-admin-primary font-bold tabular-nums">{consumed}</span> ·{" "}
                        {item.unitPriceVnd ? formatThousands(item.unitPriceVnd) + "₫" : t("noPrice")}
                      </span>
                      <div className="inline-flex items-center bg-slate-900 rounded border border-slate-700 p-0.5 shrink-0">
                        <button
                          type="button"
                          aria-label={t("decrement")}
                          disabled={dimmed || left <= 0}
                          onClick={() => setRemainingClamped(item, left - 1)}
                          className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-30"
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-xs font-bold text-white tabular-nums">{left}</span>
                        <button
                          type="button"
                          aria-label={t("increment")}
                          disabled={dimmed || left >= item.quantity}
                          onClick={() => setRemainingClamped(item, left + 1)}
                          className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
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
                className="sr-only peer"
                checked={damageFound}
                onChange={(e) => setDamageFound(e.target.checked)}
              />
              <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-admin-primary" />
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
