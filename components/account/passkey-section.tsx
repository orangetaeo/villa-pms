"use client";

// 계정설정 — 패스키(지문·얼굴·Windows Hello) 등록·관리 카드 (ADR-0030).
//   4개 라이트 포털 계정화면(AccountScreen) 공통 슬롯. account.passkey.* 네임스페이스.
//   미지원 브라우저에서는 렌더하지 않는다(조건부). 로그인 버튼은 별도(로그인 화면, Phase B).
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

interface PasskeyItem {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

// 등록 기기 라벨 추정(사용자 입력 최소화) — 대략적 힌트일 뿐.
function guessDeviceName(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) return "Android";
  if (/macintosh|mac os x/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  return "";
}

export default function PasskeySection() {
  const t = useTranslations("account");
  const [supported, setSupported] = useState(false);
  const [items, setItems] = useState<PasskeyItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/passkey/list");
      if (!res.ok) return;
      const data = (await res.json()) as { items: PasskeyItem[] };
      setItems(data.items ?? []);
    } catch {
      // 목록 로드 실패는 조용히 무시(카드 자체는 등록 버튼으로 동작)
    }
  }, []);

  useEffect(() => {
    if (supported) void load();
  }, [supported, load]);

  const register = async () => {
    setError(null);
    setBusy(true);
    try {
      const optRes = await fetch("/api/auth/passkey/register/options", { method: "POST" });
      if (!optRes.ok) throw new Error("options");
      const options = await optRes.json();

      // 브라우저가 지문·얼굴 등 플랫폼 인증기를 띄운다.
      const attResp = await startRegistration(options);

      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attResp, deviceName: guessDeviceName() }),
      });
      if (!verifyRes.ok) throw new Error("verify");
      await load();
    } catch (e) {
      // 사용자가 취소(NotAllowedError)한 경우는 오류 표시 생략.
      const name = e instanceof Error ? e.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setError(t("passkey.registerError"));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/auth/passkey/${id}`, { method: "DELETE" });
      if (res.ok) await load();
    } catch {
      setError(t("passkey.deleteError"));
    }
  };

  if (!supported) return null;

  return (
    <section className="mt-6 rounded-2xl border border-neutral-100 bg-white p-6 shadow-sm">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-neutral-900">
        <span className="material-symbols-outlined text-teal-600">fingerprint</span>
        {t("passkey.title")}
      </h2>
      <p className="mb-4 text-sm text-neutral-500">{t("passkey.subtitle")}</p>

      {items.length > 0 && (
        <ul className="mb-4 space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-100 bg-neutral-50 px-3.5 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm text-neutral-700">
                <span className="material-symbols-outlined text-[20px] text-neutral-400">
                  passkey
                </span>
                <span className="truncate font-medium">
                  {it.deviceName || t("passkey.unnamedDevice")}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(it.id)}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 active:scale-95"
              >
                {t("passkey.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={register}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-teal-600 px-4 py-3 text-sm font-bold text-teal-700 transition-all active:scale-[0.98] disabled:opacity-60"
      >
        <span className="material-symbols-outlined text-[20px]">add</span>
        {busy ? t("passkey.registering") : t("passkey.register")}
      </button>
    </section>
  );
}
