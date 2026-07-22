"use client";

// 상대방(SUPPLIER/VENDOR/PARTNER) 계약 열람·서명 화면 (T-business-contract-esign) — 라이트 포털 공용.
//   /api/business-contracts/mine 로 자기 계약만 조회(내부 초안·타 계약 접근 경로 없음).
//   SENT=본문 열람+신원 입력+캔버스 서명+제출 / SIGNED=서명본+프린트 / 없음=empty.
//   ★ 서명 성공 후에는 서버 재조회(낙관 갱신 금지) — contentHash로 봉인된 본문을 다시 받아 표시.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import ContractDocument from "./contract-document";
import ContractSignPad, { type SignPadHandle } from "./contract-sign-pad";
import ContractPrintButton from "./print-button";
import NegotiationPanel, { type NegotiationItem } from "./negotiation-panel";
import type { CancelTier } from "@/lib/cancel-tiers";

interface MineContract {
  id: string;
  type: "VILLA_SUPPLY" | "SERVICE_VENDOR" | "PARTNER_AGENCY";
  status: "SENT" | "SIGNED";
  standardVersion: string;
  locale: string;
  body: string | null;
  bodyError: string | null;
  signName: string | null;
  signedAt: string | null;
  signatureUrl: string | null;
  sentAt: string | null;
  // 협의(S2) — hasOpenNegotiation이면 서명 폼 대신 "협의 진행 중" 안내(서버도 409로 막음).
  negotiations: NegotiationItem[];
  hasOpenNegotiation: boolean;
  cancelTiers: CancelTier[] | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export default function CounterpartContractView({
  defaultSignName = "",
}: {
  defaultSignName?: string;
}) {
  const t = useTranslations("businessContract");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [contracts, setContracts] = useState<MineContract[]>([]);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/business-contracts/mine", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data: { contracts: MineContract[] } = await res.json();
      setContracts(data.contracts ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="py-16 text-center text-sm text-neutral-500">{t("loading")}</p>;
  }
  if (error) {
    return <p className="py-16 text-center text-sm text-rose-600">{t("loadError")}</p>;
  }
  if (contracts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-100 bg-white p-10 text-center shadow-sm">
        <span className="material-symbols-outlined text-5xl text-teal-600">gavel</span>
        <p className="text-sm font-bold text-neutral-700">{t("empty.title")}</p>
        <p className="text-sm text-neutral-500">{t("empty.desc")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {contracts.map((c) => (
        <ContractCard key={c.id} contract={c} defaultSignName={defaultSignName} onChanged={load} />
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: "SENT" | "SIGNED" }) {
  const t = useTranslations("businessContract");
  const signed = status === "SIGNED";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold " +
        (signed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")
      }
    >
      <span className="material-symbols-outlined text-[14px]">
        {signed ? "verified" : "edit_note"}
      </span>
      {t(`status.${status}`)}
    </span>
  );
}

function ContractCard({
  contract,
  defaultSignName,
  onChanged,
}: {
  contract: MineContract;
  defaultSignName: string;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("businessContract");
  const signed = contract.status === "SIGNED";

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-neutral-900">{t("title")}</h1>
        <StatusBadge status={contract.status} />
      </header>

      {contract.bodyError || !contract.body ? (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-6 text-center text-sm text-amber-700">
          {t("unavailable")}
        </div>
      ) : signed ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-bold text-emerald-800">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
              {t("signed.banner")}
            </p>
            <ContractPrintButton label={t("print")} variant="light" />
          </div>
          {/* 인쇄 격리 — .print-sheet 안만 출력(globals.css) */}
          <div className="print-sheet">
            <ContractDocument
              body={contract.body}
              signed
              signatureUrl={contract.signatureUrl}
              signName={contract.signName}
              signedAt={fmtDate(contract.signedAt)}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="flex items-center gap-1.5 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-800">
            <span className="material-symbols-outlined text-[18px]">info</span>
            {t("read")}
          </p>
          <ContractDocument body={contract.body} signed={false} />
          <NegotiationPanel
            contractId={contract.id}
            type={contract.type}
            locale={contract.locale}
            currentTiers={contract.cancelTiers}
            negotiations={contract.negotiations ?? []}
            onChanged={onChanged}
          />
          {contract.hasOpenNegotiation ? (
            // 미해결 협의가 있는 동안은 서명 폼 자체를 감춘다(서버 sign도 409 — 이중 방어).
            <p className="flex items-center gap-1.5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              <span className="material-symbols-outlined text-[18px]">hourglass_top</span>
              {t("negotiation.blocked")}
            </p>
          ) : (
            <SignForm
              contractId={contract.id}
              isPartner={contract.type === "PARTNER_AGENCY"}
              defaultSignName={defaultSignName}
              onChanged={onChanged}
            />
          )}
        </div>
      )}
    </section>
  );
}

function SignForm({
  contractId,
  isPartner,
  defaultSignName,
  onChanged,
}: {
  contractId: string;
  isPartner: boolean;
  defaultSignName: string;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("businessContract");
  const padRef = useRef<SignPadHandle>(null);
  const [hasStroke, setHasStroke] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 빌라·부가서비스=신원/주소 필수, 파트너=선택(정본에 해당 토큰 없음 — BE sign 라우트와 대칭).
  const schema = z.object({
    signName: z.string().trim().min(1).max(120),
    idNumber: isPartner
      ? z.string().trim().max(60).optional()
      : z.string().trim().min(1).max(60),
    address: isPartner
      ? z.string().trim().max(200).optional()
      : z.string().trim().min(1).max(200),
  });
  type Values = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { signName: defaultSignName, idNumber: "", address: "" },
  });

  const onSubmit = async (values: Values) => {
    setMessage(null);
    const blob = await padRef.current?.toBlob();
    if (!blob) {
      setMessage(t("sign.signatureRequired"));
      return;
    }
    if (!window.confirm(t("sign.confirm"))) return;

    const form = new FormData();
    form.append("signName", values.signName.trim());
    if (values.idNumber) form.append("idNumber", values.idNumber.trim());
    if (values.address) form.append("address", values.address.trim());
    form.append("signature", new File([blob], "signature.png", { type: "image/png" }));

    try {
      const res = await fetch(`/api/business-contracts/${contractId}/sign`, {
        method: "POST",
        body: form,
      });
      if (res.status === 409) {
        setMessage(t("sign.alreadySigned"));
        await onChanged(); // 서버 재조회 — 이미 SIGNED면 서명본으로 전환
        return;
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      // 낙관 갱신 금지 — 서버 재조회로 봉인 본문 수신
      await onChanged();
    } catch {
      setMessage(t("sign.error"));
    }
  };

  const inputClass =
    "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100";

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm"
    >
      <div>
        <h2 className="text-base font-bold text-neutral-900">{t("sign.title")}</h2>
        <p className="mt-1 text-sm text-neutral-500">{t("sign.guide")}</p>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700">
          {t("sign.signName")}
        </span>
        <input type="text" {...register("signName")} className={inputClass} />
        {errors.signName && (
          <span className="mt-1 block text-xs text-rose-600">{t("sign.required")}</span>
        )}
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700">
          {isPartner ? t("sign.idNumberOptional") : t("sign.idNumber")}
        </span>
        <input type="text" {...register("idNumber")} className={inputClass} />
        {errors.idNumber && (
          <span className="mt-1 block text-xs text-rose-600">{t("sign.required")}</span>
        )}
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-neutral-700">
          {isPartner ? t("sign.addressOptional") : t("sign.address")}
        </span>
        <input type="text" {...register("address")} className={inputClass} />
        {errors.address && (
          <span className="mt-1 block text-xs text-rose-600">{t("sign.required")}</span>
        )}
      </label>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-neutral-700">
          {t("sign.signature")}
        </span>
        <ContractSignPad
          ref={padRef}
          clearLabel={t("sign.clear")}
          promptLabel={t("sign.signPrompt")}
          onStrokeChange={setHasStroke}
        />
      </div>

      {message && <p className="text-sm font-medium text-rose-600">{message}</p>}

      <button
        type="submit"
        disabled={isSubmitting || !hasStroke}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-bold text-white transition-all hover:bg-teal-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-[20px]">draw</span>
        {isSubmitting ? t("sign.submitting") : t("sign.submit")}
      </button>
    </form>
  );
}
