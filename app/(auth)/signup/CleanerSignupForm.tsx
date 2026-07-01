"use client";

// 청소원(CLEANER) 자가 회원가입 폼 — vi 기본·라이트·모바일.
//   공급자 폼(SignupForm)의 단순화 버전: 이름·전화·비밀번호 + 선택 Zalo ID(계좌 없음).
//   signupAction 재사용(hidden kind=cleaner) → role=CLEANER 생성 후 /zalo-connect로 자동 로그인.
//   ★ 승인 게이트 없음 — 배정 전까지 빈 청소 목록만 보이므로 누수·위험 없음(공급자 자가가입과 동일 패턴).
import { useActionState, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signupAction } from "./actions";
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
  zaloContact: string;
  zaloContactPlaceholder: string;
  submit: string;
  submitting: string;
  hasAccount: string;
  loginLink: string;
  back: string;
  errorMessages: Record<string, string>;
}

export default function CleanerSignupForm({ labels }: { labels: Labels }) {
  const [state, formAction, isPending] = useActionState(signupAction, null);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  return (
    <div className="bg-white text-neutral-900 min-h-screen flex flex-col w-full">
      {/* 상단 내비게이션 */}
      <header className="w-full top-0 sticky bg-white border-b border-neutral-100 z-50">
        <div className="flex items-center px-4 h-16 w-full">
          <button
            className="text-neutral-500 active:scale-95 transition-transform p-2"
            type="button"
            onClick={() => router.push("/signup")}
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
        <div className="mb-10">
          <span className="flex items-center gap-1.5 mb-2">
            <VillaGoMark className="h-5 w-auto" />
            <VillaGoWordmark
              className="font-headline text-base"
              villa="text-slate-900"
              go="text-teal-600"
            />
          </span>
          <h2 className="text-3xl font-bold text-neutral-900 tracking-tight">
            {labels.title}
          </h2>
          <p className="text-neutral-500 mt-2">{labels.subtitle}</p>
        </div>

        <form
          action={formAction}
          id="cleaner-signup-form"
          className="space-y-6 [&_input]:scroll-mb-44"
        >
          {/* 청소원 역할 지정 — 서버 액션 화이트리스트로 검증 */}
          <input type="hidden" name="kind" value="cleaner" />

          {state?.error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-4 py-3 rounded-xl">
              {labels.errorMessages[state.error] ?? state.error}
            </div>
          )}

          {/* 이름 */}
          <div className="group">
            <label
              className="block text-sm font-semibold text-neutral-700 mb-2 ml-1"
              htmlFor="fullname"
            >
              {labels.name}
            </label>
            <input
              className="w-full h-16 px-4 bg-neutral-50 border border-neutral-200 rounded-xl text-lg transition-all focus:bg-white"
              id="fullname"
              name="name"
              placeholder={labels.namePlaceholder}
              type="text"
              autoComplete="name"
              required
            />
          </div>

          {/* 전화번호 */}
          <div className="group">
            <label
              className="block text-sm font-semibold text-neutral-700 mb-2 ml-1"
              htmlFor="phone"
            >
              {labels.phone}
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">
                call
              </span>
              <input
                className="w-full h-16 pl-12 pr-4 bg-neutral-50 border border-neutral-200 rounded-xl text-lg transition-all focus:bg-white"
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
          <div className="group">
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
                className="w-full h-16 pl-12 pr-12 bg-neutral-50 border border-neutral-200 rounded-xl text-lg transition-all focus:bg-white"
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

          {/* Zalo 연락처 (선택) — 청소 요청 알림 수신·운영자 연락용 */}
          <div className="group">
            <label
              className="block text-sm font-semibold text-neutral-700 mb-2 ml-1"
              htmlFor="zaloContact"
            >
              {labels.zaloContact}
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">
                forum
              </span>
              <input
                className="w-full h-16 pl-12 pr-4 bg-neutral-50 border border-neutral-200 rounded-xl text-lg transition-all focus:bg-white"
                id="zaloContact"
                name="zaloContact"
                type="text"
                maxLength={64}
                placeholder={labels.zaloContactPlaceholder}
              />
            </div>
          </div>
        </form>
      </main>

      {/* 하단 고정 액션 */}
      <div className="fixed bottom-0 left-0 w-full bg-white border-t border-neutral-100 px-6 pt-4 pb-8 flex flex-col gap-4 shadow-[0_-8px_30px_rgb(0,0,0,0.04)]">
        <button
          className="w-full h-16 bg-teal-600 hover:bg-teal-700 active:scale-[0.98] disabled:opacity-60 transition-all text-white font-bold text-lg rounded-xl shadow-lg shadow-teal-600/20"
          type="submit"
          form="cleaner-signup-form"
          disabled={isPending}
        >
          {isPending ? labels.submitting : labels.submit}
        </button>
        <Link className="text-center text-neutral-600 font-medium py-2" href="/login">
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
