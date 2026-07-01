"use client";

// 원천 공급자 자가 가입 폼 (ADR-0023 S5) — vi 기본·라이트·모바일.
//   POST /api/vendor-signup body {name,phone,password,zaloUserId?,bankBank?,bankAccount?,bankHolder?,note?}.
//   409 PHONE_TAKEN → phoneExists. 성공(201) → 승인 대기 안내 화면.
//   ★ 공급자 화면: 판매가·마진·고객 상세 없음. 정산계좌는 본인 입력값(선택).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";

interface Labels {
  headerTitle: string;
  title: string;
  subtitle: string;
  name: string;
  namePlaceholder: string;
  phone: string;
  phonePlaceholder: string;
  password: string;
  passwordPlaceholder: string;
  zalo: string;
  zaloPlaceholder: string;
  zaloHint: string;
  bankTitle: string;
  bank: string;
  bankPlaceholder: string;
  account: string;
  accountPlaceholder: string;
  holder: string;
  holderPlaceholder: string;
  note: string;
  notePlaceholder: string;
  submit: string;
  submitting: string;
  back: string;
  hasAccount: string;
  loginLink: string;
  successTitle: string;
  successBody: string;
  goLogin: string;
  errorMessages: Record<string, string>;
}

const inputCls =
  "w-full h-14 px-4 bg-neutral-50 border border-neutral-200 rounded-xl text-base transition-all focus:bg-white focus:border-teal-400 outline-none";

export default function VendorSignupForm({ labels }: { labels: Labels }) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") ?? "");
    if (password.length < 8) {
      setError("passwordTooShort");
      return;
    }
    const body = {
      name: String(fd.get("name") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim(),
      password,
      zaloUserId: String(fd.get("zaloUserId") ?? "").trim() || undefined,
      bankBank: String(fd.get("bankBank") ?? "").trim() || undefined,
      bankAccount: String(fd.get("bankAccount") ?? "").trim() || undefined,
      bankHolder: String(fd.get("bankHolder") ?? "").trim() || undefined,
      note: String(fd.get("note") ?? "").trim() || undefined,
    };

    setIsPending(true);
    try {
      const res = await fetch("/api/vendor-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (data.error === "PHONE_TAKEN") setError("phoneExists");
      else setError("serverError");
    } catch {
      setError("serverError");
    } finally {
      setIsPending(false);
    }
  }

  // ── 성공: 승인 대기 안내 ─────────────────────────────────────────
  if (done) {
    return (
      <div className="bg-white text-neutral-900 min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="w-20 h-20 rounded-full bg-teal-50 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-teal-600 text-5xl [font-variation-settings:'FILL'_1]">
            check_circle
          </span>
        </div>
        <h2 className="text-2xl font-bold text-neutral-900">{labels.successTitle}</h2>
        <p className="mt-3 max-w-sm text-neutral-500 leading-relaxed">{labels.successBody}</p>
        <Link
          href="/login"
          className="mt-8 w-full max-w-xs h-14 flex items-center justify-center bg-teal-600 active:scale-[0.98] transition-all text-white font-bold text-lg rounded-xl shadow-lg shadow-teal-600/20"
        >
          {labels.goLogin}
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white text-neutral-900 min-h-screen flex flex-col w-full">
      {/* 상단 내비게이션 */}
      <header className="w-full top-0 sticky bg-white border-b border-neutral-100 z-50">
        <div className="flex items-center px-4 h-16 w-full">
          <button
            className="text-neutral-500 active:scale-95 transition-transform p-2"
            type="button"
            onClick={() => router.push("/login")}
            aria-label={labels.back}
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="font-headline font-semibold text-lg text-neutral-900 ml-2">
            {labels.headerTitle}
          </h1>
        </div>
      </header>

      <main className="flex-1 px-6 pt-8 pb-44 max-w-md mx-auto w-full">
        {/* 브랜드 헤더 */}
        <div className="mb-8">
          <span className="flex items-center gap-1.5 mb-2">
            <VillaGoMark className="h-5 w-auto" />
            <VillaGoWordmark
              className="font-headline text-base"
              villa="text-slate-900"
              go="text-teal-600"
            />
          </span>
          <h2 className="text-3xl font-bold text-neutral-900 tracking-tight">{labels.title}</h2>
          <p className="text-neutral-500 mt-2 leading-relaxed">{labels.subtitle}</p>
        </div>

        <form
          onSubmit={onSubmit}
          id="vendor-signup-form"
          className="space-y-5 [&_input]:scroll-mb-44 [&_textarea]:scroll-mb-44"
        >
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-4 py-3 rounded-xl">
              {labels.errorMessages[error] ?? error}
            </div>
          )}

          {/* 상호명 (필수) */}
          <div>
            <label className="block text-sm font-semibold text-neutral-700 mb-2 ml-1" htmlFor="name">
              {labels.name}
            </label>
            <input
              className={inputCls}
              id="name"
              name="name"
              placeholder={labels.namePlaceholder}
              type="text"
              autoComplete="organization"
              maxLength={120}
              required
            />
          </div>

          {/* 전화번호 (필수) */}
          <div>
            <label className="block text-sm font-semibold text-neutral-700 mb-2 ml-1" htmlFor="phone">
              {labels.phone}
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">
                call
              </span>
              <input
                className={`${inputCls} pl-12`}
                id="phone"
                name="phone"
                inputMode="numeric"
                autoComplete="tel"
                placeholder={labels.phonePlaceholder}
                type="tel"
                required
                onChange={(e) => {
                  e.target.value = e.target.value.replace(/[^0-9]/g, "");
                }}
              />
            </div>
          </div>

          {/* 비밀번호 (필수, min8) */}
          <div>
            <label
              className="block text-sm font-semibold text-neutral-700 mb-2 ml-1"
              htmlFor="password"
            >
              {labels.password}
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">
                lock
              </span>
              <input
                className={`${inputCls} pl-12 pr-12`}
                id="password"
                name="password"
                autoComplete="new-password"
                placeholder={labels.passwordPlaceholder}
                type={showPassword ? "text" : "password"}
                minLength={8}
                required
              />
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400 active:text-teal-600 transition-colors"
                onClick={() => setShowPassword((v) => !v)}
                type="button"
                tabIndex={-1}
              >
                <span className="material-symbols-outlined">
                  {showPassword ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </div>

          {/* Zalo ID (선택) */}
          <div>
            <label className="block text-sm font-semibold text-neutral-700 mb-2 ml-1" htmlFor="zaloUserId">
              {labels.zalo}
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">
                forum
              </span>
              <input
                className={`${inputCls} pl-12`}
                id="zaloUserId"
                name="zaloUserId"
                placeholder={labels.zaloPlaceholder}
                type="text"
                maxLength={64}
              />
            </div>
            <p className="text-[12px] text-neutral-500 mt-1.5 ml-1">{labels.zaloHint}</p>
          </div>

          {/* 정산계좌 (선택) */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 space-y-3">
            <p className="text-[13px] font-bold text-neutral-600 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[18px] text-neutral-400">
                account_balance
              </span>
              {labels.bankTitle}
            </p>
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1 ml-1" htmlFor="bankBank">
                {labels.bank}
              </label>
              <input
                className={`${inputCls} h-12 bg-white`}
                id="bankBank"
                name="bankBank"
                placeholder={labels.bankPlaceholder}
                type="text"
                maxLength={120}
              />
            </div>
            <div>
              <label
                className="block text-xs font-medium text-neutral-500 mb-1 ml-1"
                htmlFor="bankAccount"
              >
                {labels.account}
              </label>
              <input
                className={`${inputCls} h-12 bg-white`}
                id="bankAccount"
                name="bankAccount"
                inputMode="numeric"
                placeholder={labels.accountPlaceholder}
                type="text"
                maxLength={120}
              />
            </div>
            <div>
              <label
                className="block text-xs font-medium text-neutral-500 mb-1 ml-1"
                htmlFor="bankHolder"
              >
                {labels.holder}
              </label>
              <input
                className={`${inputCls} h-12 bg-white`}
                id="bankHolder"
                name="bankHolder"
                placeholder={labels.holderPlaceholder}
                type="text"
                maxLength={120}
              />
            </div>
          </div>

          {/* 메모 (선택) */}
          <div>
            <label className="block text-sm font-semibold text-neutral-700 mb-2 ml-1" htmlFor="note">
              {labels.note}
            </label>
            <textarea
              className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-base transition-all focus:bg-white focus:border-teal-400 outline-none"
              id="note"
              name="note"
              placeholder={labels.notePlaceholder}
              maxLength={1000}
              rows={2}
            />
          </div>
        </form>
      </main>

      {/* 하단 고정 액션 */}
      <div className="fixed bottom-0 left-0 w-full bg-white border-t border-neutral-100 px-6 pt-4 pb-8 flex flex-col gap-3 shadow-[0_-8px_30px_rgb(0,0,0,0.04)]">
        <button
          className="w-full h-16 bg-teal-600 active:scale-[0.98] disabled:opacity-60 transition-all text-white font-bold text-lg rounded-xl shadow-lg shadow-teal-600/20"
          type="submit"
          form="vendor-signup-form"
          disabled={isPending}
        >
          {isPending ? labels.submitting : labels.submit}
        </button>
        <Link className="text-center text-neutral-600 font-medium py-1" href="/login">
          {labels.hasAccount}{" "}
          <span className="text-teal-600 font-bold">{labels.loginLink}</span>
        </Link>
      </div>

      {/* 배경 장식 */}
      <div className="fixed -top-24 -right-24 w-64 h-64 bg-teal-50 rounded-full blur-3xl -z-10 opacity-60" />
      <div className="fixed -bottom-24 -left-24 w-64 h-64 bg-amber-50 rounded-full blur-3xl -z-10 opacity-40" />
    </div>
  );
}
