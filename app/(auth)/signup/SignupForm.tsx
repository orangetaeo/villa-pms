"use client";

import { useActionState, useRef, useState } from "react";
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
  passwordConfirm: string;
  passwordConfirmPlaceholder: string;
  bankSection: string;
  bankBank: string;
  bankBankPlaceholder: string;
  bankAccount: string;
  bankAccountPlaceholder: string;
  bankHolder: string;
  bankHolderPlaceholder: string;
  zaloContact: string;
  zaloContactPlaceholder: string;
  submit: string;
  submitting: string;
  hasAccount: string;
  loginLink: string;
  back: string;
  errorMessages: Record<string, string>;
}

export default function SignupForm({ labels }: { labels: Labels }) {
  const [state, formAction, isPending] = useActionState(signupAction, null);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // 비밀번호 확인 일치 검사 — 두 입력 중 어느 쪽이 바뀌어도 확인 필드에 네이티브 검증 메시지를 설정.
  // 불일치 시 제출이 차단된다(setCustomValidity). 빈 확인 필드는 required가 처리.
  function syncPasswordMatch() {
    const pw = passwordRef.current?.value ?? "";
    const cf = confirmRef.current?.value ?? "";
    confirmRef.current?.setCustomValidity(
      cf && cf !== pw ? labels.errorMessages.passwordMismatch : ""
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
          id="signup-form"
          className="space-y-6 [&_input]:scroll-mb-44 [&_textarea]:scroll-mb-44"
        >
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
            <div className="relative">
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
                ref={passwordRef}
                className="w-full h-16 pl-12 pr-12 bg-neutral-50 border border-neutral-200 rounded-xl text-lg transition-all focus:bg-white"
                id="password"
                name="password"
                autoComplete="new-password"
                placeholder={labels.passwordPlaceholder}
                type={showPassword ? "text" : "password"}
                minLength={8}
                required
                onChange={syncPasswordMatch}
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

          {/* 비밀번호 확인 — 보기 토글은 위 비밀번호 필드의 showPassword 상태를 공유 */}
          <div className="group">
            <label
              className="block text-sm font-semibold text-neutral-700 mb-2 ml-1"
              htmlFor="passwordConfirm"
            >
              {labels.passwordConfirm}
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">
                lock
              </span>
              <input
                ref={confirmRef}
                className="w-full h-16 pl-12 pr-4 bg-neutral-50 border border-neutral-200 rounded-xl text-lg transition-all focus:bg-white"
                id="passwordConfirm"
                name="passwordConfirm"
                autoComplete="new-password"
                placeholder={labels.passwordConfirmPlaceholder}
                type={showPassword ? "text" : "password"}
                minLength={8}
                required
                onChange={syncPasswordMatch}
              />
            </div>
          </div>

          {/* Zalo 연락처 (선택) — 운영자가 알림·연락에 사용, 자동 Zalo 연결과 별개 */}
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

          {/* 정산받을 계좌 (선택) — 운영자 정산용, 공급자 원가·마진과 무관 */}
          <fieldset className="space-y-4 rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
            <legend className="px-1 text-sm font-semibold text-neutral-700">
              {labels.bankSection}
            </legend>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 mb-1.5 ml-1" htmlFor="bankBank">
                {labels.bankBank}
              </label>
              <input
                className="w-full h-14 px-4 bg-white border border-neutral-200 rounded-xl text-base transition-all focus:border-teal-400 outline-none"
                id="bankBank"
                name="bankBank"
                type="text"
                maxLength={120}
                placeholder={labels.bankBankPlaceholder}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 mb-1.5 ml-1" htmlFor="bankAccount">
                {labels.bankAccount}
              </label>
              <input
                className="w-full h-14 px-4 bg-white border border-neutral-200 rounded-xl text-base transition-all focus:border-teal-400 outline-none"
                id="bankAccount"
                name="bankAccount"
                inputMode="numeric"
                maxLength={120}
                placeholder={labels.bankAccountPlaceholder}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 mb-1.5 ml-1" htmlFor="bankHolder">
                {labels.bankHolder}
              </label>
              <input
                className="w-full h-14 px-4 bg-white border border-neutral-200 rounded-xl text-base transition-all focus:border-teal-400 outline-none"
                id="bankHolder"
                name="bankHolder"
                type="text"
                maxLength={120}
                placeholder={labels.bankHolderPlaceholder}
              />
            </div>
          </fieldset>
        </form>
      </main>

      {/* 하단 고정 액션 */}
      <div className="fixed bottom-0 left-0 w-full bg-white border-t border-neutral-100 px-6 pt-4 pb-8 flex flex-col gap-4 shadow-[0_-8px_30px_rgb(0,0,0,0.04)]">
        <button
          className="w-full h-16 bg-teal-600 hover:bg-teal-700 active:scale-[0.98] disabled:opacity-60 transition-all text-white font-bold text-lg rounded-xl shadow-lg shadow-teal-600/20"
          type="submit"
          form="signup-form"
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
      <div className="fixed -top-24 -right-24 w-64 h-64 bg-teal-50 rounded-full blur-3xl -z-10 opacity-60"></div>
      <div className="fixed -bottom-24 -left-24 w-64 h-64 bg-amber-50 rounded-full blur-3xl -z-10 opacity-40"></div>
    </div>
  );
}
