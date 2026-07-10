"use client";

// 공급자 vi 체크인 폼 (T10.5, a-supplier-checkin) — 라이트 모바일 390px.
// 여권 사진 카드(인원수만큼) → Gemini OCR(이름·여권번호) → 보증금(VND) → 동의서 터치 서명 → 체크인.
// "운영자 전달" 단계 없음(공급자 본인 임시거주신고). 서명 비게이트 + 미서명 배지(T3.1 조건 C).
// 여권/서명은 비공개 증빙 파이프라인(/api/uploads/passport → /api/passports/sig·여권). 공급자 자기 업로드분만.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { resizeImage } from "@/lib/image-resize";
import type { AgreementContent, AgreementLang } from "@/lib/agreement";
import { agreementVersionLabel } from "@/lib/agreement";
import SupplierSignaturePad from "./signature-pad";
import { InlineGuide } from "@/components/inline-guide";

interface PassportEntry {
  url: string; // /api/passports/<name>
  base64: string; // OCR 재요청용 (메모리만)
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

/** VND 천단위 dot 포맷 (vi 규칙) — 5000000 → "5.000.000" */
function formatVndInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export default function SupplierCheckinForm({
  bookingId,
  guestCount,
  agreement,
  agreementLang,
}: {
  bookingId: string;
  guestCount: number;
  /** 발행본 동의서 콘텐츠 — RSC에서 store 조회 후 주입 (수영장 조항 자동 포함은 본문에 반영됨) */
  agreement: AgreementContent;
  /** 표시 언어 — 공급자 로케일(vi 기본) */
  agreementLang: AgreementLang;
}) {
  const t = useTranslations("supplierCheckin");
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [passports, setPassports] = useState<PassportEntry[]>([]);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [depositSkipped, setDepositSkipped] = useState(false);
  const [depositAmount, setDepositAmount] = useState(""); // dot 포맷
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
      const { data } = (await res.json()) as {
        data: Partial<Record<keyof PassportFields, string | null>>;
      };
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

  const depositDigits = depositAmount.replace(/\D/g, "");
  const depositValid = depositSkipped || (depositDigits !== "" && Number(depositDigits) >= 1);
  // ADR-0029 D4 — 동의 필수 게이트: 서명(c8 여권 제3자 전달 동의 포함) 없이는 체크인 완료 불가.
  const canSubmit =
    passports.length >= 1 && depositValid && Boolean(signatureUrl) && !submitting && !uploading;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/supplier/bookings/${bookingId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passportPhotoUrls: passports.map((p) => p.url),
          passportData: passports.map((p) =>
            Object.fromEntries(FIELD_KEYS.map((k) => [k, p.data[k].trim() || null]))
          ),
          deposit: depositSkipped
            ? null
            : { amount: Number(depositDigits), currency: "VND" },
          signatureUrl, // ADR-0029 D4 — 서명 필수(canSubmit 게이트). 무서명이면 서버가 409 AGREEMENT_NOT_SIGNED
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? t("submitError"));
        return;
      }
      router.push("/my-bookings");
      router.refresh();
    } catch {
      setError(t("submitError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <main className="mx-auto max-w-md space-y-4 px-4 pb-40 pt-4">
        {/* Step 1: 여권 사진 + OCR */}
        <section className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
              1
            </span>
            <h2 className="font-bold text-neutral-800">{t("passport.title")}</h2>
            <span className="ml-auto text-xs font-bold text-teal-600">
              {passports.length} / {guestCount}
            </span>
          </div>
          <div className="p-4">
            <input
              ref={fileInput}
              type="file"
              aria-label={t("passport.upload")}
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
            <div className="grid grid-cols-3 gap-3">
              {passports.map((p, i) => (
                <div key={p.url} className="flex flex-col gap-1.5">
                  <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-neutral-200">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 가드 API 서빙(공급자 본인 업로드분) */}
                    <img src={p.url} alt={t("passport.alt", { n: i + 1 })} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePassport(i)}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white"
                      aria-label={t("passport.remove")}
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                </div>
              ))}
              {Array.from({ length: Math.max(0, slotCount - passports.length) }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                  className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-300 text-neutral-400 transition-transform active:scale-95 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-2xl">
                    {uploading && i === 0 ? "hourglass_top" : "add_a_photo"}
                  </span>
                  <span className="text-[10px] font-bold">
                    {uploading && i === 0
                      ? t("passport.uploading")
                      : t("passport.guestN", { n: passports.length + i + 1 })}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-xl bg-neutral-50 p-3 text-xs text-neutral-500">
              <span className="material-symbols-outlined text-[18px] text-teal-600">
                document_scanner
              </span>
              <p>{t("passport.ocrHint")}</p>
            </div>

            {/* OCR 결과 — 장별 확인·수정 */}
            {passports.map((p, i) => (
              <div key={p.url} className="mt-3 space-y-3 rounded-xl bg-neutral-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-tight text-neutral-500">
                    {t("passport.ocrTitle", { n: i + 1 })}
                  </span>
                  <button
                    type="button"
                    disabled={p.ocrState === "running"}
                    onClick={() => runOcr(i)}
                    className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-sm">document_scanner</span>
                    {p.ocrState === "running" ? t("passport.ocrRunning") : t("passport.ocrRun")}
                  </button>
                </div>
                {p.ocrState === "not_configured" && (
                  <p className="text-[11px] text-amber-600">{t("passport.ocrNotConfigured")}</p>
                )}
                {p.ocrState === "failed" && (
                  <p className="text-[11px] text-red-500">{t("passport.ocrFailed")}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {FIELD_KEYS.map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5"
                    >
                      <span className="whitespace-nowrap text-[10px] font-bold text-neutral-400">
                        {t(`passport.fields.${key}`)}
                      </span>
                      <input
                        value={p.data[key]}
                        onChange={(e) => setField(i, key, e.target.value)}
                        className="w-24 border-none bg-transparent p-0 text-sm font-medium text-neutral-800 focus:ring-0"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Step 2: 보증금 (VND) */}
        <section className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
              2
            </span>
            <h2 className="font-bold text-neutral-800">{t("deposit.title")}</h2>
            <label className="ml-auto flex items-center gap-2 text-xs font-medium text-neutral-500">
              <input
                type="checkbox"
                checked={depositSkipped}
                onChange={(e) => setDepositSkipped(e.target.checked)}
                className="h-5 w-5 rounded border-2 border-neutral-300 text-teal-600 focus:ring-teal-500"
              />
              {t("deposit.skip")}
            </label>
          </div>
          {!depositSkipped && (
            <div className="p-4">
              {/* 인라인 가이드 — 이 금액이 체크아웃 환불 계산의 기준값 (T-tutorial-onboarding-9) */}
              <div className="mb-3">
                <InlineGuide text={t("guide.deposit")} />
              </div>
              <div className="flex h-16 items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-4 focus-within:ring-2 focus-within:ring-teal-500">
                <span className="material-symbols-outlined text-neutral-400">savings</span>
                <input
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(formatVndInput(e.target.value))}
                  inputMode="numeric"
                  placeholder="0"
                  className="min-w-0 flex-1 border-none bg-transparent p-0 text-2xl font-extrabold tabular-nums placeholder-neutral-300 focus:ring-0"
                />
                <span className="text-lg font-bold text-neutral-400">₫</span>
              </div>
              {depositDigits !== "" && Number(depositDigits) >= 1 && (
                <div className="mt-3 flex items-center justify-end">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-green-100 bg-green-50 px-3 py-1 text-xs font-bold text-[#16A34A]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
                    {t("deposit.held")}
                  </span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Step 3: 동의서 + 터치 서명 */}
        <section className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
              3
            </span>
            <h2 className="font-bold text-neutral-800">{t("agreement.title")}</h2>
          </div>
          <div className="space-y-4 p-4">
            {/* 인라인 가이드 — 게스트에게 읽히고 화면 서명 받는 절차 안내 (T-tutorial-onboarding-9) */}
            <InlineGuide text={t("guide.agreement")} />
            <div className="no-scrollbar h-40 space-y-2 overflow-y-auto rounded-xl border border-neutral-100 bg-neutral-50 p-4 text-xs leading-relaxed text-neutral-500">
              <p className="font-bold text-neutral-700">{agreement.docTitle[agreementLang]}</p>
              <p className="whitespace-pre-line">{agreement.body[agreementLang]}</p>
              <p className="pt-1 text-[10px] text-neutral-400">{agreementVersionLabel(agreement)}</p>
            </div>

            {signatureUrl ? (
              <div className="flex items-center justify-end">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-green-100 bg-green-50 px-3 py-1 text-xs font-bold text-[#16A34A]">
                  <span className="material-symbols-outlined text-sm">draw</span>
                  {t("agreement.signedBadge")}
                </span>
              </div>
            ) : (
              <SupplierSignaturePad onSigned={setSignatureUrl} />
            )}

            <label className="flex items-center gap-3 p-1">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="h-6 w-6 rounded-md border-2 border-neutral-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm font-medium text-neutral-700">{t("agreement.consent")}</span>
            </label>

            {!signatureUrl && (
              <p className="text-center text-[11px] text-amber-600">{t("agreement.unsignedHint")}</p>
            )}
          </div>
        </section>
      </main>

      {/* Sticky 완료 CTA */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-neutral-100 bg-white/95 px-4 pt-3 backdrop-blur">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="mb-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 text-lg font-bold text-white shadow-lg shadow-teal-900/10 transition-all active:scale-[0.98] disabled:opacity-40"
        >
          <span className="material-symbols-outlined">how_to_reg</span>
          {submitting ? t("submitting") : t("submit")}
        </button>
        {error ? (
          <p className="mb-2 text-center text-xs font-medium text-red-500">{error}</p>
        ) : (
          <p className="mb-2 text-center text-[11px] font-medium text-neutral-400">
            {passports.length === 0 ? t("needPassport") : t("submitCaption")}
          </p>
        )}
      </div>
    </>
  );
}
