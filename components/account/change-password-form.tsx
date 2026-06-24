"use client";

// 본인 비밀번호 변경 폼 (self-service) — 운영자(다크)·공급자(라이트 vi) 공용.
// 임의 디자인 금지 규칙 준수: users-manager 모달(admin)·my-villas 카드(supplier)의
// 기존 스타일 토큰을 variant로 재사용. 로직(현재 비번 검증·교체)은 양쪽 동일.
import { useState } from "react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

type Variant = "admin" | "supplier";

const THEME: Record<
  Variant,
  { label: string; input: string; button: string; ok: string; error: string }
> = {
  admin: {
    label: "text-xs font-bold text-slate-400",
    input:
      "h-10 bg-slate-800 border border-slate-700 rounded-lg px-3 text-sm text-slate-100 focus:border-admin-primary focus:ring-1 focus:ring-admin-primary outline-none",
    button:
      "px-4 py-2.5 rounded-lg text-sm font-bold bg-admin-primary hover:bg-admin-primary-dark text-white disabled:opacity-50 transition-colors",
    ok: "text-emerald-500",
    error: "text-red-400",
  },
  supplier: {
    label: "text-sm font-semibold text-neutral-700",
    input:
      "h-12 bg-white border border-neutral-200 rounded-xl px-4 text-base text-neutral-900 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none",
    button:
      "w-full px-4 py-3.5 rounded-xl text-base font-bold bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 transition-colors",
    ok: "text-teal-700",
    error: "text-rose-600",
  },
};

export default function ChangePasswordForm({ variant }: { variant: Variant }) {
  const t = useTranslations("account");
  const theme = THEME[variant];

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    // 클라이언트 1차 검증 — 길이·일치 (서버에서도 재검증)
    if (next.length < 8) {
      setMessage({ tone: "error", text: t("errors.tooShort") });
      return;
    }
    if (next !== confirm) {
      setMessage({ tone: "error", text: t("errors.mismatch") });
      return;
    }
    if (next === current) {
      setMessage({ tone: "error", text: t("errors.same") });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        const map: Record<string, string> = {
          WRONG_PASSWORD: "errors.wrongCurrent",
          SAME_PASSWORD: "errors.same",
          PASSWORD_TOO_SHORT: "errors.tooShort",
        };
        setMessage({ tone: "error", text: t(map[data?.error ?? ""] ?? "errors.generic") });
        return;
      }
      setMessage({ tone: "ok", text: t("success") });
      setCurrent("");
      setNext("");
      setConfirm("");
      // 변경 후 재로그인 — 강제변경 플래그가 담긴 JWT를 새 값으로 갱신(보안상 권장).
      // 강제변경 사용자는 이걸로 게이트가 풀리고, 자발적 변경자도 새 비번으로 재인증.
      await signOut({ redirectTo: "/login" });
    } catch {
      setMessage({ tone: "error", text: t("errors.generic") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={theme.label}>{t("currentPassword")}</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={theme.input}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={theme.label}>{t("newPassword")}</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={theme.input}
        />
        <span
          className={variant === "admin" ? "text-[11px] text-slate-500" : "text-xs text-neutral-500"}
        >
          {t("hint")}
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={theme.label}>{t("confirmPassword")}</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={theme.input}
        />
      </label>

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`text-xs font-medium ${message.tone === "ok" ? theme.ok : theme.error}`}
        >
          {message.text}
        </p>
      )}

      <button type="submit" disabled={busy} className={theme.button}>
        {busy ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
