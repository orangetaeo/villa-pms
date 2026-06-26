"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";

interface Labels {
  resetTitle: string;
  resetSubtitle: string;
  phone: string;
  phonePlaceholder: string;
  code: string;
  codePlaceholder: string;
  newPassword: string;
  newPasswordPlaceholder: string;
  submit: string;
  submitting: string;
  successTitle: string;
  successBody: string;
  goLogin: string;
  backToLogin: string;
  errorMessages: Record<string, string>;
}

export default function ResetPasswordForm({
  labels,
  initialPhone,
}: {
  labels: Labels;
  initialPhone: string;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone.replace(/[^0-9]/g, ""));
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, newPassword }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (res.ok && data?.ok) {
        setDone(true);
        return;
      }
      setError(data?.error ?? "serverError");
    } catch {
      setError("serverError");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex-grow flex flex-col items-center justify-center px-6 py-12 max-w-md mx-auto w-full">
      <header className="flex flex-col items-center mb-12">
        <div className="w-16 h-16 bg-teal-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
          <VillaGoMark reverse className="h-9 w-auto" />
        </div>
        <VillaGoWordmark
          className="font-headline text-2xl"
          villa="text-slate-900"
          go="text-teal-600"
        />
      </header>

      <section className="w-full space-y-8">
        {!done ? (
          <>
            <div className="text-center">
              <h2 className="text-3xl font-bold text-slate-900 mb-2">{labels.resetTitle}</h2>
              <p className="text-slate-500 text-sm">{labels.resetSubtitle}</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-4 py-3 rounded-xl">
                  {labels.errorMessages[error] ?? labels.errorMessages.serverError}
                </div>
              )}

              {/* 전화번호 */}
              <div className="space-y-2">
                <label
                  className="block text-sm font-semibold text-slate-700 ml-1"
                  htmlFor="phone"
                >
                  {labels.phone}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <span className="material-symbols-outlined text-slate-400">phone</span>
                  </div>
                  <input
                    className="w-full bg-white border border-slate-200 rounded-xl pl-12 pr-4 touch-target text-lg font-medium transition-all"
                    id="phone"
                    name="phone"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder={labels.phonePlaceholder}
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                </div>
              </div>

              {/* 인증 코드 */}
              <div className="space-y-2">
                <label
                  className="block text-sm font-semibold text-slate-700 ml-1"
                  htmlFor="code"
                >
                  {labels.code}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <span className="material-symbols-outlined text-slate-400">pin</span>
                  </div>
                  <input
                    className="w-full bg-white border border-slate-200 rounded-xl pl-12 pr-4 touch-target text-lg font-medium tracking-[0.3em] transition-all"
                    id="code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={labels.codePlaceholder}
                    type="text"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                </div>
              </div>

              {/* 새 비밀번호 */}
              <div className="space-y-2">
                <label
                  className="block text-sm font-semibold text-slate-700 ml-1"
                  htmlFor="newPassword"
                >
                  {labels.newPassword}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <span className="material-symbols-outlined text-slate-400">lock</span>
                  </div>
                  <input
                    className="w-full bg-white border border-slate-200 rounded-xl pl-12 pr-12 touch-target text-lg font-medium transition-all"
                    id="newPassword"
                    name="newPassword"
                    autoComplete="new-password"
                    placeholder={labels.newPasswordPlaceholder}
                    type={showPassword ? "text" : "password"}
                    minLength={8}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 active:text-teal-600 transition-colors"
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

              <div className="pt-4">
                <button
                  className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold text-lg rounded-xl touch-target shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  type="submit"
                  disabled={
                    pending ||
                    phone.length === 0 ||
                    code.length !== 6 ||
                    newPassword.length < 8
                  }
                >
                  {pending ? labels.submitting : labels.submit}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="text-center space-y-3">
              <div className="w-14 h-14 bg-teal-50 rounded-full flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-teal-600 text-3xl">
                  check_circle
                </span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">{labels.successTitle}</h2>
              <p className="text-slate-600 text-sm leading-relaxed">{labels.successBody}</p>
            </div>
            <div className="pt-2">
              <button
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold text-lg rounded-xl touch-target shadow-md active:scale-[0.98] transition-all"
                type="button"
                onClick={() => router.push("/login")}
              >
                {labels.goLogin}
              </button>
            </div>
          </>
        )}

        <div className="text-center pt-4">
          <Link
            className="inline-flex items-center gap-1 text-slate-600 font-medium hover:text-teal-600 transition-colors"
            href="/login"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            {labels.backToLogin}
          </Link>
        </div>
      </section>

      <div className="fixed top-0 right-0 -z-10 opacity-10">
        <svg fill="none" height="400" viewBox="0 0 400 400" width="400" xmlns="http://www.w3.org/2000/svg">
          <circle cx="350" cy="50" fill="url(#paint0_radial)" r="150"></circle>
          <defs>
            <radialGradient
              cx="0"
              cy="0"
              gradientTransform="translate(350 50) rotate(90) scale(150)"
              gradientUnits="userSpaceOnUse"
              id="paint0_radial"
              r="1"
            >
              <stop stopColor="#0D9488"></stop>
              <stop offset="1" stopColor="#0D9488" stopOpacity="0"></stop>
            </radialGradient>
          </defs>
        </svg>
      </div>
    </main>
  );
}
