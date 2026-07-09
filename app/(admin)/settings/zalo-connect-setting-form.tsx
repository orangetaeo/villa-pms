"use client";

// Zalo 연결 온보딩 설정 — ZALO_CONNECT_QR_URL·ZALO_CONNECT_OA_URL
// (T-zalo-connect-qr-admin-setting). 공급자·청소 온보딩(/zalo-connect)의 QR 이미지·
// 친구추가 딥링크를 회사 공용 Zalo 계정에 맞춰 등록. 비우고 저장하면 env 폴백.
// 단일 저장 버튼 → 배치 PUT(entries). QR 이미지는 기존 /api/uploads(POST FormData → {url}) 재사용.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// 클라이언트 검증 — 서버(route.ts VALIDATORS)와 동일 규칙, 빈 값 허용(선택 입력=env 폴백)
const zaloFormSchema = z.object({
  // QR URL: 업로드 결과(/uploads/…) 또는 https:// 절대 URL. 수동 입력은 없지만 hidden으로 관리.
  qrUrl: z
    .string()
    .trim()
    .refine(
      (v) => {
        if (v === "") return true;
        if (v.length > 500) return false;
        if (v.startsWith("/uploads/")) return true;
        try {
          return new URL(v).protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "qr" }
    ),
  oaUrl: z
    .string()
    .trim()
    .refine(
      (v) => {
        if (v === "") return true;
        if (v.length > 500) return false;
        try {
          return new URL(v).protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "oa" }
    ),
});

type ZaloFormValues = z.infer<typeof zaloFormSchema>;

export type ZaloConnectInitial = {
  qrUrl: string;
  oaUrl: string;
  /** 설정이 비어 env 폴백이 적용 중인지 — 미리보기 안내 문구 분기 */
  qrFromEnv: boolean;
  oaFromEnv: boolean;
};

const FIELD_TO_KEY: Record<keyof ZaloFormValues, string> = {
  qrUrl: "ZALO_CONNECT_QR_URL",
  oaUrl: "ZALO_CONNECT_OA_URL",
};

export default function ZaloConnectSettingForm({ initial }: { initial: ZaloConnectInitial }) {
  const t = useTranslations("adminSettings.zaloConnectCard");
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<ZaloFormValues>({
    resolver: zodResolver(zaloFormSchema),
    defaultValues: { qrUrl: initial.qrUrl, oaUrl: initial.oaUrl },
  });

  const qrUrl = watch("qrUrl");

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    setMessage(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data: { url?: string } = await res.json();
      if (!data.url) throw new Error("NO_URL");
      setValue("qrUrl", data.url, { shouldDirty: true, shouldValidate: true });
    } catch {
      setMessage({ ok: false, text: t("uploadError") });
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (values: ZaloFormValues) => {
    setMessage(null);
    const entries = (Object.keys(FIELD_TO_KEY) as (keyof ZaloFormValues)[]).map((field) => ({
      key: FIELD_TO_KEY[field],
      value: values[field].trim(),
    }));
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t("error") });
    }
  };

  const inputClass =
    "w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:ring-1 focus:ring-admin-primary focus:border-admin-primary";

  return (
    <section className="bg-admin-card rounded-xl border border-slate-800 shadow-lg flex flex-col">
      {/* 카드 헤더 */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-800/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-admin-primary">qr_code_2</span>
          <h2 className="font-bold text-slate-100 uppercase tracking-wide whitespace-nowrap">
            {t("title")}
          </h2>
        </div>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-8">
        <p className="text-sm text-slate-500">{t("description")}</p>

        {/* QR 이미지 — 미리보기 + 업로드 */}
        <fieldset className="space-y-4">
          <legend className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            {t("qrLabel")}
          </legend>
          <div className="flex items-start gap-6">
            {/* 미리보기 */}
            <div className="w-32 h-32 shrink-0 rounded-lg border border-slate-700 bg-slate-900 flex items-center justify-center overflow-hidden">
              {qrUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="Zalo QR" src={qrUrl} className="w-full h-full object-contain" />
              ) : (
                <span className="material-symbols-outlined text-4xl text-slate-600">qr_code_2</span>
              )}
            </div>
            <div className="flex-1 space-y-3">
              <label className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 px-4 py-2 rounded-lg font-medium text-sm cursor-pointer transition-colors">
                <span className="material-symbols-outlined text-lg">upload</span>
                {uploading ? t("uploading") : t("uploadBtn")}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={onUpload}
                />
              </label>
              {qrUrl ? (
                <button
                  type="button"
                  onClick={() => setValue("qrUrl", "", { shouldDirty: true, shouldValidate: true })}
                  className="block text-xs text-slate-400 hover:text-red-400 underline underline-offset-2"
                >
                  {t("removeBtn")}
                </button>
              ) : (
                <p className="text-xs text-slate-500">
                  {initial.qrFromEnv ? t("qrEnvFallback") : t("qrEmptyHint")}
                </p>
              )}
              {errors.qrUrl && (
                <p role="alert" className="text-xs text-red-400">
                  {t(`err.${errors.qrUrl.message}`)}
                </p>
              )}
            </div>
          </div>
          {/* qrUrl은 업로드/삭제로만 갱신 — 등록만 하고 화면 미노출 */}
          <input type="hidden" {...register("qrUrl")} />
        </fieldset>

        {/* 친구추가 딥링크 */}
        <fieldset className="space-y-2 pt-2 border-t border-slate-800">
          <label
            htmlFor="zalo-oa-url"
            className="block text-xs font-bold text-slate-400 uppercase tracking-wider"
          >
            {t("oaLabel")}
          </label>
          <input
            id="zalo-oa-url"
            type="url"
            inputMode="url"
            placeholder="https://zalo.me/0791234567"
            className={inputClass}
            {...register("oaUrl")}
          />
          {errors.oaUrl ? (
            <p role="alert" className="text-xs text-red-400">
              {t(`err.${errors.oaUrl.message}`)}
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              {initial.oaFromEnv && !watch("oaUrl") ? t("oaEnvFallback") : t("oaHint")}
            </p>
          )}
        </fieldset>

        {/* 푸터: 안내 + 저장 */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-4 border-t border-slate-800">
          <p className="text-xs text-slate-500">{t("hint")}</p>
          <div className="flex items-center gap-3 self-end md:self-auto">
            {message && (
              <span
                role="status"
                className={`text-xs font-medium ${message.ok ? "text-emerald-500" : "text-red-400"}`}
              >
                {message.text}
              </span>
            )}
            <button
              type="submit"
              disabled={isSubmitting || uploading || !isDirty}
              className="bg-admin-primary hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-lg font-bold text-sm shadow-lg shadow-blue-500/20 transition-all flex items-center gap-2 whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-lg">save</span>
              {isSubmitting ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
