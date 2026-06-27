"use client";

// 체크인 폼 (b3 Section 1 여권 + Section 2 보증금 + Section 4 완료, T3.1)
// 여권 업로드 → 비공개 파이프라인(/api/uploads/passport) / OCR은 ADMIN 확인·수정 후에만 저장
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { resizeImage } from "@/lib/image-resize";
import AgreementSection from "./agreement-section";
import type { AgreementContent } from "@/lib/agreement";

interface PassportEntry {
  url: string; // /api/passports/<name>
  base64: string; // OCR 재요청용 (메모리만 — 저장 안 함)
  mimeType: string;
  ocrState: "idle" | "running" | "done" | "failed" | "not_configured";
  data: PassportFields;
}

interface PassportFields {
  surname: string;
  givenNames: string;
  passportNo: string;
  nationality: string;
  birthDate: string;
  expiryDate: string;
  sex: string;
}

const EMPTY_FIELDS: PassportFields = {
  surname: "",
  givenNames: "",
  passportNo: "",
  nationality: "",
  birthDate: "",
  expiryDate: "",
  sex: "",
};

const FIELD_KEYS = Object.keys(EMPTY_FIELDS) as (keyof PassportFields)[];

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** ADR-0019 후속 — 게스트가 /g에서 셀프 서명한 동의서(있을 때만 page가 전달) */
export interface GuestSignature {
  signatureUrl: string;
  agreementVersion: string | null;
  /** ISO 문자열(표시용) */
  signedAt: string | null;
}

export default function CheckinForm({
  bookingId,
  guestCount,
  agreement,
  guestSignature,
}: {
  bookingId: string;
  guestCount: number;
  /** 발행본 동의서 콘텐츠 — RSC에서 store 조회 후 주입 */
  agreement: AgreementContent;
  /** 게스트 셀프 서명(/g) — 있으면 기본 채택, 운영자가 현장 재서명으로 덮어쓸 수 있음 */
  guestSignature?: GuestSignature | null;
}) {
  const t = useTranslations("adminCheckin");
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [passports, setPassports] = useState<PassportEntry[]>([]);
  // T3.2 — 동의서 터치 서명(선택). 무서명 체크인 허용 — 사후 서명 경로 존재 (계약 결정 1·2)
  //   ADR-0019 후속 — 게스트 셀프 서명이 있으면 그 URL을 기본 채택(운영자 재서명 전까지).
  const [signatureUrl, setSignatureUrl] = useState<string | null>(
    guestSignature?.signatureUrl ?? null
  );
  // 게스트 서명을 채택 중인지(=현장 재서명 모드 아님). 게스트 서명 없으면 항상 false.
  const [resign, setResign] = useState(false);
  const adoptingGuest = Boolean(guestSignature) && !resign;
  const [uploading, setUploading] = useState(false);
  const [depositSkipped, setDepositSkipped] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositCurrency, setDepositCurrency] = useState<"KRW" | "VND" | "USD">("VND");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slotCount = Math.max(guestCount, passports.length + 1);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const resized = await resizeImage(file);
      const mimeType = resized.type || file.type;
      const form = new FormData();
      form.append("file", resized, file.name);
      const res = await fetch("/api/uploads/passport", { method: "POST", body: form });
      if (!res.ok) {
        setError(t("passport.uploadError"));
        return;
      }
      const { url } = (await res.json()) as { url: string };
      const base64 = await blobToBase64(resized);
      setPassports((prev) => [
        ...prev,
        { url, base64, mimeType, ocrState: "idle", data: { ...EMPTY_FIELDS } },
      ]);
    } catch {
      setError(t("passport.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const runOcr = async (index: number) => {
    setPassports((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ocrState: "running" } : p))
    );
    const target = passports[index];
    try {
      const res = await fetch("/api/ocr/passport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: target.base64, mimeType: target.mimeType }),
      });
      if (res.status === 503) {
        setPassports((prev) =>
          prev.map((p, i) => (i === index ? { ...p, ocrState: "not_configured" } : p))
        );
        return;
      }
      if (!res.ok) throw new Error();
      const { data } = (await res.json()) as { data: Partial<Record<keyof PassportFields, string | null>> };
      setPassports((prev) =>
        prev.map((p, i) =>
          i === index
            ? {
                ...p,
                ocrState: "done",
                data: Object.fromEntries(
                  FIELD_KEYS.map((k) => [k, data[k] ?? p.data[k] ?? ""])
                ) as unknown as PassportFields,
              }
            : p
        )
      );
    } catch {
      setPassports((prev) =>
        prev.map((p, i) => (i === index ? { ...p, ocrState: "failed" } : p))
      );
    }
  };

  const setField = (index: number, key: keyof PassportFields, value: string) => {
    setPassports((prev) =>
      prev.map((p, i) => (i === index ? { ...p, data: { ...p.data, [key]: value } } : p))
    );
  };

  const removePassport = (index: number) => {
    setPassports((prev) => prev.filter((_, i) => i !== index));
  };

  const depositValid =
    depositSkipped ||
    (/^\d+$/.test(depositAmount.replaceAll(",", "")) &&
      Number(depositAmount.replaceAll(",", "")) >= 1);
  const canSubmit = passports.length >= 1 && depositValid && !submitting && !uploading;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passportPhotoUrls: passports.map((p) => p.url),
          passportData: passports.map((p) =>
            Object.fromEntries(FIELD_KEYS.map((k) => [k, p.data[k].trim() || null]))
          ),
          deposit: depositSkipped
            ? null
            : {
                amount: Number(depositAmount.replaceAll(",", "")),
                currency: depositCurrency,
              },
          signatureUrl, // T3.2 — null이면 무서명 체크인 (미서명 배지·사후 서명으로 해소)
          // ADR-0019 후속 — 게스트 서명 채택 시 토큰 판본 동봉(현장 재서명이면 생략 → 서버 null)
          ...(adoptingGuest && guestSignature?.agreementVersion
            ? { agreementVersion: guestSignature.agreementVersion }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? data?.error ?? t("submitError"));
        return;
      }
      router.push(`/bookings/${bookingId}`);
      router.refresh();
    } catch {
      setError(t("submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section 1: 여권 확인 (b3) */}
      <section className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-3">
          <span className="w-7 h-7 flex items-center justify-center bg-blue-600 rounded-full text-xs font-bold text-white">
            1
          </span>
          <h3 className="font-bold text-slate-100">{t("passport.title")}</h3>
          <span className="ml-auto text-xs text-slate-500">
            {t("passport.count", { n: passports.length, total: guestCount })}
          </span>
        </div>
        <div className="p-6 space-y-6">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {passports.map((p, i) => (
              <div
                key={p.url}
                className="relative group aspect-[3/4] rounded-lg overflow-hidden border border-slate-600"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- ADMIN 가드 API 서빙 (next/image 외부 로더 불필요) */}
                <img src={p.url} alt={t("passport.alt", { n: i + 1 })} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePassport(i)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/80 text-slate-300 hover:text-white flex items-center justify-center"
                  aria-label={t("passport.remove")}
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
            ))}
            {Array.from({ length: Math.max(0, slotCount - passports.length) }).map((_, i) => (
              <button
                key={i}
                type="button"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
                className="aspect-[3/4] rounded-lg flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-600 hover:bg-slate-700/50 transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-slate-500">
                  {uploading && i === 0 ? "hourglass_top" : "add_a_photo"}
                </span>
                <span className="text-[10px] text-slate-500 font-bold uppercase">
                  {uploading && i === 0 ? t("passport.uploading") : t("passport.upload")}
                </span>
              </button>
            ))}
          </div>

          {/* OCR 결과 — 장별 확인·수정 (자동 저장 금지: 이 폼의 확정본만 제출됨) */}
          {passports.map((p, i) => (
            <div key={p.url} className="bg-slate-900 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-tight">
                  <span className="material-symbols-outlined text-[14px]">psychology</span>
                  <span>{t("passport.ocrTitle", { n: i + 1 })}</span>
                </div>
                <button
                  type="button"
                  disabled={p.ocrState === "running"}
                  onClick={() => runOcr(i)}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-sm">document_scanner</span>
                  {p.ocrState === "running" ? t("passport.ocrRunning") : t("passport.ocrRun")}
                </button>
              </div>
              {p.ocrState === "not_configured" && (
                <p className="text-[11px] text-amber-500">{t("passport.ocrNotConfigured")}</p>
              )}
              {p.ocrState === "failed" && (
                <p className="text-[11px] text-red-400">{t("passport.ocrFailed")}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {FIELD_KEYS.map((key) => (
                  <label
                    key={key}
                    className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-md flex items-center gap-2"
                  >
                    <span className="text-[10px] text-slate-500 font-bold whitespace-nowrap">
                      {t(`passport.fields.${key}`)}
                    </span>
                    <input
                      value={p.data[key]}
                      onChange={(e) => setField(i, key, e.target.value)}
                      className="bg-transparent border-none p-0 text-sm font-medium text-slate-100 w-28 focus:ring-0"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2: 보증금 (b3) */}
      <section className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-3">
          <span className="w-7 h-7 flex items-center justify-center bg-blue-600 rounded-full text-xs font-bold text-white">
            2
          </span>
          <h3 className="font-bold text-slate-100">{t("deposit.title")}</h3>
          <label className="ml-auto flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={depositSkipped}
              onChange={(e) => setDepositSkipped(e.target.checked)}
              className="rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500"
            />
            {t("deposit.skip")}
          </label>
        </div>
        {!depositSkipped && (
          <div className="p-6">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex-1 relative min-w-[220px]">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-[10px] uppercase">
                  {t("deposit.amount")}
                </span>
                <input
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value.replace(/[^\d,]/g, ""))}
                  inputMode="numeric"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-28 pr-4 py-4 text-xl font-black text-white focus:ring-2 focus:ring-blue-500 outline-none tabular-nums"
                />
              </div>
              <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-700">
                {(["KRW", "VND", "USD"] as const).map((cur) => (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setDepositCurrency(cur)}
                    className={
                      depositCurrency === cur
                        ? "px-4 py-3 rounded-lg bg-blue-600 text-white font-bold text-sm"
                        : "px-4 py-3 rounded-lg text-slate-400 hover:text-white font-bold text-sm"
                    }
                  >
                    {cur}
                  </button>
                ))}
              </div>
            </div>
            {depositValid && depositAmount && (
              <div className="mt-4 flex items-center justify-end">
                <span className="px-3 py-1 bg-green-500/20 text-green-500 border border-green-500/30 rounded-md text-xs font-black tracking-widest flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                  {t("deposit.held")}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 3: 동의서 + 터치 서명 (T3.2, b3 §3) */}
      {adoptingGuest && guestSignature ? (
        <section className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-3">
            <span className="w-7 h-7 flex items-center justify-center bg-blue-600 rounded-full text-xs font-bold text-white">
              3
            </span>
            <h3 className="font-bold text-slate-100">{t("agreement.title")}</h3>
          </div>
          <div className="p-6 space-y-4">
            {/* 게스트 셀프 서명 채택 안내 배지 */}
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3">
              <span className="material-symbols-outlined icon-fill text-green-500">draw</span>
              <div className="text-sm">
                <p className="font-bold text-green-400">{t("agreement.guestSigned.title")}</p>
                {/* suppressHydrationWarning: toLocaleString이 서버/브라우저 ICU 차이로 다른 문자열을 만들어
                    하이드레이션 불일치(#418) 유발 → 같은 인스턴트라 클라 렌더 채택. 포맷은 ko-KR·현지TZ로 고정. */}
                <p className="text-[11px] text-slate-400" suppressHydrationWarning>
                  {t("agreement.guestSigned.meta", {
                    version: guestSignature.agreementVersion ?? "-",
                    at: guestSignature.signedAt
                      ? new Date(guestSignature.signedAt).toLocaleString("ko-KR", {
                          timeZone: "Asia/Ho_Chi_Minh",
                        })
                      : "-",
                  })}
                </p>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- ADMIN 가드 API 서빙 */}
            <img
              src={guestSignature.signatureUrl}
              alt={t("agreement.signatureLabel")}
              className="max-h-32 rounded-md border border-slate-700 bg-white p-2"
            />
            <button
              type="button"
              onClick={() => {
                setResign(true);
                setSignatureUrl(null);
              }}
              className="text-xs font-bold text-blue-400 hover:text-blue-300 underline"
            >
              {t("agreement.guestSigned.resign")}
            </button>
          </div>
        </section>
      ) : (
        <>
          {guestSignature && (
            <button
              type="button"
              onClick={() => {
                setResign(false);
                setSignatureUrl(guestSignature.signatureUrl);
              }}
              className="block mx-auto text-xs font-bold text-slate-400 hover:text-slate-200 underline"
            >
              {t("agreement.guestSigned.useGuest")}
            </button>
          )}
          <AgreementSection sectionNo={3} agreement={agreement} onSigned={setSignatureUrl} />
          {!signatureUrl && (
            <p className="text-center text-[11px] text-amber-400/80">{t("agreement.unsignedHint")}</p>
          )}
        </>
      )}

      {/* 공급자 전달(T3.6) 섹션은 해당 태스크에서 추가 — 미렌더 (T3.1 계약 조건 B) */}

      {/* Section 4: 완료 (b3) */}
      <div className="pt-4 pb-12">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="w-full bg-blue-600 hover:bg-blue-500 py-6 rounded-xl text-lg font-black text-white shadow-[0_0_40px_rgba(59,130,246,0.3)] flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-2xl">check_circle</span>
          {submitting ? t("submitting") : t("submit")}
        </button>
        <p className="text-center text-[10px] text-slate-500 font-medium mt-4 uppercase tracking-[0.2em]">
          {passports.length === 0 ? t("needPassport") : t("submitCaption")}
        </p>
        {error && <p className="text-center text-xs text-red-400 mt-2">{error}</p>}
      </div>
    </div>
  );
}
