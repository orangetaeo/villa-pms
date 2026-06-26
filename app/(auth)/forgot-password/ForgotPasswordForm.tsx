"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";

interface Labels {
  forgotTitle: string;
  forgotSubtitle: string;
  phone: string;
  phonePlaceholder: string;
  sendCode: string;
  sending: string;
  sentTitle: string;
  sentBody: string;
  notLinkedHint: string;
  goReset: string;
  backToLogin: string;
  errorMessages: Record<string, string>;
}

export default function ForgotPasswordForm({ labels }: { labels: Labels }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        setError("serverError");
        return;
      }
      // 사용자 열거 방지 — 존재 여부와 무관하게 "코드 전송됨" 단계로 진행
      setSent(true);
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
        {!sent ? (
          <>
            <div className="text-center">
              <h2 className="text-3xl font-bold text-slate-900 mb-2">{labels.forgotTitle}</h2>
              <p className="text-slate-500 text-sm">{labels.forgotSubtitle}</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-4 py-3 rounded-xl">
                  {labels.errorMessages[error] ?? error}
                </div>
              )}

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

              <div className="pt-4">
                <button
                  className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold text-lg rounded-xl touch-target shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  type="submit"
                  disabled={pending || phone.length === 0}
                >
                  {pending ? labels.sending : labels.sendCode}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="text-center space-y-3">
              <div className="w-14 h-14 bg-teal-50 rounded-full flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-teal-600 text-3xl">
                  mark_email_read
                </span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">{labels.sentTitle}</h2>
              <p className="text-slate-600 text-sm leading-relaxed">{labels.sentBody}</p>
            </div>

            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-3 rounded-xl">
              {labels.notLinkedHint}
            </div>

            <div className="pt-2">
              <button
                className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold text-lg rounded-xl touch-target shadow-md active:scale-[0.98] transition-all"
                type="button"
                onClick={() =>
                  router.push(`/reset-password?phone=${encodeURIComponent(phone)}`)
                }
              >
                {labels.goReset}
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
