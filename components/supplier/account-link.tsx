"use client";

// 공급자 계정 진입 버튼 — 좌측 상단 고정(우측 상단 LocaleSwitcher와 대칭).
// /account(비밀번호 변경)로 이동. 풀스크린 플로우(빌라 등록 마법사)에서는 숨김.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

// LocaleSwitcher·TabBar와 동일한 숨김 규칙
const FULLSCREEN_PREFIXES = ["/my-villas/new"];

export function AccountLink() {
  const t = useTranslations("account");
  const pathname = usePathname();

  if (FULLSCREEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  // 계정 화면 자신에서는 중복 진입 숨김
  if (pathname === "/profile") return null;

  return (
    <Link
      href="/profile"
      aria-label={t("title")}
      title={t("title")}
      className="fixed left-3 top-3 z-[60] flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white/90 text-neutral-600 shadow-sm backdrop-blur transition-colors hover:text-teal-600"
    >
      <span className="material-symbols-outlined text-[20px]">account_circle</span>
    </Link>
  );
}
