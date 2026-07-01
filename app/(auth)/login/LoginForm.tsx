"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import {
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
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
  rememberMe: string;
  passkeyButton: string;
  errorMessages: Record<string, string>;
}

// 전화번호·비밀번호 저장 — 본인 기기 편의용. localStorage에 보관(자동 로그인 아님, 폼 자동 채움만).
const CREDS_KEY = "villaGoLoginCreds";

export default function LoginForm({ labels }: { labels: Labels }) {
  const [state, formAction, isPending] = useActionState(loginAction, null);
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  // 패스키(지문·얼굴) — 지원 브라우저에서만 버튼 노출.
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  // 저장된 로그인 정보 자동 채움 (마운트 시 1회)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CREDS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { phone?: string; password?: string };
      if (saved.phone) setPhone(saved.phone);
      if (saved.password) setPassword(saved.password);
      setRemember(true);
    } catch {
      // 파싱 실패 시 무시(손상된 값)
    }
  }, []);

  useEffect(() => {
    setPasskeySupported(browserSupportsWebAuthn());
  }, []);

  // 제출 직전 저장/삭제 — 체크 시 보관, 해제 시 즉시 삭제
  const persistCreds = () => {
    try {
      if (remember) {
        localStorage.setItem(CREDS_KEY, JSON.stringify({ phone, password }));
      } else {
        localStorage.removeItem(CREDS_KEY);
      }
    } catch {
      // 저장 불가 환경(프라이빗 모드 등)은 무시
    }
  };

  const loginWithPasskey = async () => {
    setPasskeyError(null);
    setPasskeyPending(true);
    try {
      // 1) 서버가 challenge 발급(+httpOnly 쿠키). 2) 기기 생체인증. 3) signIn("passkey")로 세션 발급.
      const optRes = await fetch("/api/auth/passkey/login/options", { method: "POST" });
      if (!optRes.ok) throw new Error("options");
      const options = await optRes.json();
      const assertion = await startAuthentication(options);
      const result = await signIn("passkey", {
        response: JSON.stringify(assertion),
        redirect: false,
      });
      if (!result || result.error) {
        setPasskeyError(labels.errorMessages.invalidCredentials ?? "");
        return;
      }
      // 루트에서 role별 분기(ADMIN→/dashboard, SUPPLIER→/my-villas 등). 전체 새로고침으로 세션 반영.
      window.location.href = "/";
    } catch (e) {
      // 사용자가 생체인증 취소(NotAllowedError/AbortError)한 경우는 조용히 무시.
      const name = e instanceof Error ? e.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setPasskeyError(labels.errorMessages.serverError ?? "");
      }
    } finally {
      setPasskeyPending(false);
    }
  };

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

        <form action={formAction} onSubmit={persistCreds} className="space-y-4">
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
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))}
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

          {/* 전화번호·비밀번호 저장 + 비밀번호 찾기 */}
          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                name="rememberMe"
                className="h-5 w-5 rounded border-slate-300 text-teal-600 accent-teal-600 focus:ring-teal-500"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span className="text-sm font-semibold text-slate-600">
                {labels.rememberMe}
              </span>
            </label>
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

        {/* 패스키(지문·얼굴) 로그인 — 지원 브라우저 + 등록된 기기에서만 사용 */}
        {passkeySupported && (
          <div className="space-y-3">
            <div className="h-px w-full bg-slate-200" />
            {passkeyError && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-4 py-3 rounded-xl">
                {passkeyError}
              </div>
            )}
            <button
              type="button"
              onClick={loginWithPasskey}
              disabled={passkeyPending}
              className="w-full flex items-center justify-center gap-2 border-2 border-teal-600 text-teal-700 font-bold text-lg rounded-xl touch-target active:scale-[0.98] transition-all disabled:opacity-60"
            >
              <span className="material-symbols-outlined">fingerprint</span>
              {labels.passkeyButton}
            </button>
          </div>
        )}

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
