"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { loginAction } from "./actions";
import { VillaGoMark, VillaGoWordmark } from "@/components/brand/villa-go-logo";

interface Labels {
  title: string;
  phone: string;
  phonePlaceholder: string;
  password: string;
  passwordPlaceholder: string;
  submit: string;
  submitting: string;
  forgotPassword: string;
  noAccount: string;
  signupLink: string;
  errorMessages: Record<string, string>;
}

export default function LoginForm({ labels }: { labels: Labels }) {
  const [state, formAction, isPending] = useActionState(loginAction, null);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="flex-grow flex flex-col items-center justify-center px-6 py-12 max-w-md mx-auto w-full">
      {/* 로고 & 브랜드 */}
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

      {/* 로그인 폼 */}
      <section className="w-full space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-slate-900 mb-2">{labels.title}</h2>
        </div>

        <form action={formAction} className="space-y-4">
          {state?.error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-4 py-3 rounded-xl">
              {labels.errorMessages[state.error] ?? state.error}
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
                onChange={(e) => {
                  e.target.value = e.target.value.replace(/[^0-9]/g, "");
                }}
              />
            </div>
          </div>

          {/* 비밀번호 */}
          <div className="space-y-2">
            <label
              className="block text-sm font-semibold text-slate-700 ml-1"
              htmlFor="password"
            >
              {labels.password}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-slate-400">lock</span>
              </div>
              <input
                className="w-full bg-white border border-slate-200 rounded-xl pl-12 pr-12 touch-target text-lg font-medium transition-all"
                id="password"
                name="password"
                autoComplete="current-password"
                placeholder={labels.passwordPlaceholder}
                type={showPassword ? "text" : "password"}
                required
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

          {/* 비밀번호 찾기 링크 */}
          <div className="text-right">
            <Link
              className="text-sm font-semibold text-slate-500 hover:text-teal-600 transition-colors"
              href="/forgot-password"
            >
              {labels.forgotPassword}
            </Link>
          </div>

          {/* 로그인 버튼 */}
          <div className="pt-2">
            <button
              className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold text-lg rounded-xl touch-target shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              type="submit"
              disabled={isPending}
            >
              {isPending ? labels.submitting : labels.submit}
            </button>
          </div>
        </form>

        {/* 회원가입 링크 — 통합 가입 진입(/signup에서 유형 선택) */}
        <div className="text-center pt-4">
          <Link
            className="block text-slate-600 font-medium hover:text-teal-600 transition-colors"
            href="/signup"
          >
            {labels.noAccount}{" "}
            <span className="text-teal-600 font-bold">{labels.signupLink}</span>
          </Link>
        </div>
      </section>

      {/* 배경 장식 */}
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
