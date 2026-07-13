"use client";

// 체크아웃 검수 폼 (b4 변환, T3.3) — 파손 리포트(최상단) → 미니바 확인 → 부가서비스 청구 확인 →
// 가감산 요약(보증금−파손−청구) → 수납 라인(보증금 상계 DEPOSIT 포함) → 하단 액션 바.
// 재설계(2026-07-13, T-checkout-deposit-offset):
//   - 보증금이 있으면 청구를 보증금에서 상계(DEPOSIT 수납 라인)하고 잔액만 환불 — 전액수납+별도환불 프로세스 폐기.
//   - 미니바 이중 계상 제거: 미니바는 게스트 청구로만 1회 계상(보증금 차감 deductionVnd에 합산하지 않음).
//   - damageFound = 실제 파손일 때만 true, deductionVnd = 파손 차감만.
// 사진 비교 섹션은 정책 변경(2026-07-10)으로 제거 — 파손 시에만 증빙 사진 입력.
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { resizeImage } from "@/lib/image-resize";
import { formatThousands } from "@/lib/format";
import { computeGuestBill, type GuestSettlementMethodValue } from "@/lib/checkout-settlement";
import { formatConverted } from "@/lib/fx-rates";
import { InlineGuide } from "@/components/inline-guide";

/** 오늘 환율 스냅샷(HCM 기준) — 미니바·청구서·수납 환산 "≈" 표시용. null이면 환산줄 생략. */
export interface FxSnapshot {
  date: string;
  vndPerKrw: number;
  vndPerUsd: number;
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

/** 수납 수단 — 기본 3종 + 보증금 상계(DEPOSIT, VND 전용). DEPOSIT은 보증금 HELD·VND일 때만 사용. */
type CheckoutSettleMethod = GuestSettlementMethodValue | "DEPOSIT";
const BASE_METHODS: GuestSettlementMethodValue[] = ["CASH", "BANK_TRANSFER", "OTHER"];

/** 수납 통화(원본 통화 그대로 저장, 환산 저장 금지 — ADR-0003) */
type SettleCurrency = "VND" | "KRW" | "USD";
const SETTLE_CURRENCIES: SettleCurrency[] = ["VND", "KRW", "USD"];

/** 자동 제안 보증금 상계 라인의 고정 id — dirty 판정·재계산 대상 식별용. */
const DEPOSIT_AUTO_ID = "depositAuto";

/** 수납 라인 입력값 — 수단×통화×금액(원본 통화 정수 디지털 문자열). id는 React key·행 조작용. */
interface SettlementLineInput {
  id: string;
  method: CheckoutSettleMethod;
  currency: SettleCurrency;
  /** 원본 통화 정수 디지털("500000"). 천단위 표시는 렌더 시 formatThousands. */
  amount: string;
}

export default function CheckoutForm({
  bookingId,
  minibar,
  depositLabel,
  depositVnd,
  depositStatus,
  confirmedOrders,
  fx,
}: {
  bookingId: string;
  minibar: MinibarItem[];
  depositLabel: string | null;
  /** 보증금이 VND일 때만 — 환불·상계 계산용 (동 단위 숫자 문자열) */
  depositVnd: string | null;
  /** 보증금 상태 — HELD(수취)일 때만 보증금 상계(DEPOSIT) 제안·허용. */
  depositStatus: "NONE" | "HELD" | "REFUNDED" | "PARTIAL_DEDUCTED";
  /** 확정 부가옵션(CONFIRMED|DELIVERED) — 게스트 청구서 합산용. 판매가만. */
  confirmedOrders: ConfirmedServiceOrder[];
  /** 오늘 환율 스냅샷 — 환산 "≈" 표시용. null이면 환산줄 생략(VND만). */
  fx: FxSnapshot | null;
}) {
  const t = useTranslations("adminCheckout");
  const router = useRouter();

  const [uploading, setUploading] = useState<string | null>(null);
  const [damageFound, setDamageFound] = useState(false);
  const [damageNote, setDamageNote] = useState("");
  const [damagePhotos, setDamagePhotos] = useState<string[]>([]);
  const [deduction, setDeduction] = useState(""); // 파손 차감 (동 단위 숫자 문자열)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 게스트 통합정산 수납 (ADR-0019 S4) — 메모(선택).
  const [settlementNote, setSettlementNote] = useState("");
  // 수납 라인(혼합 수납, 2026-07-13) — 각 행 = 수단×통화×금액. 기본 1행(현금·₫·빈 금액). 최대 12행.
  //   실수납이 "현금 ₫ + 계좌이체 ₩"처럼 섞여도 라인으로 각각 기록. 저장은 원본 통화 그대로(ADR-0003).
  //   보증금 상계는 method=DEPOSIT(VND) 라인으로 표현 — 보증금에서 청구를 차감(잔액만 환불).
  const settleIdSeq = useRef(1);
  const [settleLines, setSettleLines] = useState<SettlementLineInput[]>([
    { id: "sl0", method: "CASH", currency: "VND", amount: "" },
  ]);
  // 운영자가 자동 제안된 보증금 상계 라인을 직접 수정·삭제하면 이후 자동 재계산 중단(dirty).
  const depositDirtyRef = useRef(false);
  const addSettleLine = () =>
    setSettleLines((ls) =>
      ls.length >= 12
        ? ls
        : [...ls, { id: `sl${settleIdSeq.current++}`, method: "CASH", currency: "VND", amount: "" }]
    );
  const removeSettleLine = (id: string) => {
    if (id === DEPOSIT_AUTO_ID) depositDirtyRef.current = true; // 자동 상계 라인 삭제 = 수동 개입
    setSettleLines((ls) => (ls.length <= 1 ? ls : ls.filter((l) => l.id !== id)));
  };
  const updateSettleLine = (id: string, patch: Partial<SettlementLineInput>) => {
    if (id === DEPOSIT_AUTO_ID) depositDirtyRef.current = true; // 자동 상계 라인 수정 = 수동 개입
    setSettleLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
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

  /** 미니바 청구 합계(BigInt) — 게스트 청구로만 계상(보증금 차감 아님). */
  const minibarTotal = minibarRows.reduce((sum, r) => sum + r.lineDeduction, 0n);

  // ── 게스트 청구서 합산 (ADR-0019 S4) ───────────────────────────
  //   미니바 소비(실시간 미리보기, 단가는 서버 스냅샷이 정본) + 확정 부가옵션(판매가만).
  //   통화별 분리(ADR-0003): VND/KRW 합산 금지. 보증금 상계는 아래 수납 라인(DEPOSIT).
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

  const onDamagePhoto = async (file: File | null) => {
    if (!file) return;
    setUploading("damage");
    const url = await upload(file);
    if (url) setDamagePhotos((p) => [...p, url]);
    else setError(t("uploadError"));
    setUploading(null);
  };

  const deductionDigits = deduction.replace(/[^\d]/g, "");
  const damageDeductionVnd =
    damageFound && /^\d+$/.test(deductionDigits) ? BigInt(deductionDigits) : 0n;
  const deductionValid = /^\d+$/.test(deductionDigits) && BigInt(deductionDigits) > 0n;
  // 실제 파손 = 토글 ON + 유효 차감액. 보증금에서 빠지는 파손 차감의 유일한 근거.
  const hasRealDamage = damageFound && damageDeductionVnd > 0n;

  // ── 수납 라인 파싱(혼합 수납) — 통화별 합계 집계(BigInt, float 금지). amount>0 라인만 유효. ─────
  const parsedSettleLines = settleLines.map((l) => {
    const digits = l.amount.replace(/[^\d]/g, "");
    const amount = digits ? BigInt(digits) : 0n;
    return { ...l, digits, amount, valid: amount > 0n };
  });
  const validSettleLines = parsedSettleLines.filter((l) => l.valid);
  // 통화별 합계 — 표시(환산·잔여)·저장 비정규화의 소스. VND=BigInt 유지. DEPOSIT 라인도 VND 수납에 포함.
  const settledVndBig = validSettleLines
    .filter((l) => l.currency === "VND")
    .reduce((s, l) => s + l.amount, 0n);
  const settledKrwNum = validSettleLines
    .filter((l) => l.currency === "KRW")
    .reduce((s, l) => s + Number(l.amount), 0);
  const settledUsdNum = validSettleLines
    .filter((l) => l.currency === "USD")
    .reduce((s, l) => s + Number(l.amount), 0);
  const hasSettledAmount = settledVndBig > 0n || settledKrwNum > 0 || settledUsdNum > 0;

  // 보증금 상계액(ΣDEPOSIT 라인, VND) — 보증금에서 청구를 차감한 총액. 환불 예정액 계산 소스.
  const depositOffsetVnd = validSettleLines
    .filter((l) => l.method === "DEPOSIT" && l.currency === "VND")
    .reduce((s, l) => s + l.amount, 0n);
  const hasDepositLine = depositOffsetVnd > 0n;

  // ── 근사 환산(≈) — 표시 전용. 저장 금액 아님(저장은 원본 통화 그대로, ADR-0003). fx null이면 생략.
  //   통합 환산 총액 = VND 청구 + KRW 청구를 오늘 환율로 VND 환산(합산은 표시용 근사).
  const totalVndEquiv = fx
    ? guestBill.totalVnd + BigInt(Math.round(guestBill.totalKrw * fx.vndPerKrw))
    : guestBill.totalVnd;
  // 수납 환산 합계 = 통화별 실수납액을 VND로 환산해 합산(근사).
  const settledEquivVnd = fx
    ? settledVndBig +
      BigInt(Math.round(settledKrwNum * fx.vndPerKrw)) +
      BigInt(Math.round(settledUsdNum * fx.vndPerUsd))
    : settledVndBig;
  // 청구액이 존재하는가(잔여 자동 가감산 표시 여부). fx 있으면 통합 환산 총액, 없으면 통화별 총액 기준.
  const billHasBill = fx ? totalVndEquiv > 0n : guestBill.totalVnd > 0n || guestBill.totalKrw > 0;
  // 잔여(음수면 초과) — 소프트 안내만(하드 블록 없음).
  const remainingVnd = totalVndEquiv - settledEquivVnd;
  const absRemainingVnd = remainingVnd < 0n ? -remainingVnd : remainingVnd;
  // 잔여·채움 절삭 규칙(테오 지시): ₫=1만 단위 내림, ₩=1,000원 단위 내림, $=정수 내림.
  //   절삭으로 남는 1만₫ 미만 끝전은 의도적 면제 → |잔여| < 1만₫이면 수납 완료로 간주(초과 동일).
  const SETTLE_TOLERANCE_VND = 10_000n;
  const truncVnd = (v: bigint) => (v / 10_000n) * 10_000n;
  // 단 fx 없으면 KRW 청구가 통합 잔여에 반영되지 않으므로(VND만 집계),
  //   미수납 KRW가 남은 상태에서 "수납 완료"를 거짓 표기하지 않도록 가드(fx 없을 땐 KRW=0일 때만 완료 인정).
  const isSettled =
    billHasBill && absRemainingVnd < SETTLE_TOLERANCE_VND && (fx != null || guestBill.totalKrw === 0);
  const isExcess = !isSettled && remainingVnd < 0n; // 초과 수납(끝전 허용치 초과분만)

  // 잔여를 "그 통화 하나로 받을 때" 금액(표시용, fx 있을 때만) — 절삭 규칙 적용.
  const remainingVndDisplay = truncVnd(absRemainingVnd);
  const remainingKrw = fx ? Math.floor(Number(absRemainingVnd) / fx.vndPerKrw / 1000) * 1000 : 0;
  const remainingUsd = fx ? Math.floor(Number(absRemainingVnd) / fx.vndPerUsd) : 0;

  // ── 보증금 상계 자동 제안 ─────────────────────────────────────────
  //   보증금이 HELD·VND일 때만: 청구를 보증금에서 상계하는 DEPOSIT 라인을 프리필.
  //   제안액 = min(보증금 − 파손차감, 총청구 환산 VND) 을 1만₫ 단위로 내림(끝전 면제, 서버 초과 400 예방).
  const depositBig = depositVnd ? BigInt(depositVnd) : 0n;
  const depositHeldVnd = depositStatus === "HELD" && depositVnd != null && depositBig > 0n;
  const depositAvailForOffset = depositBig > damageDeductionVnd ? depositBig - damageDeductionVnd : 0n;
  const suggestedDepositOffset = (() => {
    if (!depositHeldVnd) return 0n;
    const cap = totalVndEquiv < depositAvailForOffset ? totalVndEquiv : depositAvailForOffset;
    return truncVnd(cap);
  })();

  // 자동 상계 라인 동기화 — dirty(수동 개입) 전까지 파손·미니바·부가옵션 변경에 맞춰 재계산.
  useEffect(() => {
    if (!depositHeldVnd || depositDirtyRef.current) return;
    setSettleLines((ls) => {
      const existing = ls.find((l) => l.id === DEPOSIT_AUTO_ID);
      if (suggestedDepositOffset <= 0n) {
        return existing ? ls.filter((l) => l.id !== DEPOSIT_AUTO_ID) : ls;
      }
      const amountStr = suggestedDepositOffset.toString();
      if (existing) {
        if (existing.amount === amountStr && existing.method === "DEPOSIT" && existing.currency === "VND") {
          return ls; // 변화 없음 — 재렌더 방지
        }
        return ls.map((l) =>
          l.id === DEPOSIT_AUTO_ID
            ? { ...l, method: "DEPOSIT", currency: "VND", amount: amountStr }
            : l
        );
      }
      // 상단에 삽입(가장 먼저 보이도록)
      return [
        { id: DEPOSIT_AUTO_ID, method: "DEPOSIT", currency: "VND", amount: amountStr },
        ...ls,
      ];
    });
  }, [depositHeldVnd, suggestedDepositOffset]);

  // ── 환불 예정액 — 보증금 VND일 때만. 보증금 − 파손차감 − 보증금상계(0 미만 방지). ─────
  const refundEstimateVnd = (() => {
    if (!depositVnd) return null;
    const deducted = damageDeductionVnd + depositOffsetVnd;
    return depositBig > deducted ? depositBig - deducted : 0n;
  })();
  const refundEstimate = refundEstimateVnd != null ? `${formatThousands(refundEstimateVnd)}₫` : null;

  // ── 가감산 요약(최종 결제 판단) — 보증금 − 파손 − 총청구(환산) = 순액. ─────
  //   양수 → 환불 예정액, 음수 → 추가로 받을 금액. 보증금 없으면 총청구 = 받을 금액.
  const netSettlementVnd = depositVnd ? depositBig - damageDeductionVnd - totalVndEquiv : -totalVndEquiv;
  const netAbsVnd = netSettlementVnd < 0n ? -netSettlementVnd : netSettlementVnd;

  const canRefundFull = !damageFound && !hasDepositLine && !busy;
  const canDeduct =
    // 파손 토글 ON이면 상세(금액+메모/사진) 완비 필수, 그 후 파손 차감 또는 보증금 상계가 있으면 활성.
    (!damageFound || (deductionValid && (damageNote.trim().length > 0 || damagePhotos.length > 0))) &&
    (hasRealDamage || hasDepositLine) &&
    !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
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
          // damageFound = 실제 파손일 때만 true. 미니바는 게스트 청구(정산)로만 계상(이중 계상 제거).
          damageFound: hasRealDamage,
          damageNote: hasRealDamage && damageNote.trim() ? damageNote.trim() : undefined,
          damagePhotoUrls: hasRealDamage && damagePhotos.length ? damagePhotos : undefined,
          // deductionVnd = 파손 차감만(미니바 미포함).
          deductionVnd: hasRealDamage ? damageDeductionVnd.toString() : undefined,
          // 미니바 품목별 판매 캡처(매출·마진 통계 소스). 0건이면 빈 배열(라인 미생성).
          minibarLines: minibarLines.length ? minibarLines : undefined,
          // 게스트 통합정산 수납(혼합 수납, ADR-0019 S4) — 유효 라인(amount>0)이 1개 이상일 때만 전송.
          //   lines: 수단×통화×금액(원본 통화 정수 문자열). method=MIXED 전송 금지(서버 파생).
          //   DEPOSIT(보증금 상계) 라인 포함 가능 — 서버가 VND·보증금 잔여·HELD 여부를 검증.
          settlement:
            validSettleLines.length > 0
              ? {
                  note: settlementNote.trim() || undefined,
                  lines: validSettleLines.map((l) => ({
                    method: l.method,
                    currency: l.currency,
                    amount: l.digits,
                  })),
                }
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
      {/* ① 파손 및 손실 리포트 (최상단, b4 Damage Section) */}
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

      {/* ② 미니바 확인 (b16) — 소모=비치−남은, 차감액=소모×단가 실시간 */}
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

            {/* 합계 스트라이프 — VND 합계 + 오늘 환율 근사 환산(≈₩·≈$, fx 있을 때만) */}
            <div className="bg-amber-500/5 border-t border-slate-800 px-6 py-4 flex justify-between items-center">
              <span className="text-xs font-bold text-amber-500 uppercase tracking-widest">{t("minibarTotal")}</span>
              <span className="text-right">
                <span className="block text-xl font-black text-amber-500 tabular-nums tracking-tight">
                  {formatThousands(minibarTotal)}₫
                </span>
                {fx && minibarTotal > 0n && (
                  <span className="block text-[11px] text-slate-500 tabular-nums">
                    {formatConverted(minibarTotal, "KRW", fx.vndPerKrw)} ·{" "}
                    {formatConverted(minibarTotal, "USD", fx.vndPerUsd)}
                  </span>
                )}
              </span>
            </div>
          </>
        )}
        <div className="px-6 py-4 flex items-center gap-2 text-xs text-slate-500 bg-slate-800/30">
          <span className="material-symbols-outlined text-sm">info</span>
          <p>{t("minibarInfo")}</p>
        </div>
      </section>

      {/* ③ 부가서비스(게스트 청구) 확인 (ADR-0019 S4, b20) — 미니바 + 확정 부가옵션, 통화별 분리 */}
      {/* ③+④ 나란히 배치(lg 2열) — 카드 내용이 좌측 절반만 쓰던 여백 낭비 제거(테오 피드백 2026-07-13) */}
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
      <section className="bg-admin-card border border-slate-800 rounded-xl p-6 shadow-sm space-y-5">
        <h3 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap text-white">
          <span className="material-symbols-outlined text-emerald-400">receipt_long</span>
          {t("guestBillTitle")}
        </h3>

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
                  <li key={o.id} className="flex justify-between items-start gap-3 text-sm">
                    <span className="text-slate-300">
                      {o.name}
                      {o.quantity > 1 && <span className="text-slate-500"> ×{o.quantity}</span>}
                    </span>
                    <span className="text-right tabular-nums shrink-0">
                      {o.priceKrw != null && (
                        <span className="block text-slate-200 font-semibold">
                          {formatThousands(o.priceKrw)}원
                        </span>
                      )}
                      {o.priceVnd != null && (
                        <span className="block text-slate-400">{formatThousands(o.priceVnd)}₫</span>
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

          {/* 총 청구액 — 대표 총액 = 통합 환산(손님에게 받을 최종액). 통화별은 소계로 격하.
              환산(≈)은 표시용 근사(저장 금액 아님, ADR-0003 — 실제 수납·저장은 원본 통화). */}
          <div className="border-t border-slate-800 pt-3 space-y-2">
            {fx ? (
              <>
                {/* 통화별 청구 소계 — 작은 글씨(slate). ₩ 소계는 0원이어도 표시 유지. */}
                <div className="flex justify-between items-center text-[13px]">
                  <span className="text-slate-400">{t("guestBillSubtotalVnd")}</span>
                  <span className="font-semibold text-slate-300 tabular-nums">
                    {formatThousands(guestBill.totalVnd)}₫
                  </span>
                </div>
                <div className="flex justify-between items-center text-[13px]">
                  <span className="text-slate-400">{t("guestBillSubtotalKrw")}</span>
                  <span className="font-semibold text-slate-300 tabular-nums">
                    {formatThousands(guestBill.totalKrw)}원
                  </span>
                </div>
                {/* 대표 총액(강조) — 통합 환산 총액. 미니바 수량 변경 시 실시간 반영. */}
                <div className="flex justify-between items-center border-t border-slate-800/60 pt-3">
                  <span className="font-bold text-white">{t("guestBillGrandTotal")}</span>
                  <span className="text-right">
                    <span className="block text-xl font-black text-emerald-400 tabular-nums">
                      ≈ {formatThousands(totalVndEquiv)}₫
                    </span>
                    {(guestBill.totalVnd > 0n || guestBill.totalKrw > 0) && (
                      <span className="block text-[11px] text-slate-500 tabular-nums">
                        {formatConverted(totalVndEquiv, "KRW", fx.vndPerKrw)} ·{" "}
                        {formatConverted(totalVndEquiv, "USD", fx.vndPerUsd)}
                      </span>
                    )}
                  </span>
                </div>
              </>
            ) : (
              <>
                {/* 폴백 — 환율 캐시 없음: 통합 환산 불가 → 통화별 총액 두 줄을 대표로(합산 금지). */}
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
              </>
            )}
            <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
              {t("guestBillCurrencyNote")}
            </p>
            {fx && (
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {t("fxAsOf", { date: fx.date })}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ④ 가감산 요약 — 보증금 − 파손 − 총청구(환산) = 최종 (환불 예정 / 추가 청구) */}
      <section className="bg-admin-card border border-slate-800 rounded-xl p-6 shadow-sm">
        <h3 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap text-white mb-5">
          <span className="material-symbols-outlined text-admin-primary">calculate</span>
          {t("offsetSummaryTitle")}
        </h3>
        <div className="space-y-3 tabular-nums">
          {depositVnd ? (
            <>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">{t("offsetDeposit")}</span>
                <span className="font-bold text-slate-200">{formatThousands(depositVnd)}₫</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">{t("offsetDamage")} (−)</span>
                <span className={`font-bold ${damageDeductionVnd > 0n ? "text-red-400" : "text-slate-600"}`}>
                  {formatThousands(damageDeductionVnd)}₫
                </span>
              </div>
              <div className="flex justify-between items-start text-sm">
                <span className="text-slate-400">{t("offsetCharge")} (−)</span>
                <span className="text-right">
                  <span className={`block font-bold ${totalVndEquiv > 0n ? "text-red-400" : "text-slate-600"}`}>
                    {fx ? "≈ " : ""}
                    {formatThousands(totalVndEquiv)}₫
                  </span>
                </span>
              </div>
              <div className="h-px bg-slate-800 my-2" />
              <div className="flex justify-between items-center">
                {netSettlementVnd > 0n ? (
                  <>
                    <span className="font-bold text-white">{t("offsetRefundLabel")}</span>
                    <span className="text-2xl font-black text-emerald-400">
                      {fx ? "≈ " : ""}
                      {formatThousands(netAbsVnd)}₫
                    </span>
                  </>
                ) : netSettlementVnd < 0n ? (
                  <>
                    <span className="font-bold text-white">{t("offsetCollectLabel")}</span>
                    <span className="text-2xl font-black text-amber-500">
                      ≈ {formatThousands(netAbsVnd)}₫
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-bold text-white">{t("offsetSettledLabel")}</span>
                    <span className="text-2xl font-black text-slate-300">0₫</span>
                  </>
                )}
              </div>
            </>
          ) : (
            // 보증금 없음 — 총 청구 = 받을 금액으로 단순 표시.
            <div className="flex justify-between items-center">
              <span className="font-bold text-white">{t("offsetChargeOnlyLabel")}</span>
              <span className="text-2xl font-black text-amber-500">
                {fx ? "≈ " : ""}
                {formatThousands(totalVndEquiv)}₫
              </span>
            </div>
          )}
          {fx && (
            <p className="text-[11px] text-slate-600 leading-relaxed pt-1">
              {t("fxAsOf", { date: fx.date })}
            </p>
          )}
        </div>
      </section>
      </div>

      {/* ⑤ 수납 라인(혼합 수납 + 보증금 상계) + 정산 메모 */}
      <section className="bg-admin-card border border-slate-800 rounded-xl p-6 shadow-sm space-y-5">
        <h3 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap text-white">
          <span className="material-symbols-outlined text-emerald-400">payments</span>
          {t("settledAmountsTitle")}
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 좌: 수납 라인 */}
          <div className="bg-admin-bg border border-slate-800 rounded-lg p-5 space-y-4 self-start">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-slate-400 tracking-wider">{t("settledAmountsTitle")}</p>
                <span className="text-[11px] text-slate-500 tabular-nums">{settleLines.length}/12</span>
              </div>

              <div className="space-y-2">
                {parsedSettleLines.map((l) => {
                  const isDeposit = l.method === "DEPOSIT";
                  const methodOptions: CheckoutSettleMethod[] =
                    depositHeldVnd || isDeposit ? [...BASE_METHODS, "DEPOSIT"] : BASE_METHODS;
                  return (
                    <div key={l.id} className="flex items-center gap-2">
                      <select
                        aria-label={t("settlementMethod")}
                        value={l.method}
                        onChange={(e) => {
                          const m = e.target.value as CheckoutSettleMethod;
                          // DEPOSIT 선택 시 통화 VND 고정.
                          updateSettleLine(l.id, m === "DEPOSIT" ? { method: m, currency: "VND" } : { method: m });
                        }}
                        className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-2.5 text-sm text-white focus:ring-admin-primary focus:border-admin-primary outline-none"
                      >
                        {methodOptions.map((m) => (
                          <option key={m} value={m}>
                            {t(`settlementMethods.${m}`)}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={t("settlementCurrency")}
                        value={isDeposit ? "VND" : l.currency}
                        disabled={isDeposit}
                        onChange={(e) => updateSettleLine(l.id, { currency: e.target.value as SettleCurrency })}
                        className="w-[76px] shrink-0 bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-2 text-sm text-white focus:ring-admin-primary focus:border-admin-primary outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {SETTLE_CURRENCIES.map((c) => (
                          <option key={c} value={c}>
                            {c === "VND" ? "₫ VND" : c === "KRW" ? "₩ KRW" : "$ USD"}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={t("settlementAmount")}
                        value={l.digits ? formatThousands(l.digits) : ""}
                        onChange={(e) => updateSettleLine(l.id, { amount: e.target.value.replace(/[^\d]/g, "") })}
                        className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg py-2.5 px-3 text-sm text-white text-right tabular-nums focus:ring-admin-primary focus:border-admin-primary outline-none"
                        placeholder="0"
                      />
                      <button
                        type="button"
                        aria-label={t("settlementLineRemove")}
                        onClick={() => removeSettleLine(l.id)}
                        disabled={settleLines.length <= 1}
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30 disabled:hover:text-slate-500 disabled:hover:bg-transparent transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={addSettleLine}
                disabled={settleLines.length >= 12}
                className="flex items-center gap-1.5 text-xs font-bold text-admin-primary hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                {t("settlementLineAdd")}
              </button>

              <p className="text-[11px] text-slate-500 leading-relaxed">{t("settlementOptionalNote")}</p>
              {depositHeldVnd && (
                <p className="text-[11px] text-admin-primary leading-relaxed">{t("depositOffsetHint")}</p>
              )}

              {/* 수납 잔여 자동 가감산 — 통화별 실시간 환산(≈). 소프트 안내(제출 차단 없음). */}
              {billHasBill && (
                <div className="rounded-lg bg-slate-900/60 border border-slate-800 px-3 py-2.5 space-y-2">
                  {hasSettledAmount && fx && (
                    <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
                      <span>{t("settledEquiv")}</span>
                      <span>≈ {formatThousands(settledEquivVnd)}₫</span>
                    </div>
                  )}
                  {isSettled ? (
                    <p className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px]">check_circle</span>
                      {t("settledComplete")}
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className={`text-xs font-bold ${isExcess ? "text-amber-400" : "text-slate-300"}`}>
                        {isExcess ? t("settledExcess") : t("settledRemaining")}
                      </span>
                      <span
                        className={`text-sm font-black tabular-nums ${isExcess ? "text-amber-400" : "text-emerald-400"}`}
                      >
                        {fx ? (
                          <>
                            ≈ {formatThousands(remainingVndDisplay)}₫ · ≈ ₩{formatThousands(remainingKrw)} · ≈ $
                            {formatThousands(remainingUsd)}
                          </>
                        ) : (
                          <>≈ {formatThousands(remainingVndDisplay)}₫</>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 tracking-wider" htmlFor="settlementNote">
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

          {/* 우: 보증금 정산 상세 — 원천 보증금 − 파손 차감 − 보증금 상계 = 환불 예정액 */}
          {depositVnd && (
            <div className="bg-admin-bg border border-slate-800 rounded-lg p-5 self-start">
              <h5 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">
                {t("settlementTitle")}
              </h5>
              <div className="space-y-3 tabular-nums">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">{t("settlementDeposit")}</span>
                  <span className="font-bold text-slate-200">{formatThousands(depositVnd)}₫</span>
                </div>
                {damageDeductionVnd > 0n && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">{t("settlementDamage")} (−)</span>
                    <span className="font-bold text-red-400">{formatThousands(damageDeductionVnd)}₫</span>
                  </div>
                )}
                {depositOffsetVnd > 0n && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">{t("settlementOffset")} (−)</span>
                    <span className="font-bold text-red-400">{formatThousands(depositOffsetVnd)}₫</span>
                  </div>
                )}
                <div className="h-px bg-slate-800 my-2" />
                <div className="flex justify-between items-center">
                  <span className="font-bold text-white">{t("settlementRefund")}</span>
                  <span className="text-lg font-black text-emerald-400">{refundEstimate}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 인라인 가이드 — T-9 (제출·환불 버튼 안내) */}
      <InlineGuide variant="dark" text={t("guide.submit")} />

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{error}</p>
      )}

      {/* ⑥ 하단 고정 액션 바 (b4 Sticky Bottom Bar) */}
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
              // 보증금에서 차감(파손·상계)이 있으면 전액 환불 불가 — 차감 후 환불 경로로 유도
              disabled={!canRefundFull}
              onClick={submit}
              className="flex items-center gap-2 px-8 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold border border-emerald-500 shadow-lg shadow-emerald-900/20 transition-all active:scale-95 whitespace-nowrap"
            >
              <span className="material-symbols-outlined">payments</span>
              {t("refundFull")}
            </button>
            <button
              type="button"
              disabled={!canDeduct}
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
